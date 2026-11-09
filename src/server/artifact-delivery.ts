import { z } from "zod";
import { randomUUID } from "node:crypto";
import { pool, transaction } from "./db.ts";
import { lockTask, finishTask } from "./store.ts";
import { saveArtifact } from "./artifacts.ts";
import {
  artifactValidationStep,
  requireArtifactValidation,
} from "./artifact-validation.ts";
import { validationInput } from "../core/artifact-validation.ts";
import { toolArgumentsHash, toolOutcomeHash } from "../core/agent-loops.ts";
import { HttpError } from "./auth.ts";
import type { Message } from "../core/types.ts";
export const deliveryTool = {
  type: "function",
  function: {
    name: "deliver_artifacts",
    description:
      "Liefere eine vollständige Website samt README in EINEM Aufruf: files mit Namen/Endung/Inhalt, checks mit action,selector,value,attribute, summary. Echter Browser prüft Desktop/Mobil. Bei Erfolg automatisch Abschluss und prüfbarer Skill-Entwurf; bei Fehler Befunde zurück. Nur als einziger Werkzeugaufruf der Antwort.",
    parameters: {
      type: "object",
      properties: {
        files: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              content: { type: "string" },
            },
            required: ["name", "content"],
            additionalProperties: false,
          },
        },
        checks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              action: {
                type: "string",
                enum: [
                  "click",
                  "press",
                  "fill",
                  "assert_text",
                  "assert_attribute",
                  "assert_visible",
                  "assert_count",
                  "assert_value",
                ],
              },
              selector: { type: "string" },
              value: { type: ["string", "boolean", "number"] },
              attribute: { type: "string" },
            },
            required: ["action", "selector"],
            additionalProperties: false,
          },
        },
        summary: { type: "string" },
      },
      required: ["files", "checks", "summary"],
      additionalProperties: false,
    },
  },
};
export async function deliverArtifacts(
  taskId: string,
  lease: string,
  callId: string,
  args: unknown,
  messages: Message[],
) {
  const b = z
    .object({
      files: z
        .array(
          z
            .object({
              name: z.string().min(1).max(180),
              content: z.string().max(200000),
            })
            .strict(),
        )
        .min(1)
        .max(5),
      checks: z.array(z.unknown()).min(1).max(20),
      summary: z.string().trim().min(10).max(6000),
    })
    .strict()
    .parse(args);
  validationInput.parse({ artifact_id: randomUUID(), checks: b.checks });
  const assistant = messages.findLast((m) => m.role === "assistant");
  if (
    assistant?.tool_calls?.length !== 1 ||
    assistant.tool_calls[0].id !== callId
  )
    throw new HttpError(
      400,
      "deliver_artifacts muss der einzige Werkzeugaufruf sein; alle Dateien in files bündeln.",
    );
  if (
    b.files.filter(
      (f) =>
        /\.html?$/i.test(f.name) ||
        (!f.name.includes(".") &&
          /^\s*(?:<!doctype\s+html|<html)/i.test(f.content)),
    ).length !== 1
  )
    throw new HttpError(400, "Genau eine HTML-Datei im Paket angeben.");
  const key = `${taskId}:${callId}`,
    hash = toolArgumentsHash(args);
  const staged = await transaction(async (c) => {
    const { task } = await lockTask(c, taskId, lease);
    const prior = (await c.query("SELECT * FROM operations WHERE id=$1", [key]))
      .rows[0];
    if (prior) {
      if (prior.arguments_hash !== hash)
        throw new HttpError(
          409,
          "Paketparameter geändert; vorhandenen Arbeitsstand lesen.",
        );
      return prior.result;
    }
    if (
      (
        await c.query(
          "SELECT 1 FROM tasks WHERE parent_id=$1 AND status NOT IN('completed','failed','canceled')",
          [task.id],
        )
      ).rowCount
    )
      throw new HttpError(409, "Laufende Teilaufgaben zuerst abwarten.");
    const files = [];
    for (const f of b.files)
      files.push(await saveArtifact(c, task, f.name, f.content));
    const stage = {
      after_event: Number(
        (
          await c.query(
            "SELECT coalesce(max(id),0) n FROM events WHERE run_id=$1",
            [task.run_id],
          )
        ).rows[0].n,
      ),
      files,
      html: files.find((f) => /\.html?$/i.test(f.name))!.artifact_id,
    };
    await c.query(
      "INSERT INTO operations(id,task_id,tool_name,arguments_hash,result) VALUES($1,$2,'deliver_artifacts',$3,$4)",
      [key, taskId, hash, JSON.stringify(stage)],
    );
    return stage;
  });
  const checkKey = `${callId}-bundle-browser`;
  const old = (
    await pool.query(
      "SELECT result FROM operations WHERE id=$1 AND status='done'",
      [`${taskId}:${checkKey}`],
    )
  ).rows[0];
  const checked =
    old?.result ??
    (await artifactValidationStep(taskId, lease, checkKey, {
      artifact_id: staged.html,
      checks: b.checks,
    }));
  const report = JSON.parse(checked.result);
  return transaction(async (c) => {
    const { task, run } = await lockTask(c, taskId, lease);
    const newer = (
      await c.query(
        "SELECT 1 FROM events WHERE run_id=$1 AND id>$2 AND kind IN('message','user_message') LIMIT 1",
        [run.id, staged.after_event],
      )
    ).rowCount;
    if (newer) {
      report.passed = false;
      report.guidance =
        "Neue Nutzervorgaben sind eingetroffen. Vor dem Abschluss den aktuellen Kontext berücksichtigen; keine alten Aktionen wiederholen.";
    }
    const output = {
      result: JSON.stringify({
        files: staged.files,
        validation: report,
        completed: report.passed === true,
      }),
      yield: report.passed === true,
      isError: report.passed !== true,
    };
    if (report.passed) await requireArtifactValidation(c, task, run);
    await c.query(
      "UPDATE operations SET status='done',result=$2,outcome_hash=$3,failed=$4,recorded_at=now() WHERE id=$1",
      [
        key,
        JSON.stringify(output),
        toolOutcomeHash("deliver_artifacts", output.result),
        output.isError,
      ],
    );
    if (report.passed) {
      await c.query(
        "UPDATE tasks SET skill_proposal=$2,messages=$3 WHERE id=$1",
        [
          task.id,
          JSON.stringify({
            name: "Geprüfte Website als Dateipaket",
            description:
              "Vollständige Dateien liefern und mit isoliertem Browser prüfen.",
            content:
              "1. Vollständige eigenständige HTML-/CSS-/JS-Dateien und README erstellen.\n2. Dateinamen und konkrete Browser-Erwartungen festlegen.\n3. Mit deliver_artifacts speichern und Desktop/Mobil prüfen.\n4. Bei Fehlermeldungen Ursachen mit kleinen Patches beheben und denselben Prüfplan erneut ausführen.\n5. Nur nach gültigem aktuellem Beleg abschließen. Rechte und festes gemeinsames Budget gelten unverändert.\nDie konkrete Fehlerbehebung des Quellcodes und Prüfumfang vor Wiederverwendung am Originalauftrag prüfen.",
            verification: `Echte Browserprüfung, Fingerabdruck ${report.fingerprint}. Prüfplan: ${JSON.stringify(report.checks)}`,
          }),
          JSON.stringify([
            ...messages,
            { role: "tool", tool_call_id: callId, content: output.result },
          ]),
        ],
      );
      await finishTask(c, task, "completed", b.summary);
    }
    return output;
  });
}
