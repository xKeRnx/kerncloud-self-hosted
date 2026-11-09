import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { pool, transaction, audit } from "./db.ts";
import { HttpError } from "./auth.ts";
import { toolOutcomeHash } from "../core/agent-loops.ts";

export async function proposeRunSkill(
  c: PoolClient,
  workspaceId: string,
  runId: string,
) {
  const run = (
    await c.query(
      "SELECT goal,token_limit,credit_limit,tokens_used,model_policy FROM runs WHERE id=$1 AND workspace_id=$2 AND status='completed'",
      [runId, workspaceId],
    )
  ).rows[0];
  if (!run || run.model_policy?.automation) return;
  if (
    (await c.query("SELECT 1 FROM skills WHERE source_run_id=$1", [runId]))
      .rowCount
  )
    return;
  if (
    Number(
      (
        await c.query(
          "SELECT count(*) FROM skills WHERE workspace_id=$1 AND status='draft'",
          [workspaceId],
        )
      ).rows[0].count,
    ) >= 100
  )
    return;
  const receipts = (
    await c.query(
      "SELECT o.id,o.tool_name,o.outcome_hash,o.result FROM operations o JOIN tasks t ON t.id=o.task_id WHERE t.run_id=$1 AND o.status='done' AND NOT o.failed AND o.tool_name IS NOT NULL AND o.tool_name NOT IN('propose_skill','create_checkpoint','environment_checkpoint','write_memory','team_message','wait_for_team') AND o.result->>'isError' IS DISTINCT FROM 'true' ORDER BY o.recorded_at LIMIT 30",
      [runId],
    )
  ).rows.filter((r) => {
    try {
      const result = JSON.parse(r.result?.result);
      return (
        result?.ok !== false &&
        result?.isError !== true &&
        result?.requiresReview !== true
      );
    } catch {
      return true;
    }
  });
  const files = (
    await c.query(
      "SELECT id,name,content FROM artifacts WHERE run_id=$1 AND workspace_id=$2 ORDER BY created_at LIMIT 30",
      [runId, workspaceId],
    )
  ).rows;
  if (!receipts.length && !files.length) return;
  const evidence = [
    ...receipts.map((r) => ({
      kind: "operation",
      id: r.id,
      tool: r.tool_name,
      sha256: r.outcome_hash,
    })),
    ...files.map((f) => ({
      kind: "artifact",
      id: f.id,
      name: f.name,
      sha256: createHash("sha256").update(f.content).digest("hex"),
    })),
  ];
  const tools = [...new Set(receipts.map((r) => r.tool_name as string))];
  const proposal = (
    await c.query(
      "SELECT skill_proposal FROM tasks WHERE run_id=$1 AND skill_proposal IS NOT NULL AND status='completed' ORDER BY created_at DESC LIMIT 1",
      [runId],
    )
  ).rows[0]?.skill_proposal;
  let content = proposal
    ? proposal.content +
      "\n\n## Prüfkriterien des Entwurfs\n" +
      proposal.verification +
      "\n\nEntwurf: erst menschlich prüfen und freigeben. Werkzeuge und Skills erteilen keine zusätzlichen Rechte."
    : `# Ablaufentwurf\n\n## Zweck\nAus einem abgeschlossenen Auftrag abgeleitet. Ziel und Parameter vor Wiederverwendung prüfen.\n\n## Voraussetzungen\nBenötigte Dateien, Modell, Umgebung und Werkzeugfreigaben müssen vorhanden sein. Keine Zugangsdaten im Skill speichern.\n\n## Beobachteter Ablauf\n${tools.map((name, i) => `${i + 1}. Werkzeug \`${name}\` wurde mit bestätigtem Ergebnis verwendet. Parameter für den neuen Auftrag ausdrücklich festlegen.`).join("\n") || "1. Vollständige Ergebnisdateien erstellen und prüfen."}\n\n## Prüfung\nDie gespeicherten Belege im Ursprungsauftrag prüfen. Erfolgreicher Auftragsstatus allein bestätigt keine fachliche Korrektheit. Konkrete Prüfkommandos und erwartete Ergebnisse hier ergänzen.\n\n## Abbruch und Wiederherstellung\nBei fehlenden Voraussetzungen Rückfrage stellen. Unbestätigte externe Aktionen nicht wiederholen. Vor Dateiänderungen einen Sicherungspunkt anlegen; externe Aktionen sind dadurch nicht rückgängig gemacht.\n\n## Grenzen\nDieser Entwurf erteilt keine Rechte und ist noch nicht für Agenten freigegeben. Er enthält bewusst keine rohen Werkzeugargumente, Geheimnisse oder Ausgaben.\n`;
  const browserReceipts = receipts
    .filter((r) => r.tool_name === "validate_artifact")
    .map((r) => {
      try {
        return JSON.parse(r.result.result);
      } catch {
        return null;
      }
    })
    .filter((r) => r?.passed === true);
  content += `\n\n## Automatisch belegte Grenzen\nBeobachtete Werkzeuge: ${tools.join(", ")}.\nGemeinsames festes Limit: ${run.token_limit} Tokens und ${run.credit_limit} KeRnCloud-Credits; bisher gemessen: ${run.tokens_used} Tokens. Kein neuer Etat durch Reparaturen oder Kontextwechsel.\nBrowserprüfungen mit Werkzeugbeleg: ${browserReceipts.length}; Dateifingerabdrücke: ${browserReceipts.map((r) => r.fingerprint).join(", ") || "keine"}.\nNur die referenzierten Dateiversionen und tatsächlich ausgeführten Prüfungen sind belegt. Andere Voraussetzungen und Aussagen des Modellvorschlags bleiben menschlich zu prüfen. Keine automatische Freigabe.\n`;
  const id = randomUUID();
  await c.query(
    "INSERT INTO skills(id,workspace_id,name,description,content,status,source_run_id,evidence) VALUES($1,$2,$3,$4,$5,'draft',$6,$7)",
    [
      id,
      workspaceId,
      proposal?.name ?? `Ablauf ${runId.slice(0, 8)}`,
      proposal?.description ??
        "Automatischer Entwurf aus einem abgeschlossenen Auftrag. Belege prüfen und Anleitung vervollständigen.",
      content,
      runId,
      JSON.stringify(evidence),
    ],
  );
  await c.query(
    "INSERT INTO skill_revisions(skill_id,version,content,status,evidence) VALUES($1,1,$2,'draft',$3)",
    [id, content, JSON.stringify(evidence)],
  );
  await c.query(
    "INSERT INTO events(workspace_id,run_id,kind,content) VALUES($1,$2,'skill_draft','Prüfbarer Ablaufentwurf in der Skills-Bibliothek gespeichert. Erst nach menschlicher Freigabe verwendbar.')",
    [workspaceId, runId],
  );
}
export async function reviewSkill(
  actor: string,
  workspaceId: string,
  skillId: string,
  body: unknown,
) {
  const b = z
    .object({
      version: z.number().int().min(1),
      action: z.enum(["approve", "reject"]),
      note: z.string().trim().min(10).max(3000),
    })
    .strict()
    .parse(body);
  return transaction(async (c) => {
    const s = (
      await c.query(
        "SELECT * FROM skills WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
        [skillId, workspaceId],
      )
    ).rows[0];
    if (!s) throw new HttpError(404, "Skill fehlt.");
    if (s.version !== b.version || s.status !== "draft")
      throw new HttpError(
        409,
        "Entwurf wurde geändert oder bereits geprüft. Bitte neu laden.",
      );
    const status = b.action === "approve" ? "approved" : "rejected";
    await c.query(
      "UPDATE skills SET status=$2,version=version+1,review_note=$3,reviewed_by=$4,reviewed_at=now() WHERE id=$1",
      [skillId, status, b.note, actor],
    );
    await c.query(
      "INSERT INTO skill_revisions(skill_id,version,content,status,evidence,review_note) VALUES($1,$2,$3,$4,$5,$6)",
      [
        skillId,
        s.version + 1,
        s.content,
        status,
        JSON.stringify(s.evidence),
        b.note,
      ],
    );
    await audit(c, actor, `skill.${b.action}`, skillId);
    return { ok: true };
  });
}
export async function skillHistory(workspaceId: string, skillId: string) {
  return (
    await pool.query(
      "SELECT r.* FROM skill_revisions r JOIN skills s ON s.id=r.skill_id WHERE r.skill_id=$1 AND s.workspace_id=$2 ORDER BY version DESC",
      [skillId, workspaceId],
    )
  ).rows;
}
export async function skillEvidence(workspaceId: string, skillId: string) {
  const skill = (
    await pool.query(
      "SELECT evidence FROM skills WHERE workspace_id=$1 AND id=$2",
      [workspaceId, skillId],
    )
  ).rows[0];
  if (!skill) throw new HttpError(404, "Skill fehlt.");
  const results = [];
  for (const evidence of skill.evidence) {
    if (evidence.kind === "operation") {
      const row = (
        await pool.query(
          "SELECT o.tool_name,o.result FROM operations o JOIN tasks t ON t.id=o.task_id WHERE o.id=$1 AND t.workspace_id=$2 AND o.status='done'",
          [evidence.id, workspaceId],
        )
      ).rows[0];
      results.push({
        ...evidence,
        available: !!row,
        verified:
          !!row &&
          toolOutcomeHash(row.tool_name, row.result?.result ?? "") ===
            evidence.sha256,
        result: row?.result,
      });
    } else {
      const row = (
        await pool.query(
          "SELECT content FROM artifacts WHERE id=$1 AND workspace_id=$2",
          [evidence.id, workspaceId],
        )
      ).rows[0];
      results.push({
        ...evidence,
        available: !!row,
        verified:
          !!row &&
          createHash("sha256").update(row.content).digest("hex") ===
            evidence.sha256,
      });
    }
  }
  return { evidence: results };
}
