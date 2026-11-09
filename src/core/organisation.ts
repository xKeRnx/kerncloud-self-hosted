import { z } from "zod";
export const projectInput = z
  .object({
    id: z.string().uuid().optional(),
    revision: z.number().int().positive().optional(),
    name: z.string().trim().min(1).max(100),
    description: z.string().max(8000).default(""),
    status: z
      .enum(["planned", "active", "paused", "completed", "archived"])
      .default("active"),
    all_agents: z.boolean().default(false),
    agent_ids: z.array(z.string().uuid()).max(50).default([]),
    credit_limit: z.number().int().min(0).max(2147483647).default(100000),
    token_limit: z.number().int().min(0).max(1000000000000).default(1000000),
    target_at: z.string().datetime().nullable().default(null),
  })
  .strict();
export const planInput = z
  .object({
    id: z.string().uuid().optional(),
    revision: z.number().int().positive().optional(),
    project_id: z.string().uuid(),
    title: z.string().trim().min(1).max(300),
    agent_id: z.string().uuid().nullable().default(null),
    status: z
      .enum(["planned", "ready", "in_progress", "blocked", "done", "canceled"])
      .default("planned"),
    planned_start: z.string().datetime().nullable().default(null),
    target_at: z.string().datetime().nullable().default(null),
    estimate_min: z.number().int().min(1).max(525600).nullable().default(null),
    estimate_max: z.number().int().min(1).max(525600).nullable().default(null),
    confidence: z.enum(["low", "medium", "high"]).default("low"),
    dependencies: z.array(z.string().uuid()).max(30).default([]),
    locked: z.boolean().default(false),
  })
  .strict()
  .refine(
    (b) =>
      !b.estimate_min || !b.estimate_max || b.estimate_max >= b.estimate_min,
    "Invalid estimate range",
  )
  .refine(
    (b) =>
      !b.planned_start ||
      !b.target_at ||
      Date.parse(b.target_at) >= Date.parse(b.planned_start),
    "Invalid time range",
  );
export const hireInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    role: z.string().trim().min(1).max(100),
    instructions: z.string().trim().min(10).max(12000),
    manager_id: z.string().uuid(),
    project_id: z.string().uuid(),
    model_id: z.string().min(1).max(100),
    credit_limit: z.number().int().min(1).max(10000000),
    reason: z.string().trim().min(10).max(2000),
  })
  .strict();
export function assertAcyclic(
  rows: { id: string; parent: string | null }[],
  maxDepth = 50,
) {
  const parents = new Map(rows.map((r) => [r.id, r.parent]));
  for (const row of rows) {
    let current: string | null = row.id,
      depth = 0;
    const seen = new Set<string>();
    while (current) {
      if (seen.has(current)) throw new Error("Hierarchy/dependency cycle");
      seen.add(current);
      if (++depth > maxDepth)
        throw new Error("Maximum hierarchy depth exceeded");
      current = parents.get(current) ?? null;
    }
  }
}
export function assertDependencies(
  rows: { id: string; dependencies: string[] }[],
) {
  const map = new Map(rows.map((r) => [r.id, r.dependencies]));
  const visit = (id: string, active: Set<string>, done: Set<string>) => {
    if (active.has(id)) throw new Error("Dependency cycle");
    if (done.has(id)) return;
    active.add(id);
    for (const d of map.get(id) ?? []) {
      if (!map.has(d)) throw new Error("Dependency outside project");
      visit(d, active, done);
    }
    active.delete(id);
    done.add(id);
  };
  const done = new Set<string>();
  for (const r of rows) visit(r.id, new Set(), done);
}
