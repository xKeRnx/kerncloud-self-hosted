import { randomUUID } from "node:crypto";
import { z } from "zod";
import { pool, transaction } from "./db.ts";
import { validateModel } from "./catalog.ts";
import { createRun, changeRun } from "./store.ts";
import { HttpError } from "./auth.ts";
import { previewHtml, previewCsp } from "./artifacts.ts";
const cases = [
  {
    title: "Website delivery",
    goal: "Erstelle eine kompakte eigenständige statische Website Neko Licht. index.html und README.md liefern, ohne externe Assets. Hero mit h1, drei Leistungen, zugänglicher FAQ-Button id=faq, Antwort id=answer anfangs hidden, Demo-Button id=demo, Status id=status. FAQ-Klick toggelt hidden und aria-expanded. Demo setzt Status auf Demo bereit. Prüfe im Browser. Keine externen Aktionen.",
    checks: [
      { action: "click", selector: "#faq" },
      { action: "assert_visible", selector: "#answer" },
      { action: "click", selector: "#demo" },
      { action: "assert_text", selector: "#status", value: "Demo bereit" },
    ],
  },
  {
    title: "Repair without repetition",
    goal: 'Erstelle eine eigenständige statische Website Reparatur mit h1 sowie README.md. Behebe selbst diese defekte Vorlage: <button id=demo>Demo</button><p id=status></p><script>demo.onclick=()=>document.querySelector("#missing").textContent="Demo bereit"</script>. Demo-Button muss Status id=status mit Demo bereit füllen. Keine externen Assets. Prüfe im Browser und liefere Dateien.',
    checks: [
      { action: "click", selector: "#demo" },
      { action: "assert_text", selector: "#status", value: "Demo bereit" },
    ],
  },
];
export async function quality(
  actor: string,
  workspace: string,
  body?: unknown,
) {
  if (body) {
    const b = z
      .object({
        action: z.enum(["start", "cancel"]),
        id: z.string().uuid().optional(),
        agent_id: z.string().uuid().optional(),
        model_id: z.string().min(1).max(100).optional(),
        token_limit: z.number().int().min(2000).max(100000).default(10000),
        credit_limit: z.number().int().min(0).max(1000000).default(1000),
      })
      .strict()
      .parse(body);
    if (b.action === "cancel") {
      const e = (
        await pool.query(
          "UPDATE quality_evaluations SET status='canceled' WHERE id=$1 AND workspace_id=$2 RETURNING id",
          [b.id, workspace],
        )
      ).rows[0];
      if (e)
        for (const r of (
          await pool.query(
            "SELECT run_id FROM quality_cases WHERE evaluation_id=$1 AND run_id IS NOT NULL AND status='running'",
            [e.id],
          )
        ).rows)
          try {
            await changeRun(workspace, r.run_id, "cancel");
          } catch {}
      if (e)
        await pool.query(
          "UPDATE quality_cases SET status='canceled' WHERE evaluation_id=$1 AND status IN('queued','running')",
          [e.id],
        );
      return { ok: true };
    }
    if (!b.agent_id || !b.model_id)
      throw new HttpError(400, "Agent and active model required");
    await transaction(async (c) => {
      await c.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
        workspace,
      ]);
      if (
        (
          await c.query(
            "SELECT id FROM quality_evaluations WHERE workspace_id=$1 AND status IN('queued','running')",
            [workspace],
          )
        ).rowCount
      )
        throw new HttpError(409, "An evaluation is already active");
      await validateModel(c, workspace, b.model_id!);
      if (
        !(
          await c.query(
            "SELECT id FROM agents WHERE id=$1 AND workspace_id=$2",
            [b.agent_id, workspace],
          )
        ).rowCount
      )
        throw new HttpError(403, "Foreign agent");
      const id = randomUUID();
      await c.query(
        "INSERT INTO quality_evaluations(id,workspace_id,actor,agent_id,model_id,token_limit,credit_limit) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          id,
          workspace,
          actor,
          b.agent_id,
          b.model_id,
          b.token_limit,
          b.credit_limit,
        ],
      );
      for (const [i, v] of cases.entries())
        await c.query(
          "INSERT INTO quality_cases(id,evaluation_id,position,goal,contract) VALUES($1,$2,$3,$4,$5)",
          [
            randomUUID(),
            id,
            i,
            v.goal,
            JSON.stringify({ title: v.title, checks: v.checks }),
          ],
        );
    });
  }
  return {
    items: (
      await pool.query(
        `SELECT e.*,coalesce(jsonb_agg(jsonb_build_object('id',q.id,'title',q.contract->>'title','status',q.status,'run_id',q.run_id,'verdict',q.verdict) ORDER BY q.position) FILTER(WHERE q.id IS NOT NULL),'[]') cases FROM quality_evaluations e LEFT JOIN quality_cases q ON q.evaluation_id=e.id WHERE e.workspace_id=$1 GROUP BY e.id ORDER BY e.created_at DESC LIMIT 30`,
        [workspace],
      )
    ).rows,
  };
}
async function judge(runId: string, contract: any) {
  const run = (await pool.query("SELECT * FROM runs WHERE id=$1", [runId]))
      .rows[0],
    files = (
      await pool.query(
        "SELECT name,content FROM artifacts WHERE run_id=$1 AND NOT retired",
        [runId],
      )
    ).rows;
  const file = files.find((f) => /(^|\/)index.html$/i.test(f.name)),
    readme = files.some((f) => /(^|\/)README.md$/i.test(f.name));
  const usage = (
    await pool.query(
      "SELECT coalesce(sum(tokens),0) tokens,coalesce(sum(charged_credits),0) credits,bool_and(usage_known AND status NOT IN('reserved','uncertain')) known FROM model_calls WHERE run_id=$1",
      [runId],
    )
  ).rows[0];
  let browser: any = {
    passed: false,
    reason: "No HTML or browser validator unavailable",
  };
  if (file && process.env.ARTIFACT_VALIDATOR_URL)
    try {
      const r = await fetch(
        process.env.ARTIFACT_VALIDATOR_URL.replace(/\/$/, "") + "/validate",
        {
          method: "POST",
          redirect: "error",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + process.env.WORKER_TOKEN,
          },
          body: JSON.stringify({
            html: previewHtml(file, files),
            csp: previewCsp,
            checks: contract.checks,
          }),
          signal: AbortSignal.timeout(28000),
        },
      );
      if (r.ok) browser = await r.json();
    } catch {}
  return {
    passed:
      run.status === "completed" &&
      !!file &&
      readme &&
      browser.passed === true &&
      usage.known === true,
    tokens: Number(usage.tokens),
    credits: Number(usage.credits),
    usage_known: usage.known === true,
    html: !!file,
    readme,
    browser,
    status: run.status,
    reason: run.error ?? null,
    verified_at: new Date().toISOString(),
    evidence:
      "Independent server checks and fixed browser contract, not agent self-rating",
  };
}
export async function tickQuality() {
  const rows = (
    await pool.query(
      "SELECT * FROM quality_evaluations WHERE status IN('queued','running') ORDER BY created_at LIMIT 10",
    )
  ).rows;
  for (const e of rows)
    try {
      const items = (
        await pool.query(
          "SELECT * FROM quality_cases WHERE evaluation_id=$1 ORDER BY position",
          [e.id],
        )
      ).rows;
      for (const q of items) {
        if (q.status === "running") {
          const r = (
            await pool.query("SELECT status FROM runs WHERE id=$1", [q.run_id])
          ).rows[0];
          if (!r || ["running", "paused", "input_required"].includes(r.status))
            break;
          const verdict = await judge(q.run_id, q.contract);
          await pool.query(
            "UPDATE quality_cases SET status=$2,verdict=$3 WHERE id=$1",
            [
              q.id,
              verdict.passed ? "passed" : "failed",
              JSON.stringify(verdict),
            ],
          );
          break;
        }
        if (q.status === "queued") {
          const w = (
            await pool.query("SELECT * FROM workspace_context WHERE id=$1", [
              e.workspace_id,
            ])
          ).rows[0];
          await createRun(w, q.goal, e.agent_id, [], false, [e.agent_id], "", {
            tokenLimit: Math.floor(e.token_limit / items.length),
            creditLimit: Math.floor(e.credit_limit / items.length),
            quality: { caseId: q.id, modelId: e.model_id },
          });
          break;
        }
      }
      await pool.query(
        "UPDATE quality_evaluations SET status=CASE WHEN EXISTS(SELECT 1 FROM quality_cases WHERE evaluation_id=$1 AND status IN('queued','running')) THEN 'running' ELSE 'completed' END WHERE id=$1 AND status<>'canceled'",
        [e.id],
      );
    } catch (error) {
      await pool.query(
        "UPDATE quality_evaluations SET status='blocked' WHERE id=$1 AND status<>'canceled'",
        [e.id],
      );
      await pool.query(
        "UPDATE quality_cases SET verdict=$2 WHERE evaluation_id=$1 AND status='queued'",
        [
          e.id,
          JSON.stringify({
            passed: false,
            reason:
              error instanceof HttpError
                ? error.message
                : "Evaluation setup failed; inspect model and quotas",
          }),
        ],
      );
    }
}
