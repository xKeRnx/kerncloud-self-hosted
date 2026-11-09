import { toolArgumentsHash, toolOutcomeHash } from "../core/agent-loops.ts";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  validationInput,
  artifactFingerprint,
} from "../core/artifact-validation.ts";
import { pool, transaction } from "./db.ts";
import { lockTask, event } from "./store.ts";
import { HttpError } from "./auth.ts";
import { previewHtml, previewCsp, saveArtifact } from "./artifacts.ts";
import { executionSignal } from "./execution-control.ts";

export async function autoValidatePatch(
  taskId: string,
  lease: string,
  callId: string,
  output: any,
) {
  let patch: any;
  try {
    patch = JSON.parse(output.result);
  } catch {
    return output;
  }
  if (!patch.previous_artifact_id || !patch.artifact_id) return output;
  const candidate = await transaction(async (c) => {
    const { task, run } = await lockTask(c, taskId, lease);
    if (run.model_policy?.autonomy_version !== 1) return null;
    const rows = (
      await c.query(
        "SELECT o.result FROM operations o JOIN tasks t ON t.id=o.task_id WHERE t.run_id=$1 AND o.tool_name='validate_artifact' AND o.status='done' ORDER BY o.recorded_at DESC",
        [run.id],
      )
    ).rows;
    for (const row of rows)
      try {
        const r = JSON.parse(row.result.result);
        if (r.artifact_id === patch.previous_artifact_id && r.checks?.length)
          return r.checks;
      } catch {}
    return null;
  });
  if (!candidate) return output;
  let report: any;
  try {
    const key = `${callId}-autocheck`;
    const prior = (
      await pool.query(
        "SELECT result FROM operations WHERE id=$1 AND status='done'",
        [`${taskId}:${key}`],
      )
    ).rows[0];
    const checked =
      prior?.result ??
      (await artifactValidationStep(taskId, lease, key, {
        artifact_id: patch.artifact_id,
        checks: candidate,
      }));
    report = JSON.parse(checked.result);
  } catch (e) {
    report = {
      passed: false,
      ok: false,
      guidance:
        e instanceof HttpError
          ? e.message
          : "Automatische lokale Prüfung nicht abgeschlossen; keine bestandenen Tests behaupten.",
    };
  }
  const result = {
    ...output,
    result: JSON.stringify({ ...patch, automatic_validation: report }),
    isError: report.passed !== true,
  };
  await pool.query(
    "UPDATE operations SET result=$2 WHERE id=$1 AND status='done'",
    [`${taskId}:${callId}`, JSON.stringify(result)],
  );
  return result;
}

async function files(c: PoolClient, task: any) {
  return (
    await c.query(
      "SELECT id,name,content FROM artifacts WHERE run_id=$1 AND workspace_id=$2 AND NOT retired AND name ~* '\\.(html?|css|js|mjs|svg)$' ORDER BY id",
      [task.run_id, task.workspace_id],
    )
  ).rows;
}
export async function requireArtifactValidation(
  c: PoolClient,
  task: any,
  run: any,
) {
  if (run.model_policy?.autonomy_version !== 1) return;
  const current = await files(c, task);
  const html = current.filter((f) => /\.html?$/i.test(f.name));
  if (!html.length) return;
  const fingerprint = artifactFingerprint(current);
  const rows = (
    await c.query(
      "SELECT o.result FROM operations o JOIN tasks t ON t.id=o.task_id WHERE t.run_id=$1 AND o.tool_name='validate_artifact' AND o.status='done' AND NOT o.failed",
      [run.id],
    )
  ).rows;
  const accepted = new Set<string>();
  for (const row of rows)
    try {
      const report = JSON.parse(row.result.result);
      if (report.passed === true && report.fingerprint === fingerprint)
        accepted.add(report.artifact_id);
    } catch {}
  if (html.some((f) => !accepted.has(f.id)))
    throw new HttpError(
      409,
      "Aktuelle HTML-Dateien sind noch nicht erfolgreich im Browser geprüft. validate_artifact mit Interaktionen und assert_*-Erwartungen ausführen, Fehler klein patchen und erneut prüfen. Keine neue Datei allein für den Abschluss erzeugen.",
    );
}
export async function artifactValidationStep(
  taskId: string,
  lease: string,
  callId: string,
  args: unknown,
) {
  const input = validationInput.parse(args),
    operationId = `${taskId}:${callId}`;
  if (!process.env.ARTIFACT_VALIDATOR_URL)
    throw new HttpError(
      409,
      "Browser-Prüfdienst ist nicht eingerichtet; keine erfolgreiche Browserprüfung behaupten.",
    );
  const data = await transaction(async (c) => {
    const { task } = await lockTask(c, taskId, lease);
    const count = Number(
      (
        await c.query(
          "SELECT count(*) FROM operations o JOIN tasks t ON t.id=o.task_id WHERE t.run_id=$1 AND o.tool_name='validate_artifact'",
          [task.run_id],
        )
      ).rows[0].count,
    );
    if (count >= 8)
      throw new HttpError(
        409,
        "Die acht Browserprüfungen dieses Auftrags sind ausgeschöpft. Keine neue Aufgabe zur Umgehung anlegen.",
      );
    const current = await files(c, task),
      file = current.find(
        (f) => f.id === input.artifact_id && /\.html?$/i.test(f.name),
      );
    if (!file)
      throw new HttpError(
        404,
        "Aktive HTML-Datei dieses Auftrags nicht gefunden.",
      );
    await c.query(
      "INSERT INTO operations(id,task_id,tool_name) VALUES($1,$2,'validate_artifact')",
      [operationId, taskId],
    );
    return {
      task,
      html: previewHtml(file, current),
      fingerprint: artifactFingerprint(current),
    };
  });
  const control = await executionSignal(taskId, lease);
  let validation: any;
  try {
    const response = await fetch(
      `${process.env.ARTIFACT_VALIDATOR_URL.replace(/\/$/, "")}/validate`,
      {
        method: "POST",
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.WORKER_TOKEN}`,
        },
        body: JSON.stringify({
          html: data.html,
          csp: previewCsp,
          checks: input.checks,
        }),
        signal: AbortSignal.any([control.signal, AbortSignal.timeout(28000)]),
      },
    );
    if (!response.ok) throw new Error(`Validator HTTP ${response.status}`);
    const text = await response.text();
    if (text.length > 50000) throw new Error("Oversized validator result");
    validation = JSON.parse(text);
    if (
      validation.ok !== true ||
      typeof validation.passed !== "boolean" ||
      !Array.isArray(validation.results)
    )
      throw new Error("Invalid validator response");
  } catch {
    validation = {
      ok: false,
      passed: false,
      code: "VALIDATOR_UNAVAILABLE",
      guidance:
        "Lokale Browserprüfung fehlgeschlagen; nichts extern ausgeführt. Dienst später erneut prüfen, keine bestandenen Tests behaupten.",
    };
  } finally {
    control.close();
  }
  return transaction(async (c) => {
    const { task } = await lockTask(c, taskId, lease);
    const report = {
      ...validation,
      artifact_id: input.artifact_id,
      fingerprint: data.fingerprint,
      checks: input.checks,
    };
    const reportFile = await saveArtifact(
      c,
      task,
      `validation/${randomUUID()}.json`,
      JSON.stringify(report, null, 2),
    );
    const output = {
      result: JSON.stringify({ ...report, report_id: reportFile.artifact_id }),
      yield: false,
      isError: !report.passed,
    };
    await c.query("UPDATE operations SET status='done',result=$2 WHERE id=$1", [
      operationId,
      JSON.stringify(output),
    ]);
    await c.query(
      "UPDATE operations SET arguments_hash=$2,outcome_hash=$3,failed=$4,recorded_at=now() WHERE id=$1",
      [
        operationId,
        toolArgumentsHash(args),
        toolOutcomeHash("validate_artifact", output.result),
        output.isError,
      ],
    );
    await event(
      c,
      task.workspace_id,
      task.run_id,
      task.agent_id,
      "validation",
      report.passed
        ? "Browserprüfung der aktuellen Dateien bestanden (Desktop und Mobil)."
        : "Browserprüfung fehlgeschlagen; Agent erhält die konkreten Befunde zur Reparatur.",
    );
    return output;
  });
}
