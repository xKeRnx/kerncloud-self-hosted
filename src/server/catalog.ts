import {
  calculateModelTariff,
  type ModelTariffConfig,
} from "../core/model-tariff.ts";
import { discoveryCredential, inspectModel } from "./model-discovery.ts";
import {
  applyCapabilityLimits,
  capabilityIssue,
} from "../core/model-capabilities.ts";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { pool, transaction, audit } from "./db.ts";
import { decrypt, encrypt } from "./security.ts";
import { networkEndpoint } from "./mcp.ts";
import { HttpError } from "./auth.ts";
import type { ModelOffering } from "../core/types.ts";
import { maxContextTokens } from "../core/agent-context.ts";
import {
  defaultModelTimeoutSeconds,
  maxModelTimeoutSeconds,
  reasoningEffortValues,
} from "../core/agent-recovery.ts";
import {
  minOutputTokens,
  maxOutputTokens,
  defaultOutputTokens,
} from "../core/model-limits.ts";
const fields =
  "id,workspace_id,name,provider_name,endpoint,model,input_rate::float8,output_rate::float8,base_credits,active,streaming,max_output_tokens,request_timeout_seconds,reasoning_effort,auto_reasoning_effort,context_window_tokens,monitor_enabled,checked_at,check_status,capabilities,pricing_config";
export async function listModels(
  workspaceId?: string,
  admin = false,
): Promise<ModelOffering[]> {
  const rows = (
    await pool.query(
      `SELECT ${fields} FROM model_offerings WHERE deleted_at IS NULL AND (${admin ? "workspace_id IS NULL" : "workspace_id=$1 OR (workspace_id IS NULL AND active=true)"}) ORDER BY created_at`,
      admin ? [] : [workspaceId],
    )
  ).rows;
  return rows.map((row) => ({
    ...row,
    endpoint: admin || row.workspace_id ? row.endpoint : undefined,
    configured: true,
    pricing_config: admin ? row.pricing_config : undefined,
  }));
}
export async function saveModel(
  actor: string,
  body: unknown,
  workspaceId: string | null,
) {
  const schema = z.object({
    pricing_config: z
      .object({
        mode: z.enum(["catalog", "manual"]),
        currency: z.enum(["USD", "EUR"]),
        input_per_million: z.number().min(0).max(1e9).nullable(),
        output_per_million: z.number().min(0).max(1e9).nullable(),
        request: z.number().min(0).max(1e9).nullable(),
        eur_per_currency_unit: z.number().positive().max(1000),
        eur_per_1000_credits: z.number().min(0.000001).max(10000),
        markup_percent: z.number().min(0).max(10000),
        cost_buffer_percent: z.number().min(0).max(1000),
        acknowledge_extras: z.boolean().default(false),
        platform_base_credits: z.number().int().min(0).max(1e6).default(0),
      })
      .nullable()
      .optional(),
    id: z.string().min(1).max(100).optional(),
    name: z.string().trim().min(1).max(150),
    provider_name: z.string().trim().min(1).max(150),
    endpoint: z.string().url(),
    model: z.string().trim().min(1).max(200),
    key: z.string().max(2000).optional(),
    input_rate: z.number().min(0).max(1000000).default(1000),
    output_rate: z.number().min(0).max(1000000).default(1000),
    base_credits: z.number().int().min(0).max(1000000).default(0),
    streaming: z.boolean().default(true),
    detect_capabilities: z.boolean().optional(),
    max_output_tokens: z.number().int().min(1).max(maxOutputTokens).optional(),
    active: z.boolean().default(true),
    monitor_enabled: z.boolean().default(true),
    context_window_tokens: z
      .number()
      .int()
      .min(1)
      .max(maxContextTokens)
      .nullable()
      .optional(),
    request_timeout_seconds: z
      .number()
      .int()
      .min(30)
      .max(maxModelTimeoutSeconds)
      .optional(),
    auto_reasoning_effort: z.enum(reasoningEffortValues).optional(),
    reasoning_effort: z
      .enum([
        "auto",
        "none",
        "provider_default",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
      ])
      .optional(),
  });
  const input = schema.parse(body);
  if (workspaceId && input.pricing_config)
    throw new HttpError(
      403,
      "Credit-Kalkulation ist nur für Betreiber-Modelle erlaubt.",
    );
  await networkEndpoint(input.endpoint);
  if (input.id) {
    const owner = (
      await pool.query("SELECT workspace_id FROM model_offerings WHERE id=$1", [
        input.id,
      ])
    ).rows[0];
    if (owner && owner.workspace_id !== workspaceId)
      throw new HttpError(403, "Fremder Modelleinstieg.");
  }
  const credential = await discoveryCredential(workspaceId, input);
  const detected =
    input.detect_capabilities || input.pricing_config?.mode === "catalog"
      ? await inspectModel(input.endpoint, input.model, credential.key)
      : null;
  let config: ModelTariffConfig | null = input.pricing_config ?? null;
  if (config?.mode === "catalog") {
    const prices = detected?.listing?.prices;
    if (detected?.status !== "available" || !prices)
      throw new HttpError(
        400,
        "Keine verlässlichen Katalogpreise. Katalog neu laden oder Einkaufspreise ausdrücklich manuell eintragen.",
      );
    if (prices.extras.length && !config.acknowledge_extras)
      throw new HttpError(
        400,
        "Weitere oder bedingte Anbieterpreise bitte vor der Kalkulation prüfen und bestätigen.",
      );
    config = {
      ...config,
      currency: prices.currency,
      eur_per_currency_unit:
        prices.currency === "EUR" ? 1 : config.eur_per_currency_unit,
      input_per_million: prices.input_per_million,
      output_per_million: prices.output_per_million,
      request: prices.request,
      price_snapshot: prices,
    };
  }
  if (config)
    config = {
      ...config,
      eur_per_currency_unit:
        config.currency === "EUR" ? 1 : config.eur_per_currency_unit,
      calculated_at: new Date().toISOString(),
    };
  let tariff = {
    input_rate: input.input_rate,
    output_rate: input.output_rate,
    base_credits: input.base_credits,
  };
  if (config) {
    try {
      tariff = calculateModelTariff(config);
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
  }
  const modelId = input.id ?? randomUUID();
  await transaction(async (c) => {
    const existing = (
      await c.query("SELECT * FROM model_offerings WHERE id=$1 FOR UPDATE", [
        modelId,
      ])
    ).rows[0];
    if (existing?.deleted_at)
      throw new HttpError(404, "Modell wurde entfernt.");
    if (existing && existing.workspace_id !== workspaceId)
      throw new HttpError(403, "Fremder Modelleinstieg.");
    if (!existing && input.id)
      throw new HttpError(404, "Modell nicht gefunden.");
    if (config) {
      const ceiling = (
        await c.query(
          "SELECT min(price_cents::float8 / 100 / credits * 1000) AS value FROM plans WHERE active AND managed AND credits>0 AND price_cents>0",
        )
      ).rows[0]?.value;
      if (ceiling && config.eur_per_1000_credits > Number(ceiling) + 1e-9)
        throw new HttpError(
          400,
          "Der kalkulierte Nettoerlös pro 1.000 Credits liegt über dem günstigsten aktiven Paketpreis je Credit. Bitte die Kalkulation oder Pläne prüfen.",
        );
    }
    const count = (
      await c.query(
        "SELECT count(*) FROM model_offerings WHERE workspace_id IS NOT DISTINCT FROM $1 AND deleted_at IS NULL",
        [workspaceId],
      )
    ).rows[0];
    if (!existing && Number(count.count) >= 30)
      throw new HttpError(409, "Maximal 30 Modelle pro Katalog.");
    // Never forward an existing credential to a newly edited endpoint without re-entry.
    if (
      existing &&
      existing.endpoint !== input.endpoint.replace(/\/$/, "") &&
      input.key === undefined
    )
      throw new HttpError(
        400,
        "Bei einem neuen Endpoint bitte den Schlüssel erneut angeben (für lokale Modelle leer bestätigen).",
      );
    if (
      input.key === undefined &&
      credential.old &&
      existing?.secret !== credential.old.secret
    )
      throw new HttpError(
        409,
        "Modellzugang wurde während der Erkennung geändert. Bitte erneut versuchen.",
      );
    const sameModel =
      existing?.endpoint === input.endpoint.replace(/\/$/, "") &&
      existing?.model === input.model &&
      (input.key === undefined || input.key === decrypt(existing.secret));
    const capabilities =
      detected?.status === "available"
        ? detected.capabilities
        : sameModel
          ? (existing?.capabilities ?? {})
          : {};
    const values = applyCapabilityLimits({
      capabilities,
      context_window_tokens:
        input.context_window_tokens !== undefined
          ? input.context_window_tokens
          : existing?.context_window_tokens,
      max_output_tokens:
        input.max_output_tokens ??
        existing?.max_output_tokens ??
        defaultOutputTokens,
      reasoning_effort:
        input.reasoning_effort ?? existing?.reasoning_effort ?? "auto",
      auto_reasoning_effort:
        input.auto_reasoning_effort ??
        existing?.auto_reasoning_effort ??
        "provider_default",
    });
    const issue = capabilityIssue(values);
    if (issue) throw new HttpError(400, issue);
    const selectedEffort =
      values.reasoning_effort === "auto"
        ? values.auto_reasoning_effort
        : values.reasoning_effort;
    if (
      input.detect_capabilities &&
      !Array.isArray(capabilities.reasoning_efforts) &&
      selectedEffort !== "provider_default"
    )
      throw new HttpError(
        400,
        "Der Anbieter meldet keine erlaubten Denkstufen. Bitte Anbietervorgabe wählen oder die Angaben ausdrücklich manuell bestätigen.",
      );
    const secret =
      input.key !== undefined
        ? encrypt(input.key)
        : (existing?.secret ?? encrypt(""));
    await c.query(
      "INSERT INTO model_offerings(id,workspace_id,name,provider_name,endpoint,model,secret,input_rate,output_rate,base_credits,active,streaming,max_output_tokens,request_timeout_seconds,reasoning_effort,auto_reasoning_effort) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,provider_name=EXCLUDED.provider_name,endpoint=EXCLUDED.endpoint,model=EXCLUDED.model,secret=EXCLUDED.secret,input_rate=EXCLUDED.input_rate,output_rate=EXCLUDED.output_rate,base_credits=EXCLUDED.base_credits,active=EXCLUDED.active,streaming=EXCLUDED.streaming,max_output_tokens=EXCLUDED.max_output_tokens,request_timeout_seconds=EXCLUDED.request_timeout_seconds,reasoning_effort=EXCLUDED.reasoning_effort,auto_reasoning_effort=EXCLUDED.auto_reasoning_effort",
      [
        modelId,
        workspaceId,
        input.name,
        input.provider_name,
        input.endpoint.replace(/\/$/, ""),
        input.model,
        secret,
        workspaceId ? 0 : tariff.input_rate,
        workspaceId ? 0 : tariff.output_rate,
        workspaceId ? 0 : tariff.base_credits,
        input.active,
        input.streaming,
        values.max_output_tokens,
        input.request_timeout_seconds ??
          existing?.request_timeout_seconds ??
          defaultModelTimeoutSeconds,
        input.reasoning_effort ?? existing?.reasoning_effort ?? "auto",
        input.auto_reasoning_effort ??
          existing?.auto_reasoning_effort ??
          "provider_default",
      ],
    );
    await c.query(
      "UPDATE model_offerings SET monitor_enabled=$2,checked_at=CASE WHEN $3::text IS NULL THEN NULL ELSE now() END,check_status=COALESCE($3,'unknown') WHERE id=$1",
      [modelId, input.monitor_enabled, detected?.status ?? null],
    );
    await c.query("UPDATE model_offerings SET pricing_config=$2 WHERE id=$1", [
      modelId,
      JSON.stringify(config ?? {}),
    ]);
    await audit(
      c,
      actor,
      workspaceId ? "model.own.update" : "admin.model.update",
      modelId,
    );
    await c.query(
      "UPDATE model_offerings SET capabilities=$2,context_window_tokens=$3 WHERE id=$1",
      [
        modelId,
        JSON.stringify(capabilities),
        values.context_window_tokens ?? null,
      ],
    );
  });
  return { id: modelId };
}
export async function validateModel(
  c: PoolClient,
  workspaceId: string,
  modelId: string,
) {
  const m = (
    await c.query(
      "SELECT * FROM model_offerings WHERE id=$1 AND deleted_at IS NULL AND(workspace_id=$2 OR workspace_id IS NULL) FOR SHARE",
      [modelId, workspaceId],
    )
  ).rows[0];
  if (!m)
    throw new HttpError(
      403,
      "Modell ist nicht freigegeben oder gehört zu einem anderen Workspace.",
    );
  if (!m.active)
    throw new HttpError(
      409,
      "Das ausgewählte KI-Modell ist deaktiviert. Aktiviere es unter „KI & Modelle“ oder wähle ein anderes Modell.",
    );
  if (m.workspace_id === null) {
    const w = (
      await c.query(
        "SELECT w.*,p.managed FROM workspace_context w JOIN plans p ON p.id=w.plan_id WHERE w.id=$1",
        [workspaceId],
      )
    ).rows[0];
    if (
      !w?.managed ||
      !["active", "local_test"].includes(w.subscription_status)
    )
      throw new HttpError(
        402,
        "Dein Plan erlaubt dieses Betreiber-Modell nicht.",
      );
  }
  const issue = capabilityIssue(m);
  if (issue) throw new HttpError(409, issue);
  return applyCapabilityLimits(m);
}
