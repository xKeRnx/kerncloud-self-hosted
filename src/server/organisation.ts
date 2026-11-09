import { toolArgumentsHash } from "../core/agent-loops.ts";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import type { PoolClient } from "pg";
import { pool, transaction, audit } from "./db.ts";
import { HttpError } from "./auth.ts";
import { workspaceRole } from "./team.ts";
import { validateModel } from "./catalog.ts";
import {
  projectInput,
  planInput,
  hireInput,
  assertAcyclic,
  assertDependencies,
} from "../core/organisation.ts";
type DB = Pick<PoolClient, "query">;
export async function projectFor(
  db: DB,
  workspace: string,
  id?: string | null,
) {
  const p = (
    await db.query(
      "SELECT * FROM workspace_projects WHERE workspace_id=$1 AND " +
        (id ? "id=$2" : "is_default"),
      id ? [workspace, id] : [workspace],
    )
  ).rows[0];
  if (!p) throw new HttpError(404, "Projekt gehört nicht zu diesem Workspace.");
  return p;
}
export async function assertProjectAgent(
  db: DB,
  project: string,
  agent: string,
) {
  if (
    !(await db.query("SELECT kc_project_agent($1,$2) ok", [project, agent]))
      .rows[0]?.ok
  )
    throw new HttpError(403, "Agent ist diesem Projekt nicht zugeordnet.");
}
export async function assertProjectRun(
  db: DB,
  workspace: string,
  project: string,
  agents: string[],
) {
  const p = await projectFor(db, workspace, project);
  if (p.status !== "active")
    throw new HttpError(409, "Projekt ist nicht aktiv.");
  for (const a of agents) await assertProjectAgent(db, p.id, a);
  return p;
}
async function manage(actor: string, workspace: string) {
  if (!["owner", "admin"].includes(await workspaceRole(actor, workspace)))
    throw new HttpError(403, "Workspace-Administration erforderlich.");
}
async function change(
  c: DB,
  w: string,
  actor: string,
  kind: string,
  details: unknown,
) {
  await c.query(
    "INSERT INTO organisation_changes(workspace_id,actor,kind,details) VALUES($1,$2,$3,$4)",
    [w, actor, kind, JSON.stringify(details)],
  );
}
async function settings(c: DB, w: string, lock = false) {
  return (
    await c.query(
      "SELECT * FROM organisation_settings WHERE workspace_id=$1" +
        (lock ? " FOR UPDATE" : ""),
      [w],
    )
  ).rows[0];
}
export async function organisationData(
  workspace: string,
  project?: string | null,
  section = "all",
) {
  const p = await projectFor(pool, workspace, project);
  const scopedQuery = (view: string, sql: string, values: unknown[]) =>
    section === "all" || section === view
      ? pool.query(sql, values)
      : Promise.resolve({ rows: [] });
  const [projects, agents, policy, items, periods, environments, history] =
    await Promise.all([
      scopedQuery(
        "projects",
        `SELECT p.*,(SELECT count(*)::int FROM runs WHERE project_id=p.id) runs,(SELECT count(*)::int FROM runs WHERE project_id=p.id AND status='completed') completed,(SELECT coalesce(sum(CASE WHEN m.status IN('reserved','uncertain') THEN m.reserved ELSE m.charged_credits END),0) FROM model_calls m JOIN runs r ON r.id=m.run_id WHERE r.project_id=p.id) credit_used FROM workspace_projects p WHERE workspace_id=$1 ORDER BY is_default DESC,created_at`,
        [workspace],
      ),
      pool.query(
        "SELECT id,name,role,color,model_id,manager_id,structure_locked,can_manage,execution_paused,monthly_credit_limit FROM agents WHERE workspace_id=$1 ORDER BY name",
        [workspace],
      ),
      settings(pool, workspace),
      scopedQuery(
        "timeline",
        `SELECT i.*,coalesce(pt.status,r.status) run_status,r.tokens_used,coalesce(pt.started_at,r.created_at) actual_start,coalesce(pt.finished_at,r.updated_at) actual_end FROM project_plan_items i LEFT JOIN runs r ON r.id=i.run_id LEFT JOIN tasks pt ON pt.id=i.task_id WHERE i.workspace_id=$1 AND i.project_id=$2 ORDER BY i.planned_start NULLS LAST,i.created_at LIMIT 300`,
        [workspace, p.id],
      ),
      scopedQuery(
        "timeline",
        `WITH recent AS(SELECT t.id,t.run_id,t.agent_id,t.parent_id,t.title,t.status,t.started_at,t.finished_at,r.created_at,r.updated_at,r.tokens_used FROM tasks t JOIN runs r ON r.id=t.run_id WHERE t.workspace_id=$1 AND r.project_id=$2 AND r.created_at>now()-interval '31 days' ORDER BY r.created_at DESC,t.created_at DESC LIMIT 300) SELECT t.id,t.run_id,t.agent_id,t.parent_id,t.title,t.status,coalesce(t.started_at,e.started_at) started_at,coalesce(t.finished_at,e.ended_at) ended_at,t.created_at,t.updated_at,t.tokens_used FROM recent t LEFT JOIN LATERAL(SELECT min(created_at) FILTER(WHERE kind='started') started_at,max(created_at) FILTER(WHERE kind IN('completed','failed','input_required')) ended_at FROM events WHERE run_id=t.run_id AND agent_id=t.agent_id AND kind IN('started','completed','failed','input_required') AND(t.started_at IS NULL OR t.finished_at IS NULL)) e ON true ORDER BY t.created_at DESC`,
        [workspace, p.id],
      ),
      scopedQuery(
        "projects",
        "SELECT id,name,project_id,status FROM customer_environments WHERE workspace_id=$1 AND status<>'deleted' ORDER BY name",
        [workspace],
      ),
      scopedQuery(
        "organisation",
        "SELECT actor,kind,created_at FROM organisation_changes WHERE workspace_id=$1 ORDER BY id DESC LIMIT 50",
        [workspace],
      ),
    ]);
  const stats =
    section === "all" || section === "projects"
      ? (
          await pool.query(
            `SELECT
      (SELECT count(*)::int FROM runs WHERE workspace_id=$1 AND project_id=$2) runs,
      (SELECT count(*)::int FROM runs WHERE workspace_id=$1 AND project_id=$2 AND status='completed') completed,
      (SELECT count(*)::int FROM runs WHERE workspace_id=$1 AND project_id=$2 AND status='running') running,
      (SELECT count(*)::int FROM runs WHERE workspace_id=$1 AND project_id=$2 AND status IN('paused','input_required')) waiting,
      (SELECT count(*)::int FROM runs WHERE workspace_id=$1 AND project_id=$2 AND status='failed') failed,
      (SELECT count(*)::int FROM runs WHERE workspace_id=$1 AND project_id=$2 AND status='canceled') canceled,
      (SELECT count(*)::int FROM attachments WHERE workspace_id=$1 AND project_id=$2) files,
      (SELECT count(*)::int FROM artifacts ar JOIN runs r ON r.id=ar.run_id WHERE r.workspace_id=$1 AND r.project_id=$2) artifacts,
      (SELECT count(*)::int FROM memories WHERE workspace_id=$1 AND project_id=$2) memories,
      (SELECT count(*)::int FROM agents WHERE workspace_id=$1 AND kc_project_agent($2,id)) agents,
      (SELECT count(*)::int FROM customer_environments WHERE workspace_id=$1 AND project_id=$2 AND status<>'deleted') environments,
      (SELECT count(*)::int FROM customer_environments WHERE workspace_id=$1 AND project_id=$2 AND status='running') running_environments,
      (SELECT max(updated_at) FROM runs WHERE workspace_id=$1 AND project_id=$2) last_run_activity,
      coalesce(sum(m.tokens) FILTER(WHERE m.usage_known),0)::float8 tokens_measured,
      count(*) FILTER(WHERE NOT m.usage_known)::int unmeasured_calls,
      count(*)::int calls,count(*) FILTER(WHERE NOT m.managed)::int byok_calls,
      coalesce(sum(m.charged_credits),0)::float8 credit_charged,
      coalesce(sum(m.reserved) FILTER(WHERE m.status IN('reserved','uncertain')),0)::float8 credit_reserved
    FROM model_calls m JOIN runs r ON r.id=m.run_id WHERE r.workspace_id=$1 AND r.project_id=$2`,
            [workspace, p.id],
          )
        ).rows[0]
      : null;
  const recentRuns =
    section === "all" || section === "projects"
      ? (
          await pool.query(
            "SELECT id,project_id,goal,status,updated_at FROM runs WHERE workspace_id=$1 AND project_id=$2 ORDER BY updated_at DESC,id LIMIT 5",
            [workspace, p.id],
          )
        ).rows
      : [];
  return {
    stats,
    recent_runs: recentRuns,
    project: p,
    projects: projects.rows,
    agents: agents.rows,
    policy,
    items: items.rows,
    periods: periods.rows,
    environments: environments.rows,
    history: history.rows,
  };
}
export async function saveProject(
  actor: string,
  workspace: string,
  input: unknown,
) {
  await manage(actor, workspace);
  const b = projectInput.parse(input);
  return transaction(async (c) => {
    await c.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
      workspace,
    ]);
    const old = b.id ? await projectFor(c, workspace, b.id) : null;
    if (old && old.revision !== b.revision)
      throw new HttpError(409, "Projekt wurde geändert. Erneut laden.");
    if (
      !old &&
      Number(
        (
          await c.query(
            "SELECT count(*) n FROM workspace_projects WHERE workspace_id=$1",
            [workspace],
          )
        ).rows[0].n,
      ) >= 30
    )
      throw new HttpError(409, "Maximal 30 Projekte.");
    if (
      (
        await c.query(
          "SELECT id FROM agents WHERE workspace_id=$1 AND id=ANY($2::text[])",
          [workspace, b.agent_ids],
        )
      ).rowCount !== new Set(b.agent_ids).size
    )
      throw new HttpError(403, "Agent aus anderem Workspace.");
    const id = old?.id ?? randomUUID();
    await c.query(
      `INSERT INTO workspace_projects(id,workspace_id,name,description,status,all_agents,agent_ids,credit_limit,token_limit,target_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,status=EXCLUDED.status,all_agents=EXCLUDED.all_agents,agent_ids=EXCLUDED.agent_ids,credit_limit=EXCLUDED.credit_limit,token_limit=EXCLUDED.token_limit,target_at=EXCLUDED.target_at,revision=workspace_projects.revision+1`,
      [
        id,
        workspace,
        b.name,
        b.description,
        b.status,
        b.all_agents,
        JSON.stringify([...new Set(b.agent_ids)]),
        b.credit_limit,
        b.token_limit,
        b.target_at,
      ],
    );
    await change(c, workspace, actor, "project.save", { id });
    return { id };
  });
}
export async function savePlan(
  c: PoolClient,
  workspace: string,
  input: unknown,
  actor: string,
  human = false,
) {
  const b = planInput.parse(input);
  await c.query(
    "SELECT id FROM workspace_projects WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
    [b.project_id, workspace],
  );
  await projectFor(c, workspace, b.project_id);
  const rows = (
    await c.query(
      "SELECT * FROM project_plan_items WHERE workspace_id=$1 AND project_id=$2",
      [workspace, b.project_id],
    )
  ).rows;
  const old = b.id ? rows.find((i) => i.id === b.id) : null;
  if (b.id && (!old || old.revision !== b.revision))
    throw new HttpError(409, "Planeintrag wurde geändert.");
  if (old?.locked && !human)
    throw new HttpError(403, "Planeintrag wurde vom Nutzer gesperrt.");
  if (!human && b.locked)
    throw new HttpError(403, "Nur Nutzer dürfen einen Plan sperren.");
  if (rows.length >= 300 && !old)
    throw new HttpError(409, "Planlimit erreicht.");
  if (b.agent_id) await assertProjectAgent(c, b.project_id, b.agent_id);
  const id = old?.id ?? randomUUID();
  try {
    assertDependencies([...rows.filter((i) => i.id !== id), { ...b, id }]);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
  if (old?.run_id && b.status !== old.status)
    throw new HttpError(
      409,
      "Ausgeführte Schritte folgen dem tatsächlichen Auftragsstatus.",
    );
  await c.query(
    `INSERT INTO project_plan_items(id,project_id,workspace_id,title,agent_id,status,planned_start,target_at,estimate_min,estimate_max,confidence,dependencies,locked) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,agent_id=EXCLUDED.agent_id,status=EXCLUDED.status,planned_start=EXCLUDED.planned_start,target_at=EXCLUDED.target_at,estimate_min=EXCLUDED.estimate_min,estimate_max=EXCLUDED.estimate_max,confidence=EXCLUDED.confidence,dependencies=EXCLUDED.dependencies,locked=EXCLUDED.locked,revision=project_plan_items.revision+1`,
    [
      id,
      b.project_id,
      workspace,
      b.title,
      b.agent_id,
      b.status,
      b.planned_start,
      b.target_at,
      b.estimate_min,
      b.estimate_max,
      b.confidence,
      JSON.stringify([...new Set(b.dependencies)]),
      b.locked,
    ],
  );
  await change(c, workspace, actor, "plan.save", { id, project: b.project_id });
  if (human)
    await c.query(
      "INSERT INTO events(workspace_id,run_id,kind,content) SELECT workspace_id,id,'user_message',$2 FROM runs WHERE project_id=$1 AND status IN('running','paused','input_required')",
      [
        b.project_id,
        "Nutzer hat den Projektplan geändert: " +
          id +
          " / " +
          b.title +
          ". Bei Bedarf project_status lesen.",
      ],
    );
  return { id };
}
export async function planHuman(
  actor: string,
  workspace: string,
  input: unknown,
) {
  if (
    !["owner", "admin", "editor"].includes(
      await workspaceRole(actor, workspace),
    )
  )
    throw new HttpError(403, "Keine Schreibberechtigung.");
  return transaction((c) => savePlan(c, workspace, input, actor, true));
}
export async function bindPlanRun(
  c: PoolClient,
  project: string,
  item: string | undefined,
  run: string,
  agent: string,
) {
  if (!item) return;
  const row = (
    await c.query(
      "SELECT * FROM project_plan_items WHERE id=$1 AND project_id=$2 FOR UPDATE",
      [item, project],
    )
  ).rows[0];
  if (!row || row.run_id || !["planned", "ready"].includes(row.status))
    throw new HttpError(409, "Planschritt ist nicht startbar.");
  if (row.agent_id && row.agent_id !== agent)
    throw new HttpError(403, "Anderer Agent ist zuständig.");
  await c.query(
    "UPDATE project_plan_items SET run_id=$2,agent_id=$3,status='ready',revision=revision+1 WHERE id=$1",
    [item, run, agent],
  );
  await c.query("UPDATE runs SET plan_item_id=$2 WHERE id=$1", [run, item]);
}
export async function bindPlanTask(
  c: PoolClient,
  project: string,
  item: string,
  run: string,
  task: string,
  agent: string,
) {
  const row = (
    await c.query(
      "SELECT * FROM project_plan_items WHERE id=$1 AND project_id=$2 FOR UPDATE",
      [item, project],
    )
  ).rows[0];
  if (
    !row ||
    row.run_id ||
    row.task_id ||
    row.locked ||
    !["planned", "ready"].includes(row.status)
  )
    throw new HttpError(
      409,
      "Planschritt ist bereits gebunden, gesperrt oder nicht startbar.",
    );
  if (row.agent_id && row.agent_id !== agent)
    throw new HttpError(403, "Anderer Agent ist für diesen Schritt zuständig.");
  const parent = (
    await c.query("SELECT plan_item_id FROM runs WHERE id=$1", [run])
  ).rows[0];
  if (parent?.plan_item_id && row.dependencies.includes(parent.plan_item_id))
    throw new HttpError(
      400,
      "Teilaufgabe darf nicht auf ihren eigenen Hauptauftrag warten.",
    );
  await assertProjectAgent(c, project, agent);
  await c.query(
    "UPDATE project_plan_items SET run_id=$2,task_id=$3,agent_id=$4,status='ready',revision=revision+1 WHERE id=$1",
    [item, run, task, agent],
  );
  await c.query("UPDATE tasks SET plan_item_id=$2 WHERE id=$1", [task, item]);
}
export async function enforceProjectBudget(
  c: PoolClient,
  run: any,
  agent: string,
  credits: number,
  tokens: number,
) {
  const p = (
    await c.query("SELECT * FROM workspace_projects WHERE id=$1 FOR UPDATE", [
      run.project_id,
    ])
  ).rows[0];
  if (!p || p.status !== "active")
    throw new HttpError(409, "Projekt ist nicht aktiv.", {
      code: "INPUT_REQUIRED",
    });
  await assertProjectAgent(c, p.id, agent);
  const sums = (
    await c.query(
      `SELECT coalesce(sum(CASE WHEN m.status IN('reserved','uncertain') THEN m.reserved ELSE m.charged_credits END),0) credits,coalesce(sum(CASE WHEN m.usage_known THEN m.tokens ELSE m.budget_tokens END),0) tokens FROM model_calls m JOIN runs r ON r.id=m.run_id WHERE r.project_id=$1`,
      [p.id],
    )
  ).rows[0];
  if (
    Number(sums.credits) + credits > p.credit_limit ||
    Number(sums.tokens) + tokens > Number(p.token_limit)
  )
    throw new HttpError(
      409,
      "Projektbudget erreicht. Keine weitere Modellreservierung.",
      { code: "INPUT_REQUIRED" },
    );
  const a = (
    await c.query(
      "SELECT monthly_credit_limit FROM agents WHERE id=$1 FOR UPDATE",
      [agent],
    )
  ).rows[0];
  if (a?.monthly_credit_limit) {
    const used = (
      await c.query(
        `SELECT coalesce(sum(CASE WHEN m.status IN('reserved','uncertain') THEN m.reserved ELSE m.charged_credits END),0) n FROM model_calls m JOIN tasks t ON t.id=m.task_id WHERE t.agent_id=$1 AND m.created_at>=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
        [agent],
      )
    ).rows[0].n;
    if (Number(used) + credits > a.monthly_credit_limit)
      throw new HttpError(409, "Monatliches Agentenbudget erreicht.", {
        code: "INPUT_REQUIRED",
      });
  }
}
export async function saveOrganisation(
  actor: string,
  workspace: string,
  input: any,
) {
  await manage(actor, workspace);
  return transaction(async (c) => {
    const policy = await settings(c, workspace, true);
    if (input.action === "policy") {
      const b = z
        .object({
          action: z.literal("policy"),
          revision: z.number().int(),
          locked: z.boolean(),
          hiring: z.enum(["off", "approval", "automatic"]),
          allowed_roles: z.array(z.string().min(1).max(100)).max(30),
          allowed_models: z.array(z.string().max(100)).max(30),
          max_hires: z.number().int().min(0).max(50),
          max_depth: z.number().int().min(1).max(10),
          hire_credit_limit: z.number().int().min(0).max(10000000),
        })
        .strict()
        .parse(input);
      if (b.revision !== policy.revision)
        throw new HttpError(409, "Organisationsregeln wurden geändert.");
      for (const m of b.allowed_models) await validateModel(c, workspace, m);
      await c.query(
        "UPDATE organisation_settings SET locked=$2,hiring=$3,allowed_roles=$4,allowed_models=$5,max_hires=$6,max_depth=$7,hire_credit_limit=$8,revision=revision+1 WHERE workspace_id=$1",
        [
          workspace,
          b.locked,
          b.hiring,
          JSON.stringify(b.allowed_roles),
          JSON.stringify(b.allowed_models),
          b.max_hires,
          b.max_depth,
          b.hire_credit_limit,
        ],
      );
      await change(c, workspace, actor, "organisation.policy", b);
      return { ok: true };
    }
    const b = z
      .object({
        action: z.literal("structure"),
        revision: z.number().int(),
        agents: z
          .array(
            z
              .object({
                id: z.string().uuid(),
                manager_id: z.string().uuid().nullable(),
                structure_locked: z.boolean(),
                can_manage: z.boolean(),
                monthly_credit_limit: z.number().int().min(0).max(10000000),
              })
              .strict(),
          )
          .max(50),
      })
      .strict()
      .parse(input);
    if (b.revision !== policy.revision)
      throw new HttpError(409, "Organigramm wurde geändert.");
    const rows = (
      await c.query("SELECT id FROM agents WHERE workspace_id=$1 FOR UPDATE", [
        workspace,
      ])
    ).rows;
    if (
      rows.length !== b.agents.length ||
      new Set(b.agents.map((a) => a.id)).size !== rows.length ||
      b.agents.some(
        (a) =>
          !rows.some((r) => r.id === a.id) ||
          (a.manager_id && !rows.some((r) => r.id === a.manager_id)),
      )
    )
      throw new HttpError(
        400,
        "Vollständiges Organigramm desselben Workspace erforderlich.",
      );
    try {
      assertAcyclic(
        b.agents.map((a) => ({ id: a.id, parent: a.manager_id })),
        b.agents.length || 1,
      );
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
    for (const a of b.agents)
      await c.query(
        "UPDATE agents SET manager_id=$2,structure_locked=$3,can_manage=$4,monthly_credit_limit=$5 WHERE id=$1",
        [
          a.id,
          a.manager_id,
          a.structure_locked,
          a.can_manage,
          a.monthly_credit_limit,
        ],
      );
    await c.query(
      "UPDATE organisation_settings SET revision=revision+1 WHERE workspace_id=$1",
      [workspace],
    );
    await change(c, workspace, actor, "organisation.structure", b.agents);
    return { ok: true };
  });
}
export async function hiringTarget(c: PoolClient, task: any, input: unknown) {
  const b = hireInput.parse(input),
    policy = await settings(c, task.workspace_id, true);
  const run = (
    await c.query("SELECT project_id FROM runs WHERE id=$1", [task.run_id])
  ).rows[0];
  if (!run || run.project_id !== b.project_id)
    throw new HttpError(
      403,
      "Neue Agenten nur für das aktuelle Projekt beantragen.",
    );
  await assertProjectAgent(c, b.project_id, task.agent_id);
  const agents = (
    await c.query(
      "SELECT id,manager_id,structure_locked,can_manage FROM agents WHERE workspace_id=$1",
      [task.workspace_id],
    )
  ).rows;
  const requester = agents.find((a) => a.id === task.agent_id);
  if (
    !requester?.can_manage ||
    b.manager_id !== task.agent_id ||
    requester.structure_locked ||
    policy.locked ||
    policy.hiring === "off"
  )
    throw new HttpError(403, "Agentenaufbau ist für diesen Manager gesperrt.");
  await validateModel(c, task.workspace_id, b.model_id);
  const plan = (
    await c.query(
      "SELECT p.max_agents FROM plans p JOIN accounts ac ON ac.plan_id=p.id JOIN workspaces w ON w.owner_id=ac.owner_id WHERE w.id=$1",
      [task.workspace_id],
    )
  ).rows[0];
  if (agents.length >= plan.max_agents)
    throw new HttpError(402, "Agentenlimit des Plans erreicht.");
  try {
    assertAcyclic(
      [
        ...agents.map((a) => ({ id: a.id, parent: a.manager_id })),
        { id: "new", parent: b.manager_id },
      ],
      policy.max_depth,
    );
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
  return {
    b,
    policy,
    key: "org_hire:" + task.agent_id,
    scope: String(policy.revision),
    destination: b.name + " / " + b.role,
  };
}
export async function createHire(
  c: PoolClient,
  task: any,
  input: unknown,
  source: string,
  approved = false,
) {
  const prior = (
    await c.query("SELECT id FROM agents WHERE hire_source=$1", [source])
  ).rows[0];
  if (prior) return prior;
  const { b, policy } = await hiringTarget(c, task, input);
  await c.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
    task.workspace_id,
  ]);
  if (
    (
      await c.query(
        "SELECT 1 FROM decisions WHERE run_id=$1 AND tool_key=$2 AND arguments_hash=$3 AND status='denied' LIMIT 1",
        [task.run_id, "org_hire:" + task.agent_id, toolArgumentsHash(b)],
      )
    ).rowCount
  )
    throw new HttpError(403, "Diese genaue Agentenanfrage wurde abgelehnt.");
  if (!approved) {
    if (policy.hiring !== "automatic") return null;
    const count = Number(
      (
        await c.query(
          "SELECT count(*) n FROM agents WHERE workspace_id=$1 AND auto_hire",
          [task.workspace_id],
        )
      ).rows[0].n,
    );
    if (
      count >= policy.max_hires ||
      !policy.allowed_roles.includes(b.role) ||
      !policy.allowed_models.includes(b.model_id) ||
      b.credit_limit > policy.hire_credit_limit ||
      !policy.hire_credit_limit
    )
      throw new HttpError(
        403,
        "Anfrage liegt außerhalb der erlaubten automatischen Einstellungen.",
      );
  }
  // Recheck the plan under the same workspace lock for concurrent hires.
  const quota = (
    await c.query(
      "SELECT (SELECT count(*) FROM agents WHERE workspace_id=w.id) n,p.max_agents FROM workspaces w JOIN accounts ac ON ac.owner_id=w.owner_id JOIN plans p ON p.id=ac.plan_id WHERE w.id=$1",
      [task.workspace_id],
    )
  ).rows[0];
  if (Number(quota.n) >= quota.max_agents)
    throw new HttpError(402, "Agentenlimit erreicht.");
  const id = randomUUID();
  await c.query(
    "INSERT INTO agents(id,workspace_id,name,role,instructions,color,model_id,manager_id,hire_source,monthly_credit_limit,auto_hire) VALUES($1,$2,$3,$4,$5,'cyan',$6,$7,$8,$9,$10)",
    [
      id,
      task.workspace_id,
      b.name,
      b.role,
      b.instructions,
      b.model_id,
      b.manager_id,
      source,
      b.credit_limit,
      !approved,
    ],
  );
  await c.query(
    "UPDATE workspace_projects SET agent_ids=agent_ids||to_jsonb($2::text),revision=revision+1 WHERE id=$1 AND NOT agent_ids ? $2",
    [b.project_id, id],
  );
  await c.query(
    "UPDATE organisation_settings SET revision=revision+1 WHERE workspace_id=$1",
    [task.workspace_id],
  );
  await change(c, task.workspace_id, task.agent_id, "agent.hired", {
    id,
    ...b,
    approved,
  });
  return { id };
}
export async function assignEnvironment(
  actor: string,
  workspace: string,
  input: unknown,
) {
  await manage(actor, workspace);
  const b = z
    .object({
      id: z.string().uuid(),
      project_id: z.string().uuid(),
      expected_project_id: z.string().uuid().optional(),
    })
    .strict()
    .parse(input);
  return transaction(async (c) => {
    await projectFor(c, workspace, b.project_id);
    const e = (
      await c.query(
        "SELECT * FROM customer_environments WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
        [b.id, workspace],
      )
    ).rows[0];
    if (!e) throw new HttpError(404, "Umgebung fehlt.");
    if (b.expected_project_id && e.project_id !== b.expected_project_id)
      throw new HttpError(
        409,
        "Die Projektzuordnung wurde geändert. Bitte Ansicht aktualisieren.",
      );
    if (e.billing_active || e.reservation)
      throw new HttpError(
        409,
        "Abrechnung der Umgebung ist noch aktiv. Stopp zuerst bestätigen lassen.",
      );
    if (
      (
        await c.query(
          "SELECT 1 FROM environment_jobs WHERE environment_id=$1 AND status IN('queued','running','uncertain') LIMIT 1",
          [e.id],
        )
      ).rowCount
    )
      throw new HttpError(
        409,
        "Umgebung hat einen offenen oder ungeklärten Infrastrukturvorgang.",
      );
    if (e.status !== "stopped" && e.status !== "booked")
      throw new HttpError(409, "Umgebung vor Projektwechsel stoppen.");
    if (
      (
        await c.query(
          "SELECT 1 FROM environment_tool_calls WHERE environment_id=$1 AND status IN('queued','running','uncertain') LIMIT 1",
          [e.id],
        )
      ).rowCount
    )
      throw new HttpError(409, "Umgebung hat offene Aktionen.");
    if (
      (
        await c.query(
          "SELECT 1 FROM work_projects WHERE environment_id=$1 AND project_id<>$2",
          [e.id, b.project_id],
        )
      ).rowCount
    )
      throw new HttpError(
        409,
        "Git-Verbindung zuerst dem Zielprojekt zuordnen.",
      );
    await c.query(
      "UPDATE customer_environments SET project_id=$2 WHERE id=$1",
      [e.id, b.project_id],
    );
    await change(c, workspace, actor, "environment.project", b);
    return { ok: true };
  });
}
export async function shareMaterial(
  actor: string,
  workspace: string,
  input: unknown,
) {
  await manage(actor, workspace);
  const b = z
    .object({
      kind: z.enum(["attachment", "memory", "skill"]),
      id: z.string().uuid(),
      workspace_shared: z.boolean(),
    })
    .strict()
    .parse(input);
  const table =
    b.kind === "memory"
      ? "memories"
      : b.kind === "skill"
        ? "skills"
        : "attachments";
  return transaction(async (c) => {
    if (
      !(
        await c.query(
          `UPDATE ${table} SET workspace_shared=$3 WHERE id=$1 AND workspace_id=$2 RETURNING id`,
          [b.id, workspace, b.workspace_shared],
        )
      ).rowCount
    )
      throw new HttpError(404, "Eintrag fehlt.");
    await change(c, workspace, actor, "material.shared", b);
    return { ok: true };
  });
}
export const restructureInput = z
  .object({
    moves: z
      .array(
        z
          .object({ id: z.string().uuid(), manager_id: z.string().uuid() })
          .strict(),
      )
      .min(1)
      .max(30),
    reason: z.string().trim().min(10).max(2000),
  })
  .strict();
export async function restructureTarget(
  c: PoolClient,
  task: any,
  input: unknown,
) {
  const b = restructureInput.parse(input),
    policy = await settings(c, task.workspace_id, true),
    rows = (
      await c.query(
        "SELECT id,manager_id,structure_locked,can_manage FROM agents WHERE workspace_id=$1",
        [task.workspace_id],
      )
    ).rows;
  const manager = rows.find((r) => r.id === task.agent_id);
  if (policy.locked || !manager?.can_manage || manager.structure_locked)
    throw new HttpError(403, "Organigramm ist gesperrt.");
  const descendants = new Set([task.agent_id]);
  for (let n = 0; n < rows.length; n++)
    for (const row of rows)
      if (descendants.has(row.manager_id)) descendants.add(row.id);
  const run = (
    await c.query("SELECT project_id FROM runs WHERE id=$1", [task.run_id])
  ).rows[0];
  for (const move of b.moves) {
    const row = rows.find((r) => r.id === move.id);
    if (
      !row ||
      row.structure_locked ||
      move.id === task.agent_id ||
      !descendants.has(move.id) ||
      !descendants.has(move.manager_id) ||
      !rows.some((r) => r.id === move.manager_id)
    )
      throw new HttpError(403, "Nur ungesperrte eigene Unterteams umstellen.");
    await assertProjectAgent(c, run.project_id, move.id);
    await assertProjectAgent(c, run.project_id, move.manager_id);
  }
  try {
    assertAcyclic(
      rows.map((r) => ({
        id: r.id,
        parent: b.moves.find((m) => m.id === r.id)?.manager_id ?? r.manager_id,
      })),
      policy.max_depth,
    );
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
  return {
    b,
    policy,
    key: "org_restructure:" + task.agent_id,
    scope: String(policy.revision),
    destination: "Agenten-Organigramm",
  };
}
export async function applyRestructure(
  c: PoolClient,
  task: any,
  input: unknown,
) {
  const { b } = await restructureTarget(c, task, input);
  for (const move of b.moves)
    await c.query("UPDATE agents SET manager_id=$2 WHERE id=$1", [
      move.id,
      move.manager_id,
    ]);
  await c.query(
    "UPDATE organisation_settings SET revision=revision+1 WHERE workspace_id=$1",
    [task.workspace_id],
  );
  await change(
    c,
    task.workspace_id,
    task.agent_id,
    "organisation.restructure",
    b,
  );
  return { ok: true };
}
