import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { pool, transaction, audit } from "./db.ts";
import { HttpError } from "./auth.ts";
import { workspaceRole } from "./team.ts";
import { projectFor } from "./organisation.ts";
import { validateModel } from "./catalog.ts";
import { redact } from "./security.ts";
import { assertAcyclic } from "../core/organisation.ts";
const key = z.string().regex(/^[a-z][0-9]{1,3}$/),
  text = z.string().max(12000);
const packageSchema = z
  .object({
    format: z.literal("kerncloud-team"),
    version: z.literal(1),
    name: z.string().min(1).max(100),
    description: text,
    agents: z
      .array(
        z
          .object({
            key,
            name: z.string().min(1).max(100),
            role: z.string().min(1).max(100),
            instructions: text,
            manager: key.nullable(),
            can_manage: z.boolean(),
            skills: z.array(key).max(50),
            monthly_credit_limit: z.number().int().min(0).max(10000000),
          })
          .strict(),
      )
      .max(50),
    skills: z
      .array(
        z
          .object({
            key,
            name: z.string().min(1).max(100),
            description: text,
            content: z.string().max(50000),
          })
          .strict(),
      )
      .max(50),
    routines: z
      .array(
        z
          .object({
            name: z.string().min(1).max(100),
            agent: key,
            skill: key,
            goal: z.string().min(10).max(4000),
            interval_minutes: z.number().int().min(15).max(43200).nullable(),
            token_limit: z.number().int().min(1000).max(10000000),
            credit_limit: z.number().int().min(0).max(10000000),
            overlap_policy: z.enum(["queue", "coalesce", "skip"]),
            catch_up: z.enum(["skip", "coalesce"]),
          })
          .strict(),
      )
      .max(30),
  })
  .strict();
function inspect(input: unknown) {
  if (Buffer.byteLength(JSON.stringify(input)) > 500000)
    throw new HttpError(413, "Vorlagenpaket zu groß.");
  const b = packageSchema.parse(input),
    ids = new Set(b.agents.map((a) => a.key)),
    skills = new Set(b.skills.map((s) => s.key));
  if (
    ids.size !== b.agents.length ||
    skills.size !== b.skills.length ||
    b.agents.some(
      (a) =>
        (a.manager && !ids.has(a.manager)) ||
        a.skills.some((s) => !skills.has(s)),
    ) ||
    b.routines.some((r) => !ids.has(r.agent) || !skills.has(r.skill))
  )
    throw new HttpError(400, "Vorlage hat ungültige Verweise.");
  try {
    assertAcyclic(b.agents.map((a) => ({ id: a.key, parent: a.manager })));
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
  return b;
}
export async function teamTemplates(
  actor: string,
  workspace: string,
  project: string | undefined,
  input: any,
) {
  if (!["owner", "admin"].includes(await workspaceRole(actor, workspace)))
    throw new HttpError(403, "Workspace-Administration erforderlich.");
  if (input.action === "export") {
    const p = await projectFor(pool, workspace, project),
      agents = (
        await pool.query(
          "SELECT * FROM agents WHERE workspace_id=$1 AND kc_project_agent($2,id) ORDER BY id",
          [workspace, p.id],
        )
      ).rows;
    const skills = (
      await pool.query(
        "SELECT id,name,description,content FROM skills WHERE workspace_id=$1 AND (project_id=$2 OR workspace_shared) ORDER BY id LIMIT 50",
        [workspace, p.id],
      )
    ).rows;
    const routines = (
      await pool.query(
        "SELECT * FROM automations WHERE workspace_id=$1 AND project_id=$2 ORDER BY id LIMIT 30",
        [workspace, p.id],
      )
    ).rows;
    const aKey = (id: string) => "a" + agents.findIndex((a) => a.id === id),
      sKey = (id: string) => "s" + skills.findIndex((s) => s.id === id);
    const data = inspect({
      format: "kerncloud-team",
      version: 1,
      name: p.name,
      description: redact(p.description),
      agents: agents.map((a) => ({
        key: aKey(a.id),
        name: a.name,
        role: a.role,
        instructions: redact(a.instructions),
        manager: agents.some((x) => x.id === a.manager_id)
          ? aKey(a.manager_id)
          : null,
        can_manage: a.can_manage,
        skills: a.skill_ids
          .filter((id: string) => skills.some((s) => s.id === id))
          .map(sKey),
        monthly_credit_limit: a.monthly_credit_limit,
      })),
      skills: skills.map((s) => ({
        key: sKey(s.id),
        name: s.name,
        description: redact(s.description),
        content: redact(s.content),
      })),
      routines: routines
        .filter(
          (r) =>
            agents.some((a) => a.id === r.agent_id) &&
            skills.some((s) => s.id === r.skill_id),
        )
        .map((r) => ({
          name: r.name,
          agent: aKey(r.agent_id),
          skill: sKey(r.skill_id),
          goal: redact(r.goal),
          interval_minutes: r.interval_minutes,
          token_limit: r.token_limit,
          credit_limit: r.credit_limit,
          overlap_policy: r.overlap_policy,
          catch_up: r.catch_up,
        })),
    });
    return {
      package: data,
      warning:
        "Keine API-Schlüssel, Sitzungen, MCP-Verbindungen, Container, Auftragsdateien oder Laufprotokolle enthalten. Freitext kann trotzdem vertrauliche Angaben enthalten: vor Weitergabe vollständig prüfen.",
    };
  }
  const b = inspect(input.package),
    digest = createHash("sha256").update(JSON.stringify(b)).digest("hex");
  if (input.action === "preview")
    return {
      package: b,
      digest,
      counts: {
        agents: b.agents.length,
        skills: b.skills.length,
        routines: b.routines.length,
      },
      warning:
        "Importiert ein neues Projekt. Agenten werden pausiert, Skills als ungeprüfte Entwürfe und Routinen deaktiviert angelegt. Keine Zugänge oder Umgebungen werden übernommen.",
    };
  if (
    input.action !== "import" ||
    input.preview_hash !== digest ||
    input.reviewed !== true
  )
    throw new HttpError(400, "Exakte Vorschau prüfen und bestätigen.");
  return transaction(async (c) => {
    await c.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
      workspace,
    ]);
    const prior = (
      await c.query(
        "SELECT project_id FROM template_imports WHERE workspace_id=$1 AND digest=$2",
        [workspace, digest],
      )
    ).rows[0];
    if (prior) return { project_id: prior.project_id, duplicate: true };
    const quota = (
        await c.query(
          "SELECT p.max_agents,p.max_automations FROM workspaces w JOIN accounts ac ON ac.owner_id=w.owner_id JOIN plans p ON p.id=ac.plan_id WHERE w.id=$1",
          [workspace],
        )
      ).rows[0],
      counts = (
        await c.query(
          "SELECT (SELECT count(*) FROM agents WHERE workspace_id=$1) agents,(SELECT count(*) FROM workspace_projects WHERE workspace_id=$1) projects,(SELECT count(*) FROM automations a JOIN workspaces w ON w.id=a.workspace_id WHERE w.owner_id=(SELECT owner_id FROM workspaces WHERE id=$1)) routines",
          [workspace],
        )
      ).rows[0];
    if (
      Number(counts.agents) + b.agents.length > quota.max_agents ||
      Number(counts.projects) >= 30 ||
      Number(counts.routines) + b.routines.length > quota.max_automations
    )
      throw new HttpError(
        402,
        "Vorlage überschreitet die Agenten-, Projekt- oder Routinenlimits des Plans.",
      );
    const model = input.model_id
      ? z.string().max(100).parse(input.model_id)
      : null;
    if (model) await validateModel(c, workspace, model);
    const projectId = randomUUID(),
      agents = new Map(b.agents.map((a) => [a.key, randomUUID()])),
      skills = new Map(b.skills.map((s) => [s.key, randomUUID()]));
    await c.query(
      "INSERT INTO workspace_projects(id,workspace_id,name,description,status,agent_ids) VALUES($1,$2,$3,$4,'planned',$5)",
      [
        projectId,
        workspace,
        b.name,
        b.description,
        JSON.stringify([...agents.values()]),
      ],
    );
    for (const s of b.skills)
      await c.query(
        "INSERT INTO skills(id,workspace_id,project_id,name,description,content,status) VALUES($1,$2,$3,$4,$5,$6,'draft')",
        [
          skills.get(s.key),
          workspace,
          projectId,
          s.name,
          s.description,
          s.content,
        ],
      );
    for (const a of b.agents)
      await c.query(
        "INSERT INTO agents(id,workspace_id,name,role,instructions,color,model_id,skill_ids,can_manage,execution_paused,monthly_credit_limit) VALUES($1,$2,$3,$4,$5,'cyan',$6,$7,$8,true,$9)",
        [
          agents.get(a.key),
          workspace,
          a.name,
          a.role,
          a.instructions,
          model,
          JSON.stringify(a.skills.map((s) => skills.get(s))),
          a.can_manage,
          a.monthly_credit_limit,
        ],
      );
    for (const a of b.agents)
      if (a.manager)
        await c.query("UPDATE agents SET manager_id=$2 WHERE id=$1", [
          agents.get(a.key),
          agents.get(a.manager),
        ]);
    for (const r of b.routines)
      await c.query(
        "INSERT INTO automations(id,workspace_id,project_id,agent_id,skill_id,skill_version,name,mode,goal,interval_minutes,token_limit,credit_limit,enabled,overlap_policy,catch_up) VALUES($1,$2,$3,$4,$5,1,$6,'agent',$7,$8,$9,$10,false,$11,$12)",
        [
          randomUUID(),
          workspace,
          projectId,
          agents.get(r.agent),
          skills.get(r.skill),
          r.name,
          r.goal,
          r.interval_minutes,
          r.token_limit,
          r.credit_limit,
          r.overlap_policy,
          r.catch_up,
        ],
      );
    await c.query(
      "INSERT INTO template_imports(workspace_id,digest,project_id) VALUES($1,$2,$3)",
      [workspace, digest, projectId],
    );
    await audit(c, actor, "organisation.template_import", projectId);
    return { project_id: projectId, paused: true };
  });
}
