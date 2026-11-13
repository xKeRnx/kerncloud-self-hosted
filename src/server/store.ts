import {
  projectFor,
  assertProjectRun,
  assertProjectAgent,
  bindPlanRun,
} from "./organisation.ts";
import { captureRunCheckpoint } from "./checkpoints.ts";
import { snapshotRunPolicy } from "./run-policy.ts";
import { proposeRunSkill } from "./learned-skills.ts";
import { ensureAccountAllowance } from "./monthly-allowances.ts";
import { allocateAutomaticPlan } from "./plan-allowance.ts";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool, transaction, audit } from "./db.ts";
import { decrypt } from "./security.ts";
import { HttpError } from "./auth.ts";
import { listModels, validateModel } from "./catalog.ts";
import { publicSite } from "./business.ts";
import { rememberFinishedRun, listMemory } from "./memory.ts";
import { mayRetryModel } from "../core/agent-recovery.ts";
import type {
  Agent,
  Task,
  User,
  Workspace,
  Provider,
  Message,
  Run,
} from "../core/types.ts";
export async function event(
  c: PoolClient,
  workspaceId: string,
  runId: string | null,
  agentId: string | null,
  kind: string,
  content: string,
) {
  if (["completed", "failed", "input_required", "decision"].includes(kind))
    await c.query(
      "INSERT INTO workspace_notifications(id,workspace_id,kind,title,body,href,source_key) VALUES($1,$2,'event',$3,$4,$5,$6) ON CONFLICT DO NOTHING",
      [
        randomUUID(),
        workspaceId,
        kind,
        content.slice(0, 4000),
        runId ? "/tasks/" + runId : "/decisions",
        [runId, agentId, kind, content.slice(0, 300)].join(":"),
      ],
    );
  await c.query(
    "INSERT INTO events(workspace_id,run_id,agent_id,kind,content) VALUES($1,$2,$3,$4,$5)",
    [workspaceId, runId, agentId, kind, content.slice(0, 20000)],
  );
}
export async function snapshot(
  user: User,
  workspace: Workspace,
  options: {
    view?: string;
    runId?: string;
    before?: { created_at: string; id: string };
  } = {},
) {
  const full = !options.view;
  const detailProject = options.runId
    ? (
        await pool.query(
          "SELECT project_id FROM runs WHERE id=$1 AND workspace_id=$2",
          [options.runId, workspace.id],
        )
      ).rows[0]?.project_id
    : undefined;
  const project = await projectFor(
    pool,
    workspace.id,
    detailProject ?? workspace.project_id,
  );
  workspace = { ...workspace, project_id: project.id };
  const need = (...views: string[]) => full || views.includes(options.view!);
  const runFilter = options.runId
    ? " AND r.id=$2"
    : options.before
      ? " AND (r.created_at,r.id)<($2::timestamptz,$3::text)"
      : "";
  const runParams = options.runId
    ? [workspace.id, options.runId]
    : options.before
      ? [workspace.id, options.before.created_at, options.before.id]
      : [workspace.id];
  await ensureAccountAllowance(workspace.account_id);
  workspace = {
    ...workspace,
    ...(
      await pool.query("SELECT * FROM workspace_context WHERE id=$1", [
        workspace.id,
      ])
    ).rows[0],
  };
  Object.assign(
    workspace,
    (
      await pool.query(
        "SELECT run_credit_limit,run_token_limit,fallback_model_ids,context_strategy FROM workspaces WHERE id=$1",
        [workspace.id],
      )
    ).rows[0],
  );
  const q = (sql: string, params: unknown[] = [workspace.id]) => {
    if (!full) {
      const param = String.fromCharCode(36) + (params.length + 1);
      let changed = sql;
      for (const [marker, scope] of [
        ...(["overview", "tasks", "chat", "routines", "memory"].includes(
          options.view!,
        )
          ? [
              [
                "FROM agents WHERE workspace_id=$1",
                "kc_project_agent(" + param + ",id)",
              ],
            ]
          : []),
        [
          "FROM skills WHERE workspace_id=$1",
          "(project_id=" + param + " OR workspace_shared)",
        ],
        ["FROM runs r WHERE workspace_id=$1", "r.project_id=" + param],
        [
          "FROM tasks WHERE workspace_id=$1",
          "run_id IN(SELECT id FROM runs WHERE project_id=" + param + ")",
        ],
        ...(!["activity", "worklog"].includes(options.view!)
          ? [
              [
                "FROM events WHERE workspace_id=$1",
                "(run_id IN(SELECT id FROM runs WHERE project_id=" +
                  param +
                  ") OR (run_id IS NULL AND " +
                  param +
                  "=kc_default_project($1)))",
              ],
            ]
          : []),
        [
          "FROM artifacts WHERE workspace_id=$1",
          "run_id IN(SELECT id FROM runs WHERE project_id=" + param + ")",
        ],
        [
          "FROM attachments WHERE workspace_id=$1",
          "(project_id=" + param + " OR workspace_shared)",
        ],
        ["FROM chat_messages WHERE workspace_id=$1", "project_id=" + param],
      ])
        changed = changed.replace(marker, () => marker + " AND " + scope);
      if (changed !== sql) {
        sql = changed;
        params = [...params, project.id];
      }
    }
    return pool.query(sql, params).then((x) => x.rows);
  };
  const [
    agents,
    runs,
    tasks,
    events,
    skills,
    connections,
    workers,
    plans,
    provider,
    campaigns,
    hosted,
    artifacts,
    ledger,
    workspaces,
    models,
    attachments,
    chat,
  ] = await Promise.all([
    q(
      "SELECT * FROM agents WHERE workspace_id=$1 ORDER BY CASE role WHEN 'Koordination' THEN 0 ELSE 1 END,name",
    ),
    need("overview", "tasks", "chat", "memory")
      ? q(
          "SELECT r.*,to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS cursor_created_at,(SELECT COALESCE(sum(CASE WHEN m.status IN('reserved','uncertain') THEN m.reserved ELSE m.charged_credits END),0)::int FROM model_calls m WHERE m.run_id=r.id) AS credit_used,EXISTS(SELECT 1 FROM model_calls m WHERE m.run_id=r.id AND NOT m.usage_known) AS usage_uncertain FROM runs r WHERE workspace_id=$1" +
            runFilter +
            " ORDER BY created_at DESC,id DESC LIMIT 50",
          runParams,
        )
      : Promise.resolve([]),
    need("overview", "tasks")
      ? q(
          "SELECT id,run_id,workspace_id,agent_id,parent_id,title,instructions,status,result,error,worker_id,attempts,created_at FROM tasks WHERE workspace_id=$1 AND " +
            (options.runId
              ? "run_id=$2"
              : "run_id IN(SELECT r.id FROM runs r WHERE r.workspace_id=$1" +
                runFilter +
                " ORDER BY r.created_at DESC,r.id DESC LIMIT 50)") +
            " ORDER BY created_at" +
            (full ? "" : " LIMIT 2000"),
          runParams,
        )
      : Promise.resolve([]),
    need("overview", "tasks", "chat", "activity", "worklog")
      ? q(
          "SELECT * FROM events WHERE workspace_id=$1" +
            (options.runId ? " AND run_id=$2" : "") +
            " ORDER BY id DESC LIMIT 150",
          options.runId ? [workspace.id, options.runId] : [workspace.id],
        )
      : Promise.resolve([]),
    need("skills", "agents", "routines")
      ? q(
          "SELECT * FROM skills WHERE workspace_id=$1 ORDER BY name" +
            (full ? "" : " LIMIT 200"),
        )
      : Promise.resolve([]),
    q(
      "SELECT id,workspace_id,name,url,allowed_tools,enabled FROM connections WHERE workspace_id=$1 ORDER BY name",
    ),
    q(
      "SELECT id,name,concurrency,last_seen FROM workers ORDER BY last_seen DESC",
      [],
    ),
    q("SELECT * FROM plans WHERE active=true ORDER BY price_cents", []),
    q("SELECT name,endpoint,model FROM providers WHERE workspace_id=$1"),
    q(
      "SELECT * FROM campaigns WHERE active=true AND(expires_at IS NULL OR expires_at>now())",
      [],
    ),
    q("SELECT value FROM settings WHERE id='hosted_provider'", []),
    need("tasks") && (full || options.runId)
      ? q(
          "SELECT id,run_id,task_id,name," +
            (full ? "content" : "''::text AS content") +
            ",created_at FROM artifacts WHERE workspace_id=$1 AND NOT retired" +
            (options.runId ? " AND run_id=$2" : "") +
            " ORDER BY created_at DESC LIMIT 100",
          options.runId ? [workspace.id, options.runId] : [workspace.id],
        )
      : Promise.resolve([]),
    need("billing", "profile")
      ? q(
          "SELECT amount,reason,created_at FROM ledger WHERE workspace_id IN(SELECT id FROM workspaces WHERE owner_id=(SELECT owner_id FROM workspaces WHERE id=$1)) ORDER BY created_at DESC LIMIT 50",
        )
      : Promise.resolve([]),
    q(
      "SELECT v.* FROM workspace_context v WHERE owner_id=$1 OR EXISTS(SELECT 1 FROM workspace_members m WHERE m.workspace_id=v.id AND m.user_id=$1) ORDER BY created_at",
      [user.id],
    ),
    listModels(workspace.id),
    need("files", "tasks", "chat")
      ? q(
          "SELECT id,workspace_id,name,mime,source,bytes,created_at FROM attachments WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 200",
        )
      : Promise.resolve([]),
    need("chat")
      ? q(
          "SELECT * FROM(SELECT * FROM chat_messages WHERE workspace_id=$1 ORDER BY id DESC LIMIT 100) m ORDER BY id",
        )
      : Promise.resolve([]),
  ]);
  const memory = need("memory")
    ? await transaction((c) =>
        listMemory(c, workspace.id, "", false, full ? null : project.id),
      )
    : [];
  const period = new Date().toISOString().slice(0, 7);
  const model_usage = (
    await pool.query(
      "SELECT $2::text AS period,COALESCE((SELECT used FROM account_step_usage WHERE account_id=a.id AND period=$2),0) AS used,p.monthly_steps AS quota,p.max_parallel_tasks AS parallel FROM accounts a JOIN plans p ON p.id=a.plan_id WHERE a.id=$1",
      [workspace.account_id, period],
    )
  ).rows[0];
  return {
    user,
    project,
    projects: (
      await pool.query(
        "SELECT id,name,status,is_default FROM workspace_projects WHERE workspace_id=$1 ORDER BY is_default DESC,created_at",
        [workspace.id],
      )
    ).rows,
    page: {
      runs_next:
        runs.length === 50
          ? Buffer.from(
              JSON.stringify({
                created_at: runs.at(-1).cursor_created_at,
                id: runs.at(-1).id,
              }),
            ).toString("base64url")
          : null,
    },
    decision_count: Number(
      (
        await pool.query(
          "SELECT ((SELECT count(*) FROM tasks t JOIN runs r ON r.id=t.run_id WHERE t.workspace_id=$1 AND t.status='input_required' AND r.status NOT IN('completed','failed','canceled'))+(SELECT count(*) FROM content_posts WHERE workspace_id=$1 AND status='review'))::int n",
          [workspace.id],
        )
      ).rows[0].n,
    ),
    model_usage,
    workspace,
    plan:
      plans.find((p) => p.id === workspace.plan_id) ??
      (await pool.query("SELECT * FROM plans WHERE id=$1", [workspace.plan_id]))
        .rows[0],
    agents,
    runs,
    tasks,
    events,
    skills,
    connections,
    workers,
    plans,
    campaigns,
    provider: provider[0] ? { ...provider[0], configured: true } : null,
    managedAvailable: models.some((m) => m.workspace_id === null),
    stripeAvailable: (await publicSite()).billingEnabled,
    artifacts,
    ledger: workspace.owner_id === user.id ? ledger : [],
    workspaces,
    models,
    attachments,
    chat,
    memory,
  };
}
export async function providerFor(
  c: PoolClient,
  workspaceId: string,
  selected?: string | null,
): Promise<{ provider: Provider; managed: boolean; accountId: string }> {
  const accountId = (
    await c.query("SELECT account_id FROM workspace_context WHERE id=$1", [
      workspaceId,
    ])
  ).rows[0]?.account_id;
  if (accountId) await allocateAutomaticPlan(c, accountId);
  const w = (
    await c.query("SELECT * FROM workspace_context WHERE id=$1", [workspaceId])
  ).rows[0];
  let modelId = selected ?? w.default_model_id;
  if (!modelId)
    modelId = (
      await c.query(
        "SELECT id FROM model_offerings WHERE active=true AND CASE WHEN $2='managed' THEN workspace_id IS NULL ELSE workspace_id=$1 END ORDER BY created_at LIMIT 1",
        [workspaceId, w.ai_mode],
      )
    ).rows[0]?.id;
  if (!modelId)
    throw new HttpError(
      409,
      "Kein aktives KI-Modell verfügbar. Aktiviere oder verbinde ein Modell unter „KI & Modelle“.",
    );
  const m = await validateModel(c, workspaceId, modelId);
  const managed = m.workspace_id === null;
  if (
    managed &&
    w.credits <= 0 &&
    (Number(m.input_rate) > 0 ||
      Number(m.output_rate) > 0 ||
      m.base_credits > 0)
  )
    throw new HttpError(402, "KI-Guthaben aufgebraucht.");
  return {
    provider: { ...m, secret: decrypt(m.secret) },
    managed,
    accountId: w.account_id,
  };
}
export async function bindAttachments(
  c: PoolClient,
  workspaceId: string,
  runId: string,
  ids: string[],
) {
  const unique = [...new Set(ids)];
  if (unique.length > 20)
    throw new HttpError(400, "Maximal 20 Anhänge pro Nachricht oder Auftrag.");
  if (
    unique.length &&
    (
      await c.query(
        "SELECT id FROM attachments WHERE id=ANY($1::text[]) AND workspace_id=$2 AND (workspace_shared OR project_id=(SELECT project_id FROM runs WHERE id=$3))",
        [unique, workspaceId, runId],
      )
    ).rowCount !== unique.length
  )
    throw new HttpError(403, "Anhang gehört nicht zu diesem Workspace.");
  for (const id of unique)
    await c.query(
      "INSERT INTO run_attachments(run_id,attachment_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [runId, id],
    );
}
export async function createRun(
  workspace: Workspace,
  goal: string,
  agentId: string,
  attachmentIds: string[] = [],
  chat = false,
  recipients: string[] = [agentId],
  history = "",
  limits: {
    projectId?: string;
    planItemId?: string;
    tokenLimit?: number;
    creditLimit?: number;
    automation?: { triggerId: string; revision: number };
    quality?: { caseId: string; modelId: string };
    userBudget?: boolean;
    workMode?: "draft" | "execute" | "team";
  } = {},
) {
  return transaction(async (c) => {
    if (limits.quality) {
      const q = (
        await c.query(
          "SELECT q.run_id,e.status FROM quality_cases q JOIN quality_evaluations e ON e.id=q.evaluation_id WHERE q.id=$1 AND e.workspace_id=$2 AND e.model_id=$3 FOR UPDATE OF e,q",
          [limits.quality.caseId, workspace.id, limits.quality.modelId],
        )
      ).rows[0];
      if (!q || !["queued", "running"].includes(q.status))
        throw new HttpError(409, "Evaluation canceled or unavailable");
      if (q.run_id) return { id: q.run_id };
    }
    let automation: any = null;
    if (limits.automation) {
      const account = (
        await c.query(
          "SELECT ac.id,p.max_automations,p.automation_runs FROM accounts ac JOIN workspaces w ON w.owner_id=ac.owner_id JOIN plans p ON p.id=ac.plan_id WHERE w.id=$1 FOR UPDATE OF ac",
          [workspace.id],
        )
      ).rows[0];
      const trigger = (
        await c.query(
          "SELECT t.run_id,t.id trigger_id,a.* FROM automation_triggers t JOIN automations a ON a.id=t.automation_id WHERE t.id=$1 AND a.workspace_id=$2 FOR UPDATE OF t,a",
          [limits.automation.triggerId, workspace.id],
        )
      ).rows[0];
      if (trigger?.run_id) return { id: trigger.run_id };
      const allowed = (
        await c.query(
          "SELECT a.id FROM automations a JOIN workspaces w ON w.id=a.workspace_id WHERE w.owner_id=(SELECT owner_id FROM workspaces WHERE id=$1) ORDER BY a.created_at,a.id LIMIT $2",
          [workspace.id, account.max_automations],
        )
      ).rows;
      if (!allowed.some((a) => a.id === trigger?.id))
        throw new HttpError(402, "Automationslimit erreicht.");
      const used = Number(
        (
          await c.query(
            "SELECT calls FROM automation_usage WHERE account_id=$1 AND period=to_char(now() AT TIME ZONE 'UTC','YYYY-MM')",
            [account.id],
          )
        ).rows[0]?.calls ?? 0,
      );
      if (used >= account.automation_runs)
        throw new HttpError(
          402,
          "Monatliches Automationskontingent ausgeschöpft.",
        );
      await c.query(
        "INSERT INTO automation_usage(account_id,period,calls) VALUES($1,to_char(now() AT TIME ZONE 'UTC','YYYY-MM'),1) ON CONFLICT(account_id,period) DO UPDATE SET calls=automation_usage.calls+1",
        [account.id],
      );
      if (
        !trigger?.enabled ||
        trigger.revision !== limits.automation.revision ||
        trigger.agent_id !== agentId
      )
        throw new HttpError(409, "Automation wurde geändert oder pausiert.");
      const skill = (
        await c.query(
          "SELECT s.version FROM skills s JOIN agents a ON a.id=$3 WHERE s.id=$1 AND s.workspace_id=$2 AND s.status='approved' AND a.workspace_id=$2 AND a.skill_ids ? s.id",
          [trigger.skill_id, workspace.id, agentId],
        )
      ).rows[0];
      if (!skill || skill.version !== trigger.skill_version)
        throw new HttpError(
          409,
          "Skill wurde geändert oder ist nicht mehr freigegeben. Automation erneut speichern.",
        );
      automation = trigger;
      limits = {
        ...limits,
        tokenLimit: trigger.token_limit,
        creditLimit: trigger.credit_limit,
      };
      goal = `Automation: ${trigger.name}\n${trigger.goal}\nVerwende freigegebenen Skill ${trigger.skill_id}, Version ${trigger.skill_version}.`;
    }
    const w = (
      await c.query("SELECT * FROM workspace_context WHERE id=$1", [
        workspace.id,
      ])
    ).rows[0];
    const control = (
      await c.query(
        "SELECT execution_paused FROM workspaces WHERE id=$1 FOR UPDATE",
        [w.id],
      )
    ).rows[0];
    if (control.execution_paused)
      throw new HttpError(
        409,
        "Der Workspace ist gestoppt. Bitte zuerst fortsetzen.",
      );
    const active = (
      await c.query(
        "SELECT count(*) FROM runs WHERE workspace_id=$1 AND status IN('running','paused','input_required')",
        [w.id],
      )
    ).rows[0];
    if (Number(active.count) >= 3)
      throw new HttpError(409, "Maximal drei offene Aufträge pro Workspace.");
    const targets = [...new Set(recipients)];
    if (!targets.length || targets.length > 10)
      throw new HttpError(400, "Bitte ein bis zehn Empfänger auswählen.");
    const plan = (await c.query("SELECT * FROM plans WHERE id=$1", [w.plan_id]))
      .rows[0];
    const project = await projectFor(
      c,
      w.id,
      limits.projectId ?? automation?.project_id ?? workspace.project_id,
    );
    await assertProjectRun(c, w.id, project.id, targets);
    const id = randomUUID();
    await c.query(
      "INSERT INTO runs(id,workspace_id,goal,max_steps,chat) VALUES($1,$2,$3,$4,$5)",
      [id, w.id, goal, plan.max_steps, chat],
    );
    await c.query("UPDATE runs SET project_id=$2 WHERE id=$1", [
      id,
      project.id,
    ]);
    await bindPlanRun(c, project.id, limits.planItemId, id, agentId);
    await bindAttachments(c, w.id, id, attachmentIds);
    const primaries: string[] = [];
    for (const a of (
      await c.query("SELECT id,model_id FROM agents WHERE workspace_id=$1", [
        w.id,
      ])
    ).rows) {
      try {
        const { provider } = await providerFor(
          c,
          w.id,
          limits.quality?.modelId ?? a.model_id,
        );
        primaries.push(provider.id!);
      } catch (error) {
        if (targets.includes(a.id)) throw error;
      }
    }
    const budget = await snapshotRunPolicy(c, w.id, primaries);
    if (limits.quality) budget.policy.fallbacks = [];
    if (
      limits.userBudget &&
      ((limits.tokenLimit ?? 0) > budget.token_limit ||
        (limits.creditLimit ?? 0) > budget.credit_limit)
    )
      throw new HttpError(
        409,
        "Workspace-Standardlimits wurden geändert. Budget erneut prüfen.",
      );
    for (const v of [limits.tokenLimit, limits.creditLimit])
      if (v !== undefined && (!Number.isSafeInteger(v) || v < 0))
        throw new HttpError(400, "Ungültiges Auftragslimit.");
    budget.token_limit = Math.min(
      budget.token_limit,
      limits.tokenLimit ?? Infinity,
    );
    budget.credit_limit = Math.min(
      budget.credit_limit,
      limits.creditLimit ?? Infinity,
    );

    await c.query(
      "UPDATE runs SET credit_limit=$2,token_limit=$3,model_policy=$4 WHERE id=$1",
      [
        id,
        budget.credit_limit,
        budget.token_limit,
        JSON.stringify({
          ...budget.policy,
          ...(limits.quality
            ? { quality_model_id: limits.quality.modelId }
            : {}),
          ...(automation
            ? {
                automation: {
                  id: automation.id,
                  mode: automation.mode,
                  skill_id: automation.skill_id,
                  skill_version: automation.skill_version,
                },
              }
            : {}),
          work_mode: limits.workMode,
          autonomy_version: 1,
          delivery_bundle:
            targets.length === 1 &&
            attachmentIds.length === 0 &&
            /(erstelle|entwickle|create|build)/i.test(goal) &&
            /(website|webseite|landingpage|landing page)/i.test(goal) &&
            /(eigenst(?:ä|ae)ndig|standalone|statisch|static|dateipaket|single.?file)/i.test(
              goal,
            ) &&
            (
              await c.query(
                "SELECT 1 FROM agents WHERE id=$1 AND mcp_ids='[]'::jsonb AND skill_ids='[]'::jsonb",
                [targets[0]],
              )
            ).rowCount === 1,
        }),
      ],
    );

    for (const target of targets) {
      const agent = (
        await c.query("SELECT * FROM agents WHERE id=$1 AND workspace_id=$2", [
          target,
          w.id,
        ])
      ).rows[0];
      if (!agent) throw new HttpError(404, "Agent nicht gefunden.");
      if (agent.execution_paused)
        throw new HttpError(409, "Dieser Agent ist gestoppt.");
      const { provider } = await providerFor(
        c,
        w.id,
        limits.quality?.modelId ?? agent.model_id,
      );
      await c.query(
        "INSERT INTO tasks(id,run_id,workspace_id,agent_id,title,instructions,model_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          randomUUID(),
          id,
          w.id,
          target,
          goal.slice(0, 100),
          history
            ? `${goal}\nBisheriger Teamchat (Kontextdaten):\n${history}`
            : goal,
          provider.id,
        ],
      );
    }
    if (limits.planItemId)
      await c.query(
        "UPDATE tasks SET plan_item_id=$2 WHERE run_id=$1 AND parent_id IS NULL",
        [id, limits.planItemId],
      );
    if (limits.quality)
      await c.query(
        "UPDATE quality_cases SET run_id=$2,status='running' WHERE id=$1",
        [limits.quality.caseId, id],
      );
    if (automation) {
      if (automation.mode !== "agent")
        await c.query("UPDATE tasks SET messages=$2 WHERE run_id=$1", [
          id,
          JSON.stringify([
            {
              role: "system",
              content:
                "Nutzerfreigegebene Automation; kein modellgenerierter Plan.",
            },
            { role: "user", content: goal },
            {
              role: "assistant",
              content:
                "Gespeichertes, vom Nutzer freigegebenes Rezept ausführen. Diese Planung hat keinen Modellaufruf verwendet.",
              tool_calls: [
                {
                  id: "automation-recipe",
                  type: "function",
                  function: {
                    name: "tool_pipeline",
                    arguments: JSON.stringify(automation.recipe),
                  },
                },
              ],
            },
          ]),
        ]);
      await c.query(
        "UPDATE automation_triggers SET status='started',run_id=$2 WHERE id=$1",
        [automation.trigger_id, id],
      );
    }
    await event(
      c,
      w.id,
      id,
      agentId,
      "created",
      automation
        ? "Nutzerfreigegebene Automation zur Ausführung bereit."
        : "Auftrag angelegt und zur Ausführung bereit.",
    );
    if (chat)
      await c.query(
        "INSERT INTO chat_messages(workspace_id,run_id,author,content,attachment_ids) VALUES($1,$2,'Du',$3,$4)",
        [w.id, id, goal, JSON.stringify(attachmentIds)],
      );
    return { id };
  });
}
export async function changeRun(
  workspaceId: string,
  runId: string,
  action: "pause" | "resume" | "cancel",
) {
  return transaction((c) =>
    changeRunInTransaction(c, workspaceId, runId, action),
  );
}
export async function changeRunInTransaction(
  c: PoolClient,
  workspaceId: string,
  runId: string,
  action: "pause" | "resume" | "cancel",
) {
  const r = (
    await c.query(
      "SELECT * FROM runs WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
      [runId, workspaceId],
    )
  ).rows[0];
  if (!r) throw new HttpError(404, "Auftrag nicht gefunden.");
  if (["completed", "failed", "canceled"].includes(r.status))
    throw new HttpError(409, "Dieser Auftrag ist bereits beendet.");
  if (
    action === "resume" &&
    (
      await c.query("SELECT execution_paused FROM workspaces WHERE id=$1", [
        workspaceId,
      ])
    ).rows[0]?.execution_paused
  )
    throw new HttpError(409, "Workspace zuerst fortsetzen.");
  const status = { pause: "paused", resume: "running", cancel: "canceled" }[
    action
  ];
  await c.query(
    "UPDATE runs SET status=$1,paused_by_workspace=false,updated_at=now() WHERE id=$2",
    [status, runId],
  );
  // Invalidate active leases. Existing requests may finish upstream but cannot execute another action.
  await c.query(
    "UPDATE tasks SET status=CASE WHEN $2='cancel' THEN 'canceled' WHEN status='running' THEN 'queued' ELSE status END,lease_token=null,worker_id=null,lease_until=null WHERE run_id=$1 AND status NOT IN('completed','failed','canceled')",
    [runId, action],
  );
  await event(
    c,
    workspaceId,
    runId,
    null,
    action,
    `Auftrag ${action === "pause" ? "pausiert" : action === "resume" ? "fortgesetzt" : "abgebrochen"}.`,
  );
}
export async function recoverExpiredTasks(c: PoolClient, run: Run) {
  const expired = (
    await c.query(
      "SELECT * FROM tasks WHERE run_id=$1 AND status='running' AND lease_until<now() ORDER BY created_at FOR UPDATE",
      [run.id],
    )
  ).rows as Task[];
  for (const task of expired) {
    const pending = (
      await c.query(
        "SELECT o.*,j.id AS job_id,j.tool,j.args,j.status AS job_status,j.result AS job_result FROM operations o LEFT JOIN environment_tool_calls j ON j.operation_id=o.id WHERE o.task_id=$1 AND o.status<>'done' FOR UPDATE OF o",
        [task.id],
      )
    ).rows;
    let uncertain = false;
    for (const op of pending) {
      // A staged bundle only contains our transactional artifact references.
      // It can be resumed without repeating any external effect.
      if (
        op.tool_name === "deliver_artifacts" &&
        op.arguments_hash &&
        Array.isArray(op.result?.files) &&
        typeof op.result?.html === "string" &&
        Number.isFinite(op.result?.after_event)
      )
        continue;
      if (op.tool_name === "validate_artifact") {
        // This browser is isolated from the network and customer containers.
        // Preserve an interrupted receipt; the next bounded check needs a new ID.
        const result = JSON.stringify({
          ok: false,
          passed: false,
          code: "LOCAL_VALIDATION_INTERRUPTED",
          guidance:
            "Lokale Browserprüfung beim Neustart unterbrochen. Gespeicherte Dateien behalten und mit neuem Aufruf prüfen; keinen Erfolg behaupten.",
        });
        await c.query(
          "UPDATE operations SET status='done',result=$2,failed=true,recorded_at=now() WHERE id=$1",
          [op.id, JSON.stringify({ result, yield: false, isError: true })],
        );
        continue;
      }
      if (op.job_id && op.job_status === "done") {
        await c.query(
          "UPDATE operations SET status='done',result=$2 WHERE id=$1",
          [
            op.id,
            JSON.stringify({
              result: JSON.stringify(op.job_result).slice(0, 30000),
              yield: false,
              isError: op.job_result?.ok === false,
            }),
          ],
        );
        continue;
      }
      const readOnly =
        op.tool === "environment_read_file" ||
        (op.tool === "environment_browser" &&
          ["snapshot", "tabs"].includes(op.args?.action));
      if (!readOnly) {
        uncertain = true;
        continue;
      }
      await c.query(
        "UPDATE environment_tool_calls SET status='canceled',finished_at=now() WHERE id=$1 AND status IN('queued','running')",
        [op.job_id],
      );
      await c.query(
        "UPDATE operations SET status='done',result=$2 WHERE id=$1",
        [
          op.id,
          JSON.stringify({
            result: JSON.stringify({
              ok: false,
              code: "READ_INTERRUPTED",
              executed: false,
              guidance:
                "Lesender Zugriff unterbrochen. Aktuellen Zustand mit einem neuen lesenden Aufruf prüfen.",
            }),
            yield: false,
            isError: true,
          }),
        ],
      );
    }
    let reason = uncertain
      ? "Eine externe Aktion hat kein bestätigtes Ergebnis. Zustand vor dem Fortsetzen prüfen; keine automatische Wiederholung."
      : "";
    if ((task.recovery_attempts ?? 0) >= 3)
      reason =
        "Drei automatische Wiederaufnahmen waren erfolglos. Verbindung und Arbeitsstand bitte prüfen.";
    if (!reason) {
      const active = (
        await c.query(
          "SELECT 1 FROM model_calls WHERE task_id=$1 AND status='reserved' AND heartbeat_at>now()-interval '45 seconds' LIMIT 1",
          [task.id],
        )
      ).rowCount;
      // The old app may still be settling an interrupted provider request. Never overlap it.
      if (active) continue;
      const staleIds = (
        await c.query(
          "SELECT id FROM model_calls WHERE task_id=$1 AND status='reserved' FOR UPDATE SKIP LOCKED",
          [task.id],
        )
      ).rows.map((r) => r.id);
      if (
        (
          await c.query(
            "SELECT count(*)::int n FROM model_calls WHERE task_id=$1 AND status='reserved'",
            [task.id],
          )
        ).rows[0].n !== staleIds.length
      )
        continue;
      const stale = (
        await c.query(
          "UPDATE model_calls SET status='uncertain',outcome='error',charged_credits=CASE WHEN managed THEN reserved ELSE 0 END WHERE id=ANY($1::text[]) AND status='reserved' RETURNING *",
          [staleIds],
        )
      ).rows;
      for (const call of stale)
        if (call.managed)
          await c.query(
            "INSERT INTO ledger(id,workspace_id,amount,reason) VALUES($1,$2,$3,'Unterbrochener Modellaufruf: Verbrauch unklar; bestehende Reservierung bleibt bestehen.') ON CONFLICT(id) DO NOTHING",
            [call.id, task.workspace_id, -call.reserved],
          );
      if (stale.length && !mayRetryModel(task.messages))
        reason =
          "Ein unterbrochener Modellaufruf wurde bereits automatisch wiederholt. Anbieter und Verbrauch bitte prüfen.";
      else if (stale.length)
        task.messages.push({
          role: "user",
          content:
            "Modellverarbeitung beim Neustart unterbrochen. Setze mit einem kurzen gezielten Schritt fort. Bereits ausgeführte externe Aktionen nicht wiederholen.",
          recovery_code: "MODEL_RESTART",
        });
    }
    await c.query(
      "UPDATE tasks SET status=$2,error=$3,messages=$4,lease_token=NULL,lease_until=NULL,worker_id=NULL,recovery_attempts=recovery_attempts+$5 WHERE id=$1",
      [
        task.id,
        reason ? "input_required" : "queued",
        reason || null,
        JSON.stringify(task.messages),
        reason ? 0 : 1,
      ],
    );
    await event(
      c,
      task.workspace_id,
      task.run_id,
      task.agent_id,
      reason ? "input_required" : "recovery",
      reason ||
        "Aufgabe nach Verbindungsabbruch automatisch am bestätigten Arbeitsstand fortgesetzt. Gespeicherte Ergebnisse werden wiederverwendet.",
    );
  }
}
export async function claim(workerId: string) {
  return transaction(async (c) => {
    const worker = (
      await c.query("SELECT draining FROM workers WHERE id=$1 FOR UPDATE", [
        workerId,
      ])
    ).rows[0];
    if (worker?.draining) return null;
    const run = (
      await c.query(
        "SELECT r.* FROM runs r JOIN workspaces w ON w.id=r.workspace_id JOIN users u ON u.id=w.owner_id JOIN accounts ac ON ac.owner_id=w.owner_id JOIN plans p ON p.id=ac.plan_id WHERE r.status='running' AND EXISTS(SELECT 1 FROM workspace_projects pp WHERE pp.id=r.project_id AND pp.status='active') AND (r.plan_item_id IS NULL OR kc_plan_ready(r.plan_item_id)) AND NOT w.execution_paused AND u.suspended=false AND (ac.access_expires_at IS NULL OR ac.access_expires_at>now()) AND (SELECT count(*) FROM tasks live JOIN workspaces lw ON lw.id=live.workspace_id JOIN runs lr ON lr.id=live.run_id WHERE lw.owner_id=w.owner_id AND lr.status='running' AND live.status='running' AND live.lease_until>now())<p.max_parallel_tasks AND EXISTS(SELECT 1 FROM tasks t JOIN agents a ON a.id=t.agent_id WHERE t.run_id=r.id AND NOT a.execution_paused AND kc_project_agent(r.project_id,a.id) AND (t.plan_item_id IS NULL OR kc_plan_ready(t.plan_item_id)) AND((t.status='queued' AND (t.not_before IS NULL OR t.not_before<=now())) OR(t.status='running' AND t.lease_until<now()))) ORDER BY r.created_at FOR UPDATE OF r SKIP LOCKED LIMIT 1",
      )
    ).rows[0] as Run | undefined;
    if (!run) return null;
    const account = (
      await c.query(
        "SELECT ac.*,p.max_parallel_tasks FROM accounts ac JOIN workspaces w ON w.owner_id=ac.owner_id JOIN plans p ON p.id=ac.plan_id WHERE w.id=$1 FOR UPDATE OF ac",
        [run.workspace_id],
      )
    ).rows[0];
    const live = (
      await c.query(
        "SELECT count(*)::int n FROM tasks t JOIN workspaces w ON w.id=t.workspace_id JOIN runs r ON r.id=t.run_id WHERE w.owner_id=$1 AND r.status='running' AND t.status='running' AND t.lease_until>now()",
        [account.owner_id],
      )
    ).rows[0].n;
    if (live >= account.max_parallel_tasks) return null;
    await recoverExpiredTasks(c, run);
    const task = (
      await c.query(
        "SELECT t.* FROM tasks t JOIN agents a ON a.id=t.agent_id WHERE t.run_id=$1 AND t.status='queued' AND (t.not_before IS NULL OR t.not_before<=now()) AND NOT a.execution_paused AND kc_project_agent((SELECT project_id FROM runs WHERE id=t.run_id),a.id) AND (t.plan_item_id IS NULL OR kc_plan_ready(t.plan_item_id)) ORDER BY t.created_at FOR UPDATE OF t SKIP LOCKED LIMIT 1",
        [run.id],
      )
    ).rows[0] as Task | undefined;
    if (!task) return null;
    await c.query(
      "UPDATE project_plan_items SET status='in_progress',revision=revision+1 WHERE id=$1 AND status='ready'",
      [task.plan_item_id ?? run.plan_item_id ?? null],
    );
    const lease = randomUUID();
    const result = (
      await c.query(
        "UPDATE tasks SET status='running',worker_id=$2,lease_token=$3,lease_until=now()+interval '90 seconds',attempts=attempts+1,started_at=coalesce(started_at,now()),finished_at=NULL WHERE id=$1 RETURNING *",
        [task.id, workerId, lease],
      )
    ).rows[0];
    await event(
      c,
      task.workspace_id,
      run.id,
      task.agent_id,
      "started",
      `Bearbeitet: ${task.title}`,
    );
    return { task: result, goal: run.goal };
  });
}
export async function lockTask(c: PoolClient, taskId: string, lease: string) {
  const row = (await c.query("SELECT run_id FROM tasks WHERE id=$1", [taskId]))
    .rows[0];
  if (!row) throw new HttpError(404, "Aufgabe fehlt.");
  const run = (
    await c.query("SELECT * FROM runs WHERE id=$1 FOR UPDATE", [row.run_id])
  ).rows[0] as Run;
  const task = (
    await c.query(
      "SELECT * FROM tasks WHERE id=$1 AND lease_token=$2 AND lease_until>now() AND status='running' FOR UPDATE",
      [taskId, lease],
    )
  ).rows[0] as Task | undefined;
  const owner = await c.query(
    "SELECT u.suspended,(a.access_expires_at IS NOT NULL AND a.access_expires_at<=now()) AS access_expired,w.execution_paused,(SELECT execution_paused FROM agents WHERE id=$2) AS agent_paused FROM workspaces w JOIN users u ON u.id=w.owner_id JOIN accounts a ON a.owner_id=w.owner_id WHERE w.id=$1",
    [run.workspace_id, task?.agent_id],
  );
  if (
    !task ||
    run.status !== "running" ||
    owner.rows[0]?.suspended ||
    owner.rows[0]?.access_expired ||
    owner.rows[0]?.execution_paused ||
    owner.rows[0]?.agent_paused
  )
    throw new HttpError(
      409,
      "Ausführung wurde angehalten oder an einen anderen Worker übergeben.",
    );
  if (
    !(
      await c.query(
        "SELECT 1 FROM workspace_projects p WHERE p.id=$1 AND p.status='active' AND kc_project_agent(p.id,$2)",
        [run.project_id, task.agent_id],
      )
    ).rowCount
  )
    throw new HttpError(
      409,
      "Projekt ist gestoppt oder Agentenzuordnung wurde entzogen.",
    );
  return { task, run };
}
export async function finishTask(
  c: PoolClient,
  task: Task,
  status: string,
  result: string,
) {
  await c.query(
    "UPDATE tasks SET status=$2,result=$3,error=NULL,lease_token=null,worker_id=null,lease_until=null,finished_at=now() WHERE id=$1",
    [task.id, status, result],
  );
  await event(
    c,
    task.workspace_id,
    task.run_id,
    task.agent_id,
    status,
    result.slice(0, 3000),
  );
  const chat = (
    await c.query("SELECT chat FROM runs WHERE id=$1", [task.run_id])
  ).rows[0]?.chat;
  if (chat) {
    const agent = (
      await c.query("SELECT name FROM agents WHERE id=$1", [task.agent_id])
    ).rows[0];
    await c.query(
      "INSERT INTO chat_messages(workspace_id,run_id,agent_id,author,content) VALUES($1,$2,$3,$4,$5)",
      [
        task.workspace_id,
        task.run_id,
        task.agent_id,
        agent?.name ?? "Agent",
        status === "failed" ? `Fehler: ${result}` : result,
      ],
    );
  }
  await c.query(
    "UPDATE project_plan_items SET status=$2,revision=revision+1 WHERE task_id=$1",
    [task.id, status === "completed" ? "done" : "blocked"],
  );
  if (task.parent_id) {
    const siblings = await c.query(
      "SELECT id FROM tasks WHERE parent_id=$1 AND status NOT IN('completed','failed','canceled')",
      [task.parent_id],
    );
    if (!siblings.rowCount) {
      const parent = (
        await c.query("SELECT * FROM tasks WHERE id=$1 AND status='waiting'", [
          task.parent_id,
        ])
      ).rows[0] as Task | undefined;
      if (parent) {
        const children = (
          await c.query(
            "SELECT title,status,result,error FROM tasks WHERE parent_id=$1 ORDER BY created_at",
            [parent.id],
          )
        ).rows;
        const messages = [
          ...parent.messages,
          {
            role: "user",
            content: `Delegierte Aufgaben sind beendet. Prüfe diese Ergebnisse und arbeite weiter:\n${JSON.stringify(children)}`,
          },
        ];
        await c.query(
          "UPDATE tasks SET status='queued',messages=$2 WHERE id=$1",
          [parent.id, JSON.stringify(messages)],
        );
      }
    }
  }
  const open = await c.query(
    "SELECT id FROM tasks WHERE run_id=$1 AND status NOT IN('completed','failed','canceled')",
    [task.run_id],
  );
  if (!open.rowCount) {
    const failed = await c.query(
      "SELECT id FROM tasks WHERE run_id=$1 AND status='failed'",
      [task.run_id],
    );
    await c.query("UPDATE runs SET status=$2,updated_at=now() WHERE id=$1", [
      task.run_id,
      failed.rowCount ? "failed" : "completed",
    ]);
    await c.query(
      "UPDATE project_plan_items SET status=$2,revision=revision+1 WHERE run_id=$1",
      [task.run_id, failed.rowCount ? "blocked" : "done"],
    );
    await rememberFinishedRun(c, task.workspace_id, task.run_id);
    if (!failed.rowCount) {
      await proposeRunSkill(c, task.workspace_id, task.run_id);
      if (
        (
          await c.query(
            "SELECT 1 FROM artifacts WHERE run_id=$1 AND NOT retired",
            [task.run_id],
          )
        ).rowCount &&
        Number(
          (
            await c.query(
              "SELECT count(*) FROM run_checkpoints WHERE run_id=$1",
              [task.run_id],
            )
          ).rows[0].count,
        ) < 10
      )
        await captureRunCheckpoint(
          c,
          task.workspace_id,
          task.run_id,
          "Abgeschlossener Auftrag",
        );
    }
  }
}
