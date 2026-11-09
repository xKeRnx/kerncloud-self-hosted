import { createHash } from "node:crypto";
import { z } from "zod";
import type { PoolClient } from "pg";
import { transaction } from "./db.ts";
import { validateModel } from "./catalog.ts";
import { HttpError } from "./auth.ts";

export const runPolicyInput = z.object({
  credit_limit: z.number().int().min(0).max(10000000),
  token_limit: z.number().int().min(1000).max(10000000),
  fallback_model_ids: z.array(z.string().min(1).max(100)).max(3),
  context_strategy: z.enum(["compact", "cache_aware"]).default("compact"),
});
export function modelConsent(model: any) {
  // A key rotation is allowed. A changed endpoint, model, owner or tariff needs new consent.
  return createHash("sha256")
    .update(
      JSON.stringify([
        model.id,
        model.workspace_id,
        model.endpoint,
        model.model,
        Number(model.input_rate),
        Number(model.output_rate),
        model.base_credits,
      ]),
    )
    .digest("hex");
}
export async function saveRunPolicy(workspaceId: string, body: unknown) {
  const b = runPolicyInput.strict().parse(body);
  return transaction(async (c) => {
    const approvals: Record<string, string> = {};
    for (const id of [...new Set(b.fallback_model_ids)])
      approvals[id] = modelConsent(await validateModel(c, workspaceId, id));
    await c.query(
      "UPDATE workspaces SET run_credit_limit=$2,run_token_limit=$3,fallback_model_ids=$4,context_strategy=$5 WHERE id=$1",
      [
        workspaceId,
        b.credit_limit,
        b.token_limit,
        JSON.stringify(
          Object.entries(approvals).map(([id, consent]) => ({ id, consent })),
        ),
        b.context_strategy,
      ],
    );
    return { ok: true };
  });
}
export async function snapshotRunPolicy(
  c: PoolClient,
  workspaceId: string,
  primaryIds: string[],
) {
  const w = (
    await c.query(
      "SELECT run_credit_limit,run_token_limit,fallback_model_ids,context_strategy FROM workspaces WHERE id=$1",
      [workspaceId],
    )
  ).rows[0];
  const approvals: Record<string, string> = {};
  for (const id of [...new Set(primaryIds)])
    approvals[id] = modelConsent(await validateModel(c, workspaceId, id));
  const fallbacks: string[] = [];
  for (const entry of w.fallback_model_ids) {
    const model = await validateModel(c, workspaceId, entry.id);
    if (modelConsent(model) !== entry.consent)
      throw new HttpError(
        409,
        "Tarif oder Anbieter eines Ausweichmodells wurde geändert. Bitte unter KI & Modelle erneut freigeben.",
      );
    approvals[entry.id] = entry.consent;
    fallbacks.push(entry.id);
  }
  return {
    credit_limit: w.run_credit_limit,
    token_limit: w.run_token_limit,
    policy: { approvals, fallbacks, context_strategy: w.context_strategy },
  };
}
export async function selectRunModel(c: PoolClient, task: any, run: any) {
  const policy = run.model_policy ?? {};
  if (!task.model_id)
    throw new HttpError(409, "Kein Auftragsmodell gespeichert.", {
      code: "INPUT_REQUIRED",
    });
  const primary = await validateModel(c, task.workspace_id, task.model_id);
  const ids = [
    primary.id,
    ...(policy.fallbacks ?? []).filter((id: string) => id !== primary.id),
  ];
  const id = ids[task.fallback_index ?? 0];
  if (!id)
    throw new HttpError(
      409,
      "Alle freigegebenen Ausweichmodelle sind ausgeschöpft.",
      { code: "INPUT_REQUIRED" },
    );
  const model = await validateModel(c, task.workspace_id, id);
  if ((model.workspace_id === null) !== (primary.workspace_id === null))
    throw new HttpError(
      409,
      "Ausweichmodelle müssen dieselbe Abrechnungsart verwenden.",
      { code: "INPUT_REQUIRED" },
    );
  if (policy.approvals && policy.approvals[id] !== modelConsent(model))
    throw new HttpError(
      409,
      "Modell oder Tarif hat sich seit der Freigabe geändert. Neuen Auftrag mit geprüften Modelleinstellungen starten.",
      { code: "INPUT_REQUIRED" },
    );
  return model;
}
export async function advanceFallback(
  c: PoolClient,
  task: any,
  run: any,
  current: any,
) {
  const ids = [
    task.model_id,
    ...(run.model_policy?.fallbacks ?? []).filter(
      (id: string) => id !== task.model_id,
    ),
  ];
  const nextId = ids[(task.fallback_index ?? 0) + 1];
  if (!nextId) return false;
  try {
    const next = await validateModel(c, task.workspace_id, nextId);
    if (
      (next.workspace_id === null) !== (current.workspace_id === null) ||
      run.model_policy.approvals[next.id] !== modelConsent(next)
    )
      return false;
  } catch {
    return false;
  }
  await c.query(
    "UPDATE tasks SET fallback_index=fallback_index+1 WHERE id=$1",
    [task.id],
  );
  await c.query(
    "INSERT INTO events(workspace_id,run_id,agent_id,kind,content) VALUES($1,$2,$3,'model_fallback',$4)",
    [
      task.workspace_id,
      run.id,
      task.agent_id,
      `Anbieterproblem: Wechsel vom Modell ${current.name} zum ausdrücklich freigegebenen Ausweichmodell. Das gemeinsame Auftragslimit bleibt unverändert.`,
    ],
  );
  return true;
}
export async function enforceRunBudget(
  c: PoolClient,
  run: any,
  credits: number,
  tokens: number,
) {
  // lockTask already holds the run lock: reservations across parallel agents are serialized.
  const sums = (
    await c.query(
      "SELECT COALESCE(sum(CASE WHEN status='reserved' OR status='uncertain' THEN reserved ELSE charged_credits END),0) AS credits,COALESCE(sum(CASE WHEN usage_known THEN tokens ELSE budget_tokens END),0) AS tokens FROM model_calls WHERE run_id=$1",
      [run.id],
    )
  ).rows[0];
  if (
    Number(sums.credits) + credits > run.credit_limit ||
    Number(sums.tokens) + tokens > run.token_limit
  )
    throw new HttpError(
      409,
      "Festes Auftragslimit erreicht oder die nächste Reservierung passt nicht mehr hinein. Kein weiterer Modellaufruf. Vorhandene Ergebnisse bleiben gespeichert.",
      { code: "INPUT_REQUIRED" },
    );
}
