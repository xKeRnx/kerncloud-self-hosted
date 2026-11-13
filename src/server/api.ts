import { projectPages, sharedProjectPage } from "./project-pages.ts";
import { starterTeams } from "../core/starter-teams.ts";
import { taskWorkplace } from "./task-workplace.ts";
import { selfHostedEdition, selfHostedRouteAllowed } from "../core/edition.ts";
import { preferredAppearance, saveAppearance } from "./appearance.ts";
import { bridgeManage, bridgeAgent, bridgeDownload } from "./bridge.ts";
import { readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { join } from "node:path";
import { budgetDecisionScope } from "../core/decision-answers.ts";
import { inspectAgent, inspectAgentTask } from "./agent-inspector.ts";
import {
  environmentOverview,
  manageOverviewEnvironment,
} from "./environment-overview.ts";
import {
  preferredProject,
  savePreferredProject,
} from "./project-preferences.ts";
import {
  submitInterest,
  interestAdmin,
  exportInterests,
} from "./self-hosted-waitlist.ts";
import { teamTemplates } from "./team-templates.ts";
import {
  organisationData,
  saveProject,
  planHuman,
  saveOrganisation,
  projectFor,
  assignEnvironment,
  shareMaterial,
} from "./organisation.ts";
import {
  workerCapacity,
  drainWorker,
  autoscalerLease,
} from "./worker-capacity.ts";
import { runMaintenance } from "./scheduled-work.ts";
import {
  workApps,
  startWorkApp,
  callbackWorkApp,
  adminWorkApps,
} from "./work-apps.ts";
import { projects } from "./projects.ts";
import {
  saveTokenIntegration,
  checkIntegration,
} from "./integration-connections.ts";
import { quality, tickQuality } from "./quality.ts";
import {
  environmentBudgets,
  tickIdleEnvironments,
} from "./environment-budgets.ts";
import { searchKnowledge, readKnowledge } from "./knowledge-search.ts";
import { briefings, tickBriefings } from "./briefings.ts";
import { manageTeam, acceptTeamInvite } from "./team.ts";
import { workspacePermission } from "../core/workspace-permissions.ts";
import { listDecisions, respondDecision } from "./decisions.ts";
import { landingAccount } from "./landing-account.ts";
import { reconcileMonthlyAllowances } from "./monthly-allowances.ts";
import { customerUsage } from "./usage.ts";
import { negotiateLocale } from "../core/language-negotiation.ts";
import { accessExpired } from "../core/account-access.ts";
import {
  customerAdmin,
  supportRoute,
  customerBenefits,
  grantReceipt,
} from "./customer-admin.ts";
import { projectResults } from "./project-results.ts";
import { workspaceHome, workspaceTasks } from "./workspace-dashboard.ts";
import { allowSupport } from "../core/support-policy.ts";
import { forgotPassword, resetPassword } from "./password-reset.ts";
import { deliverNextMail } from "./mail.ts";
import { expireCustomerAccess } from "./access-expiry.ts";
import { syncInvoiceProfiles } from "./invoice-profile-sync.ts";
import {
  adminEinvoices,
  billingRecipient,
  customerEinvoices,
  invoiceDownload,
  processEinvoice,
  importStripeEinvoice,
} from "./einvoices.ts";
import { companyAdmin, resolvedLegalHtml } from "./company.ts";
import {
  submitDeclaration,
  adminDeclarations,
} from "./contract-declarations.ts";
import { apiErrorMessage } from "../core/api-error-language.ts";
import { environmentGrants } from "./environment-tools.ts";
import {
  customerRuntimeView,
  customerEnvironment,
  adminRuntime,
} from "./runtime.ts";
import { launchEnvironment, environmentBase } from "./environment-access.ts";
import { runtimeCheckout } from "./runtime-payments.ts";
import { controlExecution } from "./execution-control.ts";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z, ZodError } from "zod";
import { ensureDb, pool, transaction, audit, seedWorkspace } from "./db.ts";
import {
  HttpError,
  session,
  requireAdmin,
  checkOrigin,
  authenticate,
} from "./auth.ts";
import {
  encrypt,
  decrypt,
  hashToken,
  sameSecret,
  verifyPassword,
  redact,
} from "./security.ts";
import {
  snapshot,
  createRun,
  changeRun,
  claim,
  event,
  lockTask,
} from "./store.ts";
import { runCheckpoints, environmentCheckpoints } from "./checkpoints.ts";
import { saveRunPolicy } from "./run-policy.ts";
import { reviewSkill, skillHistory, skillEvidence } from "./learned-skills.ts";
import { context, modelStep, toolStep, checkpoint } from "./engine.ts";
import { customerHosts } from "./customer-hosts.ts";
import { executionPolicy } from "./execution-policy.ts";
import {
  guardedToolStep,
  keepAliveWorkerResult,
  workerError,
} from "./worker-recovery.ts";
import { artifactResponse, runArchive } from "./artifacts.ts";
import { networkEndpoint, withMcp } from "./mcp.ts";
import type { Message, Workspace, User } from "../core/types.ts";
import { listModels, saveModel, validateModel } from "./catalog.ts";
import { checkModel, modelAction } from "./model-monitor.ts";
import { discoverModel, listProviderModels } from "./model-discovery.ts";
import { liveStream } from "./live.ts";
import { scalingStatus } from "./scaling.ts";
import { synchronization } from "./synchronization.ts";
import { workspacePaths } from "../core/navigation.ts";
import { housekeeping } from "./housekeeping.ts";
import { runtimeInsights } from "./runtime-insights.ts";
import { runProcesses } from "./process-view.ts";
import { forgetMemorySource } from "./memory-provenance.ts";
import {
  listAutomations,
  automationAction,
  automationWebhook,
  tickAutomations,
} from "./automations.ts";
import {
  listMemory,
  writeMemory,
  memoryInput,
  memoryMarkdown,
} from "./memory.ts";
import {
  adminBusiness,
  publicSite,
  setting,
  legalKeys,
  profile,
  customerInvoices,
  checkout,
  billingPortal,
  invoiceUrl,
  stripeWebhook,
  recordAnalytics,
} from "./business.ts";
import { uploadFiles, importRepository, sendChat } from "./materials.ts";
import { renderLegalHtml } from "./legal-html.ts";
import { publishedPage, languagesConfig } from "./content.ts";

import {
  securityStatus,
  securityAction,
  verifyChallenge,
  securePassword,
  accountProof,
  throttleSecurity,
  issueSession,
} from "./mfa.ts";
import {
  publicLogins,
  oauthProviders,
  startOauth,
  finishOauth,
  sessionResponse,
  challengeResponse,
} from "./oauth.ts";
import { agentInfrastructure } from "./infrastructure.ts";
const str = z.string().trim().min(1).max(200),
  id = z.string().uuid();
const agentSchema = z.object({
  id: id.optional(),
  name: str,
  role: str,
  instructions: z.string().min(1).max(12000),
  skill_ids: z.array(id).max(30),
  mcp_ids: z.array(id).max(20),
  model_id: z.string().min(1).max(100).nullable().default(null),
  color: z.enum(["cyan", "violet", "amber", "green"]).default("cyan"),
});
const providerSchema = z.object({
  name: str,
  endpoint: z.string().url(),
  model: str,
  key: z.string().max(2000).optional(),
});
async function saveProvider(
  input: z.infer<typeof providerSchema>,
  workspaceId?: string,
) {
  await networkEndpoint(input.endpoint);
  if (workspaceId) {
    const old = (
      await pool.query("SELECT secret FROM providers WHERE workspace_id=$1", [
        workspaceId,
      ])
    ).rows[0];
    const secret =
      input.key !== undefined
        ? encrypt(input.key)
        : (old?.secret ?? encrypt(""));
    await pool.query(
      "INSERT INTO providers(workspace_id,name,endpoint,model,secret) VALUES($1,$2,$3,$4,$5) ON CONFLICT(workspace_id) DO UPDATE SET name=EXCLUDED.name,endpoint=EXCLUDED.endpoint,model=EXCLUDED.model,secret=EXCLUDED.secret",
      [
        workspaceId,
        input.name,
        input.endpoint.replace(/\/$/, ""),
        input.model,
        secret,
      ],
    );
  } else {
    const old = (
      await pool.query("SELECT value FROM settings WHERE id='hosted_provider'")
    ).rows[0]?.value;
    const secret =
      input.key !== undefined
        ? encrypt(input.key)
        : (old?.secret ?? encrypt(""));
    await pool.query(
      "INSERT INTO settings(id,value) VALUES('hosted_provider',$1) ON CONFLICT(id) DO UPDATE SET value=EXCLUDED.value",
      [
        JSON.stringify({
          name: input.name,
          endpoint: input.endpoint.replace(/\/$/, ""),
          model: input.model,
          secret,
        }),
      ],
    );
  }
}
async function syncLegacyProvider(workspaceId?: string) {
  const p = workspaceId
    ? (
        await pool.query("SELECT * FROM providers WHERE workspace_id=$1", [
          workspaceId,
        ])
      ).rows[0]
    : (
        await pool.query(
          "SELECT value FROM settings WHERE id='hosted_provider'",
        )
      ).rows[0]?.value;
  if (!p) return;
  await pool.query(
    "INSERT INTO model_offerings(id,workspace_id,name,provider_name,endpoint,model,secret,input_rate,output_rate) VALUES($1,$2,$3,$3,$4,$5,$6,$7,$7) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,endpoint=EXCLUDED.endpoint,model=EXCLUDED.model,secret=EXCLUDED.secret",
    [
      workspaceId ?? "legacy-hosted",
      workspaceId ?? null,
      p.name,
      p.endpoint,
      p.model,
      p.secret,
      workspaceId ? 0 : 1000,
    ],
  );
}
async function worker(
  req: NextRequest,
  path: string,
  body: Record<string, unknown>,
) {
  if (
    !sameSecret(
      req.headers.get("authorization") ?? "",
      `Bearer ${process.env.WORKER_TOKEN ?? ""}`,
    ) ||
    !process.env.WORKER_TOKEN
  )
    throw new HttpError(401, "Worker-Zugang ungültig.");
  if (path === "autoscale/capacity") {
    const b = z.object({ owned: z.array(id).max(50) }).parse(body);
    return workerCapacity(b.owned);
  }
  if (path === "autoscale/drain") {
    const b = z.object({ id, draining: z.boolean() }).parse(body);
    return { ok: await drainWorker(b.id, b.draining) };
  }
  if (path === "autoscale/lease") {
    const b = z
      .object({
        group: z.string().regex(/^[a-zA-Z0-9_-]{1,60}$/),
        token: z.string().uuid(),
      })
      .parse(body);
    return { ok: await autoscalerLease(b.group, b.token) };
  }
  if (path === "register") {
    const b = z
      .object({ id, name: str, concurrency: z.number().int().min(1).max(8) })
      .parse(body);
    await pool.query(
      "INSERT INTO workers(id,name,concurrency) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET last_seen=now(),name=EXCLUDED.name,concurrency=EXCLUDED.concurrency",
      [b.id, b.name, b.concurrency],
    );
    return { ok: true };
  }
  if (path === "claim") {
    const b = z.object({ workerId: id }).parse(body);
    await expireCustomerAccess();
    const result = await claim(b.workerId);
    return result ? { task: result.task } : { task: null };
  }
  if (path === "maintenance") {
    z.object({ workerId: id }).parse(body);
    if (process.env.MAINTENANCE_MODE !== "external") await runMaintenance();
    return { ok: true };
  }
  const b = z.object({ taskId: id, lease: id }).parse(body);
  if (path === "heartbeat") {
    await transaction(async (c) => {
      await lockTask(c, b.taskId, b.lease);
      await c.query(
        "UPDATE tasks SET lease_until=now()+interval '90 seconds' WHERE id=$1",
        [b.taskId],
      );
    });
    return { ok: true };
  }
  if (path === "defer") {
    const seconds = z.number().int().min(1).max(86400).parse(body.seconds);
    await transaction(async (c) => {
      const { task } = await lockTask(c, b.taskId, b.lease);
      await c.query(
        "UPDATE tasks SET status='queued',not_before=now()+$2*interval '1 second',error='Wartet auf Anbieterfreigabe',lease_token=NULL,lease_until=NULL,worker_id=NULL WHERE id=$1",
        [task.id, seconds],
      );
      await event(
        c,
        task.workspace_id,
        task.run_id,
        task.agent_id,
        "provider_wait",
        `Anbieterpause: nächster Versuch frühestens in ${seconds} Sekunden; keine KI-Token verbraucht.`,
      );
    });
    return { ok: true };
  }
  if (path === "context") return context(b.taskId, b.lease);
  const messages = z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant", "tool"]),
        content: z.string().nullable(),
        tool_calls: z
          .array(
            z.object({
              id: z.string(),
              type: z.literal("function"),
              function: z.object({ name: z.string(), arguments: z.string() }),
            }),
          )
          .optional(),
        tool_call_id: z.string().optional(),
        recovery_code: z.string().max(80).optional(),
      }),
    )
    .max(1500)
    .parse(body.messages) as Message[];
  if (path === "model")
    return modelStep(
      b.taskId,
      b.lease,
      messages,
      z.array(z.unknown()).max(100).parse(body.tools),
      req.signal,
    );
  if (path === "checkpoint") {
    const c = z
      .object({
        finish: z.string().max(100000).optional(),
        error: z.string().max(20000).optional(),
        inputRequired: z.string().max(20000).optional(),
      })
      .parse(body);
    const checkpointResult = await checkpoint(
      b.taskId,
      b.lease,
      messages,
      c.finish,
      c.error,
      c.inputRequired,
    );
    return { ok: true, ...checkpointResult };
  }
  if (path === "tool") {
    const t = z
      .object({
        callId: str,
        name: str,
        mapping: z.record(z.object({ connectionId: id, toolName: z.string() })),
      })
      .parse(body);
    return guardedToolStep(
      b.taskId,
      b.lease,
      t.callId,
      t.name,
      body.args,
      messages,
      t.mapping,
    );
  }
  throw new HttpError(404, "Worker-Funktion fehlt.");
}
async function admin(
  user: User,
  path: string,
  method: string,
  body: Record<string, unknown>,
) {
  requireAdmin(user);
  if (path === "runtime")
    return adminRuntime(user.id, method === "GET" ? undefined : body);
  const business = await adminBusiness(user, path, body, method);
  if (business !== null) return business;
  if (path === "models/catalog" && method === "POST")
    return listProviderModels(null, body);
  if (path === "models/discover" && method === "POST")
    return discoverModel(null, body);
  if (path === "models/action" && method === "POST")
    return modelAction(user.id, null, body);
  if (path === "models" && method !== "GET")
    return saveModel(user.id, body, null);
  if (method === "GET") {
    const [users, workspaces, plans, campaigns, logs, hosted, usage] =
      await Promise.all([
        pool.query(
          "SELECT id,email,name,role,suspended,marketing_consent,created_at FROM users ORDER BY created_at DESC",
        ),
        pool.query(
          "SELECT w.*,u.email FROM workspace_context w JOIN users u ON u.id=w.owner_id ORDER BY w.created_at DESC",
        ),
        pool.query("SELECT * FROM plans ORDER BY price_cents"),
        pool.query("SELECT * FROM campaigns ORDER BY title"),
        pool.query(
          "SELECT a.*,u.email FROM audit a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 100",
        ),
        pool.query("SELECT value FROM settings WHERE id='hosted_provider'"),
        pool.query(
          "SELECT count(*)::int AS calls,coalesce(sum(tokens),0)::bigint AS tokens FROM model_calls",
        ),
      ]);
    const p = hosted.rows[0]?.value;
    return {
      models: await listModels(undefined, true),
      users: users.rows,
      workspaces: workspaces.rows,
      plans: plans.rows,
      campaigns: campaigns.rows,
      audit: logs.rows,
      usage: usage.rows[0],
      hosted: p
        ? {
            name: p.name,
            endpoint: p.endpoint,
            model: p.model,
            configured: true,
          }
        : null,
      billing: "local_test",
    };
  }
  if (path === "provider") {
    const b = providerSchema.parse(body);
    await saveProvider(b);
    await syncLegacyProvider();
    await transaction((c) =>
      audit(c, user.id, "admin.hosted_provider.update", "provider"),
    );
    return { ok: true };
  }
  if (path === "plan") {
    const b = z
      .object({
        id: z.string().regex(/^[a-z0-9-]{1,40}$/),
        name: str,
        price_cents: z.number().int().min(0).max(10000000),
        credits: z.number().int().min(0).max(100000000),
        max_agents: z.number().int().min(1).max(50),
        max_steps: z.number().int().min(1).max(500),
        managed: z.boolean(),
        active: z.boolean(),
        stripe_price_id: z
          .string()
          .regex(/^price_[a-zA-Z0-9_]+$/)
          .max(100)
          .nullable()
          .default(null),
        max_workspaces: z.number().int().min(1).max(100).default(1),
        max_environments: z.number().int().min(0).max(100).default(0),
        max_running_environments: z.number().int().min(0).max(100).default(0),
        runtime_minutes: z.number().int().min(0).max(1000000).default(0),
        max_customer_hosts: z.number().int().min(0).max(100).default(0),
        max_local_environments: z.number().int().min(0).max(100).default(0),
        max_running_local: z.number().int().min(0).max(100).default(0),
        monthly_steps: z.number().int().min(1).max(1000000).default(1000),
        max_parallel_tasks: z.number().int().min(1).max(100).default(2),
        max_automations: z.number().int().min(0).max(1000).optional(),
        automation_runs: z.number().int().min(0).max(1000000).optional(),
        environment_templates: z
          .array(z.string().regex(/^[a-z0-9-]{1,50}$/))
          .max(50)
          .default([]),
      })
      .parse(body);
    if (
      b.max_running_environments > b.max_environments ||
      b.max_running_local > b.max_local_environments
    )
      throw new HttpError(
        400,
        "Gleichzeitig laufende Umgebungen dürfen die gebuchten Plätze nicht überschreiten.",
      );
    await transaction(async (c) => {
      const columns = Object.keys(b) as (keyof typeof b)[];
      await c.query(
        `INSERT INTO plans(${columns.join(",")}) VALUES(${columns.map((_, i) => "$" + (i + 1)).join(",")}) ON CONFLICT(id) DO UPDATE SET ${columns
          .filter((k) => k !== "id")
          .map((k) => `${k}=EXCLUDED.${k}`)
          .join(",")}`,
        columns.map((k) =>
          k === "environment_templates" ? JSON.stringify(b[k]) : b[k],
        ),
      );
      await audit(c, user.id, "admin.plan.update", b.id);
    });
    return { ok: true };
  }
  if (path === "workspace") {
    const b = z
      .object({
        id,
        plan_id: z.string(),
        creditAdjustment: z
          .number()
          .int()
          .min(-100000000)
          .max(100000000)
          .default(0),
      })
      .parse(body);
    await transaction(async (c) => {
      const w = (
        await c.query("SELECT * FROM workspace_context WHERE id=$1", [b.id])
      ).rows[0];
      if (!w) throw new HttpError(404, "Workspace fehlt.");
      const plan = (
        await c.query("SELECT * FROM plans WHERE id=$1", [b.plan_id])
      ).rows[0];
      if (!plan) throw new HttpError(404, "Plan fehlt.");
      const account = (
        await c.query("SELECT * FROM accounts WHERE id=$1 FOR UPDATE", [
          w.account_id,
        ])
      ).rows[0];
      if (account.credits + b.creditAdjustment < 0)
        throw new HttpError(400, "Guthaben darf nicht negativ sein.");
      await c.query(
        "UPDATE accounts SET plan_id=$2,credits=credits+$3,subscription_status='local_test' WHERE id=$1",
        [w.account_id, b.plan_id, b.creditAdjustment],
      );
      if (b.creditAdjustment)
        await c.query(
          "INSERT INTO ledger(id,workspace_id,amount,reason) VALUES($1,$2,$3,$4)",
          [
            randomUUID(),
            b.id,
            b.creditAdjustment,
            "Manuelle Testgutschrift durch Administrator",
          ],
        );
      await audit(c, user.id, "admin.workspace.plan_and_credits", b.id);
    });
    return { ok: true };
  }
  if (path === "user") {
    const b = z.object({ id, suspended: z.boolean() }).parse(body);
    if (b.id === user.id)
      throw new HttpError(
        400,
        "Das eigene Administratorkonto kann hier nicht gesperrt werden.",
      );
    await transaction(async (c) => {
      await c.query(
        "UPDATE users SET suspended=$2 WHERE id=$1 AND role<>'admin'",
        [b.id, b.suspended],
      );
      if (b.suspended) {
        await c.query("DELETE FROM sessions WHERE user_id=$1", [b.id]);
        await c.query(
          "UPDATE runs SET status='paused' WHERE workspace_id IN(SELECT id FROM workspaces WHERE owner_id=$1) AND status='running'",
          [b.id],
        );
      }
      await audit(
        c,
        user.id,
        b.suspended ? "admin.user.suspend" : "admin.user.restore",
        b.id,
      );
    });
    return { ok: true };
  }
  if (path === "campaign") {
    const b = z
      .object({
        id: id.optional(),
        title: str,
        body: z.string().min(1).max(4000),
        code: z.string().regex(/^[A-Z0-9_-]{2,30}$/),
        discount_percent: z.number().int().min(0).max(100),
        active: z.boolean(),
        expires_at: z.string().datetime().nullable().default(null),
      })
      .parse(body);
    const campaignId = b.id ?? randomUUID();
    await transaction(async (c) => {
      await c.query(
        "INSERT INTO campaigns(id,title,body,code,discount_percent,active,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,body=EXCLUDED.body,code=EXCLUDED.code,discount_percent=EXCLUDED.discount_percent,active=EXCLUDED.active,expires_at=EXCLUDED.expires_at",
        [
          campaignId,
          b.title,
          b.body,
          b.code,
          b.discount_percent,
          b.active,
          b.expires_at,
        ],
      );
      await audit(c, user.id, "admin.campaign.update", campaignId);
    });
    return { id: campaignId };
  }
  throw new HttpError(404, "Admin-Funktion fehlt.");
}
async function selectedRequestProject(
  req: NextRequest,
  workspace: string,
  user: string,
) {
  return preferredProject(
    user,
    workspace,
    req.headers.get("x-project-id") ??
      req.nextUrl.searchParams.get("projectId"),
  );
}
export async function handle(req: NextRequest, path: string) {
  try {
    if (selfHostedEdition && !selfHostedRouteAllowed(path))
      throw new HttpError(404, "In dieser lokalen Edition nicht verfügbar.");
    await ensureDb();
    if (path === "health") {
      if (process.env.MAINTENANCE_MODE !== "external")
        await reconcileMonthlyAllowances();
      if (process.env.MAINTENANCE_MODE !== "external") await housekeeping();
    }
    if (path === "auth/status" && req.method === "GET")
      return NextResponse.json(
        { authenticated: await landingAccount(req) },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    if (path === "health")
      return NextResponse.json({
        status: "ok",
        service: "kerncloud",
        version: "0.41.0",
        edition: selfHostedEdition ? "self-hosted" : "operator",
      });
    if (path === "billing/webhook" && req.method === "POST")
      return NextResponse.json(
        await stripeWebhook(
          await readBody(req, 2000000),
          req.headers.get("stripe-signature") ?? "",
        ),
      );
    if (path === "attachments/upload" && req.method === "POST") {
      checkOrigin(req);
      const { workspace, user, support } = await session(req);
      workspace.project_id = (
        await selectedRequestProject(req, workspace.id, user.id)
      ).id;
      if (
        !workspacePermission(workspace.membership_role ?? "owner", path, "POST")
      )
        throw new HttpError(403, "Your workspace role cannot upload files");
      if (support && !allowSupport(path, "POST", support.mode))
        throw new HttpError(
          403,
          "Dateiupload ist im lesenden Supportmodus gesperrt.",
        );
      if (user.password_change_required && !support)
        throw new HttpError(
          428,
          "Bitte zuerst das vorläufige Passwort ändern.",
        );
      if (accessExpired(workspace))
        throw new HttpError(403, "Der KeRnCloud-Zugang ist abgelaufen.");
      if (support)
        await transaction((c) =>
          audit(
            c,
            support.actor_id,
            "admin.support.write",
            user.id + ":" + path,
          ),
        );
      const bytes = await readBody(req, 12000000);
      const form = await new Request("http://local/upload", {
        method: "POST",
        headers: { "content-type": req.headers.get("content-type") ?? "" },
        body: new Uint8Array(bytes),
      }).formData();
      return NextResponse.json(
        await uploadFiles(workspace.id, form, workspace.project_id),
      );
    }
    if (Number(req.headers.get("content-length") ?? 0) > 2000000)
      throw new HttpError(413, "Anfrage zu groß.");
    const method = req.method;
    const raw =
      method === "GET" || method === "DELETE"
        ? {}
        : JSON.parse((await readBody(req, 2000000)).toString("utf8"));
    const body = z.record(z.unknown()).parse(raw);
    if (
      ["worker/model", "worker/tool"].includes(path) &&
      req.headers.get("x-kc-worker-stream") === "keepalive"
    ) {
      if (
        !process.env.WORKER_TOKEN ||
        !sameSecret(
          req.headers.get("authorization") ?? "",
          `Bearer ${process.env.WORKER_TOKEN}`,
        )
      )
        throw new HttpError(401, "Worker-Zugang ungültig.");
      return keepAliveWorkerResult(
        worker(req, path.slice(7), body),
        req.signal,
      );
    }
    if (path.startsWith("worker/"))
      return NextResponse.json(await worker(req, path.slice(7), body));
    if (/^automations\/hooks\/[a-f0-9-]{36}$/.test(path) && method === "POST")
      return NextResponse.json(
        await automationWebhook(
          path.split("/")[2],
          (req.headers.get("authorization") ?? "").replace(/^Bearer /, ""),
          req.headers.get("idempotency-key") ?? "",
        ),
        { status: 202 },
      );
    if (method !== "GET") checkOrigin(req);
    if (
      path === "support/status" &&
      method === "GET" &&
      !req.cookies.get("kc_support")
    )
      return NextResponse.json({ active: false });
    if (path.startsWith("support/")) {
      const response = await supportRoute(req, path, body);
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }
    if (req.cookies.get("kc_support") && path.startsWith("auth/"))
      throw new HttpError(
        403,
        "Im Supportmodus keine Anmeldung oder Kontosicherheit ändern. Zuerst Supportmodus beenden.",
      );
    if (path === "public/self-hosted-interest") {
      if (method !== "POST") throw new HttpError(405, "Methode nicht erlaubt.");
      if (req.cookies.get("kc_support"))
        throw new HttpError(403, "Im Supportmodus gesperrt.");
      return NextResponse.json(await submitInterest(body), {
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    if (path === "auth/password-forgot" && method === "POST")
      return NextResponse.json(await forgotPassword(body));
    if (path === "contracts/declarations" && method === "POST") {
      if (req.cookies.get("kc_support"))
        throw new HttpError(
          403,
          "Vertragserklärungen sind im Supportmodus gesperrt.",
        );
      return NextResponse.json(await submitDeclaration(body), {
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    if (path === "auth/password-reset/check" && method === "POST")
      return NextResponse.json(await resetPassword(body, true));
    if (path === "auth/password-reset" && method === "POST")
      return NextResponse.json(await resetPassword(body));
    if (path === "public/bridge/updates" && method === "GET") {
      try {
        const payload = await readFile(
          join(process.cwd(), "bridge-app/releases/updates.json"),
          "utf8",
        );
        return new NextResponse(payload, {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      } catch {
        return NextResponse.json(
          { error: "Update service unavailable" },
          { status: 503, headers: { "Cache-Control": "no-store" } },
        );
      }
    }
    if (path === "public/bridge/manifest" && method === "GET")
      return NextResponse.json(
        JSON.parse(
          await readFile(
            join(process.cwd(), "bridge-app/releases/manifest.json"),
            "utf8",
          ),
        ),
        { headers: { "Cache-Control": "public, max-age=300" } },
      );
    if (path.startsWith("public/bridge/download/") && method === "GET") {
      const { file, entry } = await bridgeDownload(
        path.slice("public/bridge/download/".length),
      );
      return new NextResponse(
        Readable.toWeb(createReadStream(file)) as ReadableStream,
        {
          headers: {
            "Content-Length": String(entry.bytes),
            "Content-Type": entry.name.endsWith(".md")
              ? "text/markdown; charset=utf-8"
              : entry.name.endsWith(".pdf")
                ? "application/pdf"
                : entry.name.endsWith(".exe")
                  ? "application/vnd.microsoft.portable-executable"
                  : entry.name.endsWith(".deb")
                    ? "application/vnd.debian.binary-package"
                    : entry.name.endsWith(".dmg")
                      ? "application/x-apple-diskimage"
                      : "application/zip",
            "Content-Disposition": 'attachment; filename="' + entry.name + '"',
            "Cache-Control": "public, max-age=3600",
            "X-Content-Type-Options": "nosniff",
          },
        },
      );
    }
    if (path.startsWith("bridge/agent/")) {
      if (
        method !== "POST" ||
        req.headers.get("origin") ||
        req.cookies.get("kc_support")
      )
        throw new HttpError(403, "Nur lokale Geräteanfragen erlaubt.");
      return NextResponse.json(
        await bridgeAgent(req, path.slice("bridge/agent/".length), body),
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (path.startsWith("infrastructure/agent/"))
      return NextResponse.json(
        await agentInfrastructure(
          req,
          path.slice("infrastructure/agent/".length),
          body,
        ),
      );
    if (path === "auth/providers" && method === "GET")
      return NextResponse.json(await publicLogins());
    if (path.startsWith("auth/oauth/")) {
      const [, , provider, operation] = path.split("/");
      const p = z.enum(oauthProviders).parse(provider);
      if (operation === "callback" && method === "GET")
        return finishOauth(req, p);
      if (operation === "start" && method === "GET")
        return startOauth(
          req,
          p,
          req.nextUrl.searchParams.get("intent") === "signup"
            ? "signup"
            : "login",
        );
      if (operation === "link" && method === "POST")
        return startOauth(req, p, "link", body);
      throw new HttpError(405, "OAuth-Aktion nicht erlaubt.");
    }
    if (path === "auth/mfa" && method === "POST") {
      const b = z.object({ code: z.string().min(6).max(80) }).parse(body);
      const token = req.cookies.get("kc_login_challenge")?.value;
      if (!token) throw new HttpError(401, "Bitte zuerst anmelden.");
      return sessionResponse(await verifyChallenge(token, b.code));
    }
    if (path === "auth/mfa/cancel" && method === "POST") {
      const token = req.cookies.get("kc_login_challenge")?.value;
      if (token)
        await pool.query("DELETE FROM login_challenges WHERE id=$1", [
          hashToken(token),
        ]);
      const res = NextResponse.json({ ok: true });
      res.cookies.delete("kc_login_challenge");
      return res;
    }
    if (path === "site" && method === "GET")
      return NextResponse.json(await publicSite());
    if (path.startsWith("pages/") && method === "GET") {
      const locale = negotiateLocale(
        {
          explicit: req.nextUrl.searchParams.get("lang"),
          cookie: req.cookies.get("kc_locale")?.value,
          acceptLanguage: req.headers.get("accept-language"),
        },
        await languagesConfig(),
      );
      const page = await publishedPage(path.slice(6), locale);
      if (!page) throw new HttpError(404, "Seite fehlt.");
      return NextResponse.json(page);
    }
    if (path.startsWith("legal/") && method === "GET") {
      const key = path.split("/")[1];
      if (!(legalKeys as readonly string[]).includes(key))
        throw new HttpError(404, "Seite fehlt.");
      const locale = negotiateLocale(
        {
          explicit: req.nextUrl.searchParams.get("lang"),
          cookie: req.cookies.get("kc_locale")?.value,
          acceptLanguage: req.headers.get("accept-language"),
        },
        await languagesConfig(),
      );
      const page = await setting(
        locale === "de" ? `legal:${key}` : `legal:en:${key}`,
      );
      if (!page?.published)
        throw new HttpError(
          404,
          "Dieser Text wurde vom Betreiber noch nicht veröffentlicht.",
        );
      return NextResponse.json({
        ...page,
        content: await resolvedLegalHtml(page),
        format: "html",
        html: await resolvedLegalHtml(page),
      });
    }
    if (path === "analytics/event" && method === "POST") {
      if (req.cookies.get("kc_support"))
        return NextResponse.json({ recorded: false });
      let userId: string | null = null;
      try {
        userId = (await session(req)).user.id;
      } catch {}
      return NextResponse.json(
        await recordAnalytics(
          body,
          userId,
          req.headers.get("user-agent") ?? "",
        ),
      );
    }
    if (path === "auth/login" || path === "auth/signup") {
      const input = z
        .object({
          email: z.string().email().max(254),
          password: z.string().min(12).max(128),
          name: z.string().min(1).max(80).optional(),
          privacyAccepted: z.boolean().optional(),
          marketingConsent: z.boolean().optional(),
        })
        .parse(body);
      const result = await authenticate(req, input, path.endsWith("signup"));
      if ("challenge" in result) return challengeResponse(result.challenge!);
      return sessionResponse(result.token!);
    }
    if (path === "team/accept" && method === "POST") {
      if (req.cookies.get("kc_support"))
        throw new HttpError(403, "Im Supportmodus gesperrt.");
      const own = await session(req, true);
      if (own.user.password_change_required)
        throw new HttpError(428, "Change provisional password first");
      return NextResponse.json(
        await acceptTeamInvite(own.user.id, own.user.email, body),
      );
    }
    if (
      /^suite\/apps\/callback\/(google|microsoft|github)$/.test(path) &&
      method === "GET"
    )
      return await callbackWorkApp(
        req,
        path.split("/").at(-1) as "google" | "microsoft" | "github",
      );
    if (path.startsWith("shared-project-pages/") && method === "GET")
      return await sharedProjectPage(path.split("/")[1]);
    const { user, workspace, support } = await session(req);
    workspace.project_id = (
      await selectedRequestProject(req, workspace.id, user.id)
    ).id;
    if (
      !workspacePermission(
        workspace.membership_role ?? "owner",
        path,
        method,
        body,
      )
    )
      throw new HttpError(
        403,
        "Deine Workspace-Rolle erlaubt diese Aktion nicht.",
      );
    if (support && !allowSupport(path, method, support.mode))
      throw new HttpError(
        403,
        "Diese Aktion ist im Supportmodus gesperrt. Sicherheit, Zahlung und Zugangsschlüssel bleiben geschützt.",
      );
    if (support && method !== "GET" && path !== "preferences/project")
      await transaction((c) =>
        audit(c, support.actor_id, "admin.support.write", user.id + ":" + path),
      );
    if (user.password_change_required && !support) {
      if (path === "state")
        return NextResponse.json({ passwordChangeRequired: true, user });
      if (
        !["profile/password", "profile/security", "auth/logout"].includes(path)
      )
        throw new HttpError(
          428,
          "Bitte zuerst das vorläufige Passwort ändern.",
        );
    }
    if (
      accessExpired(workspace) &&
      method !== "GET" &&
      !path.startsWith("admin") &&
      !path.startsWith("profile") &&
      !path.startsWith("privacy") &&
      !path.startsWith("billing") &&
      ![
        "auth/logout",
        "workspaces/select",
        "preferences/project",
        "preferences/appearance",
      ].includes(path)
    )
      throw new HttpError(
        403,
        "Der KeRnCloud-Zugang ist abgelaufen. Konto und Belege bleiben zugänglich.",
      );
    if (
      /^agents\/[^/]+\/inspect(?:\/task\/[^/]+)?$/.test(path) &&
      method === "GET"
    ) {
      const parts = path.split("/");
      return NextResponse.json(
        parts.length === 3
          ? await inspectAgent(
              user.id,
              workspace.id,
              parts[1],
              req.nextUrl.searchParams,
            )
          : await inspectAgentTask(
              user.id,
              workspace.id,
              parts[1],
              parts[4],
              req.nextUrl.searchParams,
            ),
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    if (
      path === "preferences/appearance" &&
      (method === "GET" || method === "POST")
    ) {
      // Identity comes exclusively from the authenticated session, never the request body.
      return NextResponse.json(
        method === "POST"
          ? await saveAppearance(user.id, body)
          : await preferredAppearance(user.id),
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    if (path === "preferences/project" && method === "POST") {
      const b = z.object({ id }).parse(body);
      const project = await projectFor(pool, workspace.id, b.id);
      // Support navigation stays ephemeral and never changes the customer's preference.
      return NextResponse.json(
        support
          ? { id: project.id, saved: false }
          : await savePreferredProject(user.id, workspace.id, project.id),
      );
    }
    if (
      /^runs\/[^/]+\/workplace$/.test(path) &&
      ["GET", "POST"].includes(method)
    )
      return NextResponse.json(
        await taskWorkplace(
          user.id,
          workspace.id,
          path.split("/")[1],
          method === "POST" ? body : undefined,
        ),
        { headers: { "Cache-Control": "private, no-store" } },
      );
    if (path === "client/config" && method === "GET")
      return NextResponse.json(
        { environmentBase: environmentBase().origin },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    if (path === "suite/starter-teams" && method === "GET")
      return NextResponse.json({ teams: starterTeams });
    if (path === "project-pages" || path.startsWith("project-pages/")) {
      const response = await projectPages(
        user.id,
        workspace.id,
        workspace.project_id!,
        method,
        path.split("/"),
        body,
      );
      return response instanceof Response
        ? response
        : NextResponse.json(response, {
            headers: { "Cache-Control": "private, no-store" },
          });
    }
    if (path === "suite/templates" && method === "POST")
      return NextResponse.json(
        await teamTemplates(user.id, workspace.id, workspace.project_id, body),
      );
    if (path === "suite/organisation" && method === "GET")
      return NextResponse.json(
        await organisationData(
          workspace.id,
          workspace.project_id,
          z
            .enum(["all", "projects", "timeline", "organisation"])
            .parse(req.nextUrl.searchParams.get("section") ?? "all"),
        ),
      );
    if (path === "suite/work-projects" && method === "POST")
      return NextResponse.json(await saveProject(user.id, workspace.id, body));
    if (path === "suite/plan" && method === "POST")
      return NextResponse.json(await planHuman(user.id, workspace.id, body));
    if (path === "suite/organisation" && method === "POST")
      return NextResponse.json(
        await saveOrganisation(user.id, workspace.id, body),
      );
    if (path === "suite/environment-project" && method === "POST")
      return NextResponse.json(
        await assignEnvironment(user.id, workspace.id, body),
      );
    if (path === "suite/material-sharing" && method === "GET")
      return NextResponse.json({
        items: (
          await pool.query(
            "SELECT id,name,workspace_shared,'attachment' kind FROM attachments WHERE workspace_id=$1 AND project_id=$2 UNION ALL SELECT id,title name,workspace_shared,'memory' kind FROM memories WHERE workspace_id=$1 AND project_id=$2 UNION ALL SELECT id,name,workspace_shared,'skill' kind FROM skills WHERE workspace_id=$1 AND project_id=$2",
            [workspace.id, workspace.project_id],
          )
        ).rows,
      });
    if (path === "suite/material-sharing" && method === "POST")
      return NextResponse.json(
        await shareMaterial(user.id, workspace.id, body),
      );
    if (path === "admin/self-hosted-interests/export" && method === "GET")
      return new NextResponse(await exportInterests(req, user), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition":
            'attachment; filename="kerncloud-self-hosted-interests.csv"',
          "Cache-Control": "private, no-store",
        },
      });
    if (path === "admin/self-hosted-interests")
      return NextResponse.json(await interestAdmin(req, user, body), {
        headers: { "Cache-Control": "private, no-store" },
      });
    if (path === "admin/scaling" && method === "GET") {
      requireAdmin(user);
      return NextResponse.json(await scalingStatus());
    }
    if (path === "admin/work-apps") {
      requireAdmin(user);
      return NextResponse.json(
        await adminWorkApps(user.id, method === "GET" ? undefined : body),
      );
    }
    if (path === "suite/apps/token" && method === "POST")
      return NextResponse.json(
        await saveTokenIntegration(user.id, workspace.id, body),
      );
    if (path === "suite/apps/check" && method === "POST")
      return NextResponse.json(
        await checkIntegration(user.id, workspace.id, body),
      );
    if (path === "suite/apps")
      return NextResponse.json(
        await workApps(
          user.id,
          workspace.id,
          method === "GET" ? undefined : body,
        ),
      );
    if (path === "suite/apps/connect" && method === "POST")
      return NextResponse.json(
        await startWorkApp(req, user.id, workspace.id, body),
      );
    if (path === "suite/projects")
      return NextResponse.json(
        await projects(
          user.id,
          workspace.id,
          method === "GET" ? undefined : body,
          workspace.project_id,
        ),
      );
    if (path === "suite/projects/preview" && method === "POST") {
      if (workspace.owner_id !== user.id)
        throw new HttpError(
          403,
          "Running preview currently requires the workspace owner",
        );
      const p = (
        await pool.query(
          "SELECT environment_id,preview_port FROM work_projects WHERE id=$1 AND workspace_id=$2",
          [z.object({ id: z.string().uuid() }).parse(body).id, workspace.id],
        )
      ).rows[0];
      if (!p?.preview_port)
        throw new HttpError(409, "No preview port configured");
      return NextResponse.json(
        await launchEnvironment(req, workspace.id, {
          id: p.environment_id,
          target_path: "/proxy/" + p.preview_port + "/",
        }),
      );
    }
    if (path === "suite/quality" || path === "suite/quality/start")
      return NextResponse.json(
        await quality(
          user.id,
          workspace.id,
          method === "GET" ? undefined : body,
        ),
      );
    if (path === "team")
      return NextResponse.json(
        await manageTeam(
          user.id,
          workspace.id,
          method === "GET" ? undefined : body,
        ),
      );
    if (path === "team/leave" && method === "POST")
      return NextResponse.json(
        await manageTeam(user.id, workspace.id, { action: "leave" }),
      );
    if (path === "knowledge/search")
      return NextResponse.json(
        await searchKnowledge(
          workspace.id,
          method === "GET"
            ? { query: req.nextUrl.searchParams.get("q") ?? "" }
            : body,
          pool,
          workspace.project_id,
        ),
      );
    if (path === "knowledge/read")
      return NextResponse.json(
        await readKnowledge(
          workspace.id,
          method === "GET"
            ? Object.fromEntries(req.nextUrl.searchParams)
            : body,
          pool,
          workspace.project_id,
        ),
      );
    if (
      path === "briefings" ||
      path === "briefings/read" ||
      path === "briefings/refresh"
    )
      return NextResponse.json(
        await briefings(
          user.id,
          workspace.id,
          method === "GET"
            ? undefined
            : path === "briefings/read"
              ? { ...(body as object), action: "read" }
              : path === "briefings/refresh"
                ? { action: "refresh" }
                : body,
        ),
      );
    if (path === "environments/budgets")
      return NextResponse.json(
        await environmentBudgets(
          user.id,
          workspace.id,
          method === "GET" ? undefined : body,
        ),
      );
    if (path === "decisions" && method === "GET")
      return NextResponse.json({
        items: await listDecisions(
          workspace.id,
          req.nextUrl.searchParams.get("history") === "1",
          user.id,
        ),
      });
    if (path === "decisions/respond" && method === "POST")
      return NextResponse.json(
        await respondDecision(user.id, workspace.id, body),
      );
    if (path === "runtime/processes" && method === "GET")
      return NextResponse.json(
        await runProcesses(
          workspace.id,
          z.string().uuid().parse(req.nextUrl.searchParams.get("runId")),
        ),
        { headers: { "Cache-Control": "private, no-store" } },
      );
    if (path === "automations" && method === "GET")
      return NextResponse.json(
        await listAutomations(workspace.id, workspace.project_id),
        {
          headers: { "Cache-Control": "private, no-store" },
        },
      );
    if (path === "automations" && method === "POST")
      return NextResponse.json(
        await automationAction(
          user.id,
          workspace.id,
          body,
          workspace.project_id,
        ),
      );
    if (path === "runtime/insights" && method === "GET")
      return NextResponse.json(await runtimeInsights(workspace.id), {
        headers: { "Cache-Control": "private, no-store" },
      });
    if (path === "usage" && method === "GET")
      return NextResponse.json(
        await customerUsage(workspace, req.nextUrl.searchParams),
        { headers: { "Cache-Control": "private, no-store" } },
      );
    if (path === "admin/einvoices" || path.startsWith("admin/einvoices/")) {
      requireAdmin(user);
      const result = await adminEinvoices(
        req,
        user,
        path.slice(6),
        body,
        method,
      );
      const response =
        result instanceof Response ? result : NextResponse.json(result);
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }
    if (
      (path === "billing/recipient" && ["GET", "POST"].includes(method)) ||
      (path === "billing/einvoices" && method === "GET")
    ) {
      const result =
        path === "billing/recipient"
          ? await billingRecipient(
              workspace.account_id,
              method === "POST" ? body : undefined,
            )
          : { invoices: await customerEinvoices(workspace.account_id) };
      return NextResponse.json(result, {
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    if (
      /^billing\/einvoices\/[^/]+\/(xrechnung\.xml|zugferd\.pdf)$/.test(path) &&
      method === "GET"
    )
      return await invoiceDownload(
        workspace.account_id,
        path.split("/")[2],
        path.split("/")[3],
      );
    if (path === "admin/mail" || path.startsWith("admin/customers")) {
      requireAdmin(user);
      const result = await customerAdmin(
        req,
        user,
        path.slice(6),
        body,
        method,
      );
      const response =
        result instanceof Response ? result : NextResponse.json(result);
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }
    if (
      [
        "admin/company",
        "admin/company/invoice-profile",
        "admin/company/invoice-preview",
        "admin/legal-template",
        "admin/contracts",
      ].includes(path)
    ) {
      requireAdmin(user);
      const result =
        path === "admin/contracts"
          ? await adminDeclarations(req, user, body, method)
          : await companyAdmin(req, user, path.slice(6), body, method);
      const response =
        result instanceof Response ? result : NextResponse.json(result);
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }
    if (path === "account/benefits" && method === "GET")
      return NextResponse.json(await customerBenefits(workspace));
    if (/^account\/benefits\/[^/]+\/receipt$/.test(path) && method === "GET")
      return await grantReceipt(workspace.account_id, path.split("/")[2]);
    if (path === "profile/oauth/unlink" && method === "POST") {
      const b = z
        .object({
          provider: z.enum(oauthProviders),
          password: z.string().max(128).default(""),
          code: z.string().max(80).default(""),
        })
        .parse(body);
      await throttleSecurity(`account-security:${user.id}`);
      const token = await transaction(async (c) => {
        const row = (
          await c.query(
            "SELECT password_enabled FROM users WHERE id=$1 FOR UPDATE",
            [user.id],
          )
        ).rows[0];
        await accountProof(c, user.id, req, b.password, b.code);
        const count = (
          await c.query(
            "SELECT count(*)::int AS n FROM oauth_identities WHERE user_id=$1",
            [user.id],
          )
        ).rows[0].n;
        if (!row.password_enabled && count <= 1)
          throw new HttpError(
            409,
            "Bitte zuerst ein lokales Passwort oder einen weiteren Anmeldedienst einrichten.",
          );
        await c.query(
          "DELETE FROM oauth_identities WHERE user_id=$1 AND provider=$2",
          [user.id, b.provider],
        );
        await c.query("DELETE FROM sessions WHERE user_id=$1", [user.id]);
        await audit(c, user.id, "security.oauth.unlinked", b.provider);
        await c.query("DELETE FROM oauth_states WHERE link_user_id=$1", [
          user.id,
        ]);
        await c.query("DELETE FROM login_challenges WHERE user_id=$1", [
          user.id,
        ]);
        const enabled = (
          await c.query(
            "SELECT 1 FROM account_security WHERE user_id=$1 AND totp_secret IS NOT NULL",
            [user.id],
          )
        ).rowCount;
        return issueSession(c, user.id, Boolean(enabled));
      });
      return sessionResponse(token);
    }
    if (path === "profile/security" && method === "GET")
      return NextResponse.json(await securityStatus(user.id));
    if (path.startsWith("profile/security/") && method === "POST") {
      const result = await securityAction(
        user.id,
        req,
        path.split("/")[2],
        body,
      );
      const { sessionToken, ...data } = result as typeof result & {
        sessionToken?: string;
      };
      if (!sessionToken) return NextResponse.json(data);
      const response = sessionResponse(sessionToken);
      return new NextResponse(JSON.stringify(data), {
        status: 200,
        headers: response.headers,
      });
    }
    if (path === "execution/control" && method === "POST")
      return NextResponse.json(
        await controlExecution(user.id, workspace.id, body),
      );
    if (path === "profile/password" && method === "POST")
      return sessionResponse(
        (await securePassword(user.id, req, body)).sessionToken,
      );
    if (path === "environments/agents" && method === "POST")
      return NextResponse.json(
        await environmentGrants(user.id, workspace.id, body),
      );
    if (path === "environments/access" && method === "POST") {
      const b = z.object({ id: z.string().uuid() }).parse(body);
      const environment = (
        await pool.query(
          "SELECT e.endpoint,e.status,c.secret,t.access_mode FROM customer_environments e JOIN environment_credentials c ON c.environment_id=e.id JOIN environment_templates t ON t.id=e.template_id WHERE e.id=$1 AND e.workspace_id=$2",
          [b.id, workspace.id],
        )
      ).rows[0];
      if (
        !environment ||
        environment.status !== "running" ||
        !environment.endpoint
      )
        throw new HttpError(409, "Kein laufender lokaler Zugang verfügbar.");
      return NextResponse.json(
        {
          endpoint: environment.endpoint,
          username: environment.access_mode === "basic" ? "kerncloud" : null,
          password: decrypt(environment.secret),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (path === "environments/manage" && method === "POST")
      return NextResponse.json(
        await customerEnvironment(user.id, workspace, body),
      );
    if (path === "environments/launch" && method === "POST")
      return NextResponse.json(
        await launchEnvironment(req, workspace.id, body, workspace.project_id),
        { headers: { "Cache-Control": "no-store" } },
      );
    if (path === "bridge") {
      if (!["GET", "POST"].includes(method))
        throw new HttpError(405, "Methode nicht erlaubt.");
      return NextResponse.json(
        await bridgeManage(
          user.id,
          workspace,
          method === "GET" ? undefined : body,
        ),
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    if (path === "customer-hosts")
      return NextResponse.json(
        await customerHosts(
          user.id,
          workspace,
          method === "GET" ? undefined : body,
        ),
        { headers: { "Cache-Control": "private, no-store" } },
      );
    if (path === "execution-policy")
      return NextResponse.json(
        await executionPolicy(
          user.id,
          workspace,
          method === "GET" ? undefined : body,
        ),
        { headers: { "Cache-Control": "private, no-store" } },
      );
    if (path === "environments/overview" && method === "GET")
      return NextResponse.json(
        await environmentOverview(user.id, workspace, req.nextUrl.searchParams),
        { headers: { "Cache-Control": "private, no-store" } },
      );
    if (path === "environments/overview/manage" && method === "POST")
      return NextResponse.json(
        await manageOverviewEnvironment(user.id, workspace, body),
      );
    if (path === "runtime" && method === "GET")
      return NextResponse.json(await customerRuntimeView(workspace));
    if (path === "runtime/checkout" && method === "POST")
      return NextResponse.json(await runtimeCheckout(user, workspace, body));
    if (path === "environments" && method === "GET")
      return NextResponse.json({
        environments: (
          await pool.query(
            "SELECT e.id,e.name,e.status,e.template_id,e.project_id,e.created_at,e.updated_at FROM customer_environments e WHERE workspace_id=$1 AND e.project_id=coalesce($2,kc_default_project($1)) ORDER BY created_at DESC",
            [workspace.id, workspace.project_id ?? null],
          )
        ).rows,
      });
    if (
      /^artifacts\/[^/]+\/(?:download|preview|source)$/.test(path) &&
      method === "GET"
    )
      return await artifactResponse(
        workspace.id,
        path.split("/")[1],
        path.split("/")[2],
      );
    if (/^runs\/[^/]+\/download$/.test(path) && method === "GET")
      return await runArchive(workspace.id, path.split("/")[1]);
    if (/^runs\/[^/]+\/retry$/.test(path) && method === "POST") {
      const previous = (
        await pool.query("SELECT * FROM runs WHERE id=$1 AND workspace_id=$2", [
          path.split("/")[1],
          workspace.id,
        ])
      ).rows[0];
      if (!previous) throw new HttpError(404, "Auftrag nicht gefunden.");
      if (!["completed", "failed", "canceled"].includes(previous.status))
        throw new HttpError(409, "Laufenden Auftrag zuerst beenden.");
      const roots = (
        await pool.query(
          "SELECT agent_id FROM tasks WHERE run_id=$1 AND parent_id IS NULL ORDER BY created_at",
          [previous.id],
        )
      ).rows;
      if (!roots.length)
        throw new HttpError(
          409,
          "Ursprünglicher Agent fehlt. Bitte einen neuen Auftrag anlegen.",
        );
      const ids = (
        await pool.query(
          "SELECT attachment_id FROM run_attachments WHERE run_id=$1",
          [previous.id],
        )
      ).rows.map((r) => r.attachment_id);
      return NextResponse.json(
        await createRun(
          workspace,
          previous.goal,
          roots[0].agent_id,
          ids,
          previous.chat,
          roots.map((r) => r.agent_id),
        ),
      );
    }
    if (path === "memory/source" && method === "POST")
      return NextResponse.json(
        await forgetMemorySource(user.id, workspace.id, body),
      );
    if (path === "memory/source" && method === "GET")
      return NextResponse.json(
        {
          entries: (
            await pool.query(
              "SELECT kind,source_id,created_at FROM memory_exclusions WHERE workspace_id=$1 ORDER BY created_at DESC",
              [workspace.id],
            )
          ).rows,
        },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    if (path === "memory" && method === "POST")
      return NextResponse.json(
        await transaction(async (c) => {
          const result = await writeMemory(
            c,
            workspace.id,
            memoryInput.parse(body),
            user.id,
            true,
            false,
            workspace.project_id,
          );
          await audit(c, user.id, "memory.update", result.id);
          return result;
        }),
      );
    if (path === "memory" && method === "GET")
      return NextResponse.json({
        entries: await transaction((c) =>
          listMemory(
            c,
            workspace.id,
            req.nextUrl.searchParams.get("q") ?? "",
            true,
            workspace.project_id,
          ),
        ),
      });
    if (path === "memory/export" && method === "GET")
      return new NextResponse(
        memoryMarkdown(
          await transaction((c) =>
            listMemory(c, workspace.id, "", true, workspace.project_id),
          ),
        ),
        {
          headers: {
            "Content-Type": "text/markdown; charset=utf-8",
            "Content-Disposition": 'attachment; filename="knowledge.md"',
          },
        },
      );
    if (path === "memory/delete" && method === "POST") {
      const b = z
        .object({
          key: z.string().max(100),
          expected_revision: z.number().int().min(1),
        })
        .parse(body);
      const result = await pool.query(
        "DELETE FROM memories WHERE workspace_id=$1 AND key=$2 AND revision=$3 RETURNING id",
        [workspace.id, b.key, b.expected_revision],
      );
      if (!result.rowCount)
        throw new HttpError(
          409,
          "Eintrag fehlt oder wurde inzwischen geändert.",
        );
      return NextResponse.json({ ok: true });
    }
    if (path === "profile")
      return NextResponse.json(
        await profile(user, method === "POST" ? body : undefined),
      );
    if (path === "billing/invoices" && method === "GET")
      return NextResponse.json({ invoices: await customerInvoices(workspace) });
    if (path === "billing/portal" && method === "POST")
      return NextResponse.json(await billingPortal(workspace));
    if (/^billing\/invoices\/[^/]+\/download$/.test(path) && method === "GET")
      return NextResponse.redirect(
        await invoiceUrl(workspace, path.split("/")[2]),
      );
    if (path === "live" && method === "GET")
      return liveStream(
        workspace.id,
        req.signal,
        workspace.account_id,
        user.id,
        async () => {
          const current = await session(req);
          return (
            current.workspace.id === workspace.id && current.user.id === user.id
          );
        },
        workspace.project_id,
      );
    if (path === "auth/logout") {
      await pool.query("DELETE FROM sessions WHERE id=$1", [
        hashToken(req.cookies.get("kc_session")!.value),
      ]);
      const res = NextResponse.json({ ok: true });
      res.cookies.delete("kc_session");
      res.cookies.delete("kc_workspace");
      return res;
    }
    if (path === "workspaces" && method === "POST") {
      const b = z
        .object({ name: z.string().trim().min(1).max(100) })
        .parse(body);
      const id = await transaction(async (c) => {
        const a = (
          await c.query("SELECT * FROM accounts WHERE owner_id=$1 FOR UPDATE", [
            user.id,
          ])
        ).rows[0];
        const p = (
          await c.query("SELECT * FROM plans WHERE id=$1", [a.plan_id])
        ).rows[0];
        const count = (
          await c.query("SELECT count(*) FROM workspaces WHERE owner_id=$1", [
            user.id,
          ])
        ).rows[0].count;
        if (Number(count) >= p.max_workspaces)
          throw new HttpError(402, "Workspace-Limit deines Plans erreicht.");
        return seedWorkspace(c, user.id, b.name, true);
      });
      return NextResponse.json({ id });
    }
    if (path === "workspaces/select" && method === "POST") {
      const b = z.object({ id }).parse(body);
      if (
        !(
          await pool.query(
            "SELECT id FROM workspaces w WHERE id=$1 AND (owner_id=$2 OR EXISTS(SELECT 1 FROM workspace_members m WHERE m.workspace_id=w.id AND m.user_id=$2))",
            [b.id, user.id],
          )
        ).rowCount
      )
        throw new HttpError(403, "Fremder Workspace.");
      const res = NextResponse.json({ ok: true });
      res.cookies.set("kc_workspace", b.id, {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.PUBLIC_URL?.startsWith("https://") ?? false,
        path: "/",
      });
      return res;
    }
    if (path === "models/catalog" && method === "POST")
      return NextResponse.json(await listProviderModels(workspace.id, body));
    if (path === "models/discover" && method === "POST")
      return NextResponse.json(await discoverModel(workspace.id, body));
    if (path === "models/action" && method === "POST")
      return NextResponse.json(await modelAction(user.id, workspace.id, body));
    if (path === "models" && method === "POST")
      return NextResponse.json(await saveModel(user.id, body, workspace.id));
    if (path === "default-model" && method === "POST") {
      const b = z.object({ modelId: z.string().min(1).max(100) }).parse(body);
      await transaction(async (c) => {
        const m = await validateModel(c, workspace.id, b.modelId);
        await c.query(
          "UPDATE workspaces SET default_model_id=$2,ai_mode=$3 WHERE id=$1",
          [
            workspace.id,
            b.modelId,
            m.workspace_id === null ? "managed" : "byok",
          ],
        );
      });
      return NextResponse.json({ ok: true });
    }
    if (path === "attachments/github" && method === "POST")
      return NextResponse.json(
        await importRepository(workspace.id, body, workspace.project_id),
      );
    if (/^attachments\/[^/]+$/.test(path)) {
      const fileId = path.split("/")[1];
      if (method === "DELETE") {
        await transaction(async (c) => {
          await c.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
            workspace.id,
          ]);
          if (
            (
              await c.query(
                "SELECT r.id FROM runs r JOIN run_attachments a ON a.run_id=r.id WHERE a.attachment_id=$1 AND r.workspace_id=$2 AND r.project_id=$3 AND r.status IN('running','paused','input_required')",
                [fileId, workspace.id, workspace.project_id],
              )
            ).rowCount
          )
            throw new HttpError(
              409,
              "Datei wird noch von einem offenen Auftrag benötigt.",
            );
          await c.query(
            "DELETE FROM attachments WHERE id=$1 AND workspace_id=$2 AND project_id=$3",
            [fileId, workspace.id, workspace.project_id],
          );
        });
        return NextResponse.json({ ok: true });
      }
      if (method === "GET") {
        const file = (
          await pool.query(
            "SELECT id,name,content,source FROM attachments WHERE id=$1 AND workspace_id=$2 AND (project_id=$3 OR workspace_shared)",
            [fileId, workspace.id, workspace.project_id],
          )
        ).rows[0];
        if (!file) throw new HttpError(404, "Datei fehlt.");
        return NextResponse.json(file);
      }
    }
    if (path === "chat" && method === "POST")
      return NextResponse.json(await sendChat(workspace, body));
    if (path.startsWith("admin"))
      return NextResponse.json(
        await admin(user, path.split("/").slice(1).join("/"), method, body),
      );
    if (path === "project/results" && method === "GET")
      return NextResponse.json(
        await projectResults(
          workspace.id,
          workspace.project_id!,
          req.nextUrl.searchParams,
        ),
        { headers: { "Cache-Control": "private, no-store" } },
      );
    if (path === "workspace/home" && method === "GET")
      return NextResponse.json(await workspaceHome(workspace.id), {
        headers: { "Cache-Control": "private, no-store" },
      });
    if (path === "workspace/tasks" && method === "GET")
      return NextResponse.json(
        await workspaceTasks(workspace.id, req.nextUrl.searchParams),
        { headers: { "Cache-Control": "private, no-store" } },
      );
    if (path === "state") {
      const params = req.nextUrl.searchParams,
        view = params.get("view") ?? undefined;
      if (view && !Object.hasOwn(workspacePaths, view))
        throw new HttpError(400, "Ungültige Ansicht.");
      const runId = params.get("runId") ?? undefined;
      if (runId && !/^[a-zA-Z0-9_-]{1,100}$/.test(runId))
        throw new HttpError(400, "Ungültiger Auftrag.");
      let before: { created_at: string; id: string } | undefined;
      if (params.has("before")) {
        try {
          const raw = params.get("before")!;
          if (raw.length > 500) throw new Error();
          before = z
            .object({
              created_at: z.string().datetime(),
              id: z.string().min(1).max(100),
            })
            .strict()
            .parse(JSON.parse(Buffer.from(raw, "base64url").toString()));
        } catch {
          throw new HttpError(400, "Ungültiger Seitencursor.");
        }
      }
      return NextResponse.json(
        {
          ...(await snapshot(user, workspace, { view, runId, before })),
          appearance: {
            ...(await preferredAppearance(user.id)),
            canSave: !support,
          },
        },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    if (path === "synchronization" && method === "GET")
      return synchronization(
        {
          workspace: workspace.id,
          account: workspace.account_id,
          user: user.id,
        },
        req.signal,
        async () => {
          const current = await session(req);
          return (
            current.workspace.id === workspace.id && current.user.id === user.id
          );
        },
      );
    if (path === "runs" && method === "POST") {
      const b = z
        .object({
          workMode: z.enum(["draft", "execute", "team"]).optional(),
          goal: z.string().trim().min(5).max(20000),
          agentId: id,
          projectId: id.optional(),
          planItemId: id.optional(),
          tokenLimit: z.number().int().min(1000).max(10000000).optional(),
          creditLimit: z.number().int().min(0).max(10000000).optional(),
          attachmentIds: z.array(id).max(20).default([]),
        })
        .parse(body);
      const defaults = (
        await pool.query(
          "SELECT run_token_limit,run_credit_limit FROM workspaces WHERE id=$1",
          [workspace.id],
        )
      ).rows[0];
      if (
        (b.tokenLimit !== undefined &&
          b.tokenLimit > defaults.run_token_limit) ||
        (b.creditLimit !== undefined &&
          b.creditLimit > defaults.run_credit_limit)
      )
        throw new HttpError(
          409,
          "Auftragslimit liegt über den aktuellen Workspace-Standards. Bitte Budgeteinstellungen prüfen.",
        );
      return NextResponse.json(
        await createRun(
          workspace,
          b.goal,
          b.agentId,
          b.attachmentIds,
          false,
          [b.agentId],
          "",
          {
            projectId: b.projectId ?? workspace.project_id,
            planItemId: b.planItemId,
            workMode: b.workMode,
            userBudget:
              b.tokenLimit !== undefined || b.creditLimit !== undefined,
            tokenLimit: b.tokenLimit,
            creditLimit: b.creditLimit,
          },
        ),
      );
    }
    if (/^runs\/[^/]+$/.test(path) && method === "PATCH") {
      const b = z
        .object({ action: z.enum(["pause", "resume", "cancel"]) })
        .parse(body);
      await changeRun(workspace.id, path.split("/")[1], b.action);
      return NextResponse.json({ ok: true });
    }
    if (/^runs\/[^/]+\/message$/.test(path)) {
      const b = z
        .object({ message: z.string().trim().min(1).max(12000) })
        .parse(body);
      await transaction(async (c) => {
        const r = (
          await c.query(
            "SELECT * FROM runs WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
            [path.split("/")[1], workspace.id],
          )
        ).rows[0];
        if (!r) throw new HttpError(404, "Auftrag fehlt.");
        if (["completed", "failed", "canceled"].includes(r.status))
          throw new HttpError(409, "Auftrag bereits beendet.");
        await event(c, workspace.id, r.id, null, "user_message", b.message);
        const tasks = (
          await c.query(
            "SELECT * FROM tasks WHERE run_id=$1 AND status='input_required' AND NOT EXISTS(SELECT 1 FROM decisions d WHERE d.task_id=tasks.id AND d.kind='approval' AND d.status='pending') FOR UPDATE",
            [r.id],
          )
        ).rows;
        if (tasks.some((task) => budgetDecisionScope(task.error ?? "")))
          throw new HttpError(
            409,
            "Eine Textnachricht ändert keine Budgetgrenze. Bitte im Entscheidungs-Postfach das Limit ausdrücklich ändern, pausieren oder stoppen.",
          );
        for (const task of tasks) {
          await c.query(
            "UPDATE decisions SET status='answered',response=$2,response_action='answer',answered_by=$3,answered_at=now() WHERE task_id=$1 AND status='pending' AND kind<>'approval'",
            [task.id, b.message, user.id],
          );
          await c.query(
            "UPDATE tasks SET status='queued',error=null,messages=$2,loop_interventions=0,recovery_attempts=0 WHERE id=$1",
            [
              task.id,
              JSON.stringify([
                ...task.messages,
                { role: "user", content: b.message },
              ]),
            ],
          );
        }
      });
      return NextResponse.json({ ok: true });
    }
    if (path === "agents" && method === "POST") {
      const b = agentSchema.parse(body);
      const agentId = b.id ?? randomUUID();
      await transaction(async (c) => {
        await c.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
          workspace.id,
        ]);
        const plan = (
          await c.query("SELECT * FROM plans WHERE id=$1", [workspace.plan_id])
        ).rows[0];
        if (!b.id) {
          const count = Number(
            (
              await c.query(
                "SELECT count(*) FROM agents WHERE workspace_id=$1",
                [workspace.id],
              )
            ).rows[0].count,
          );
          if (count >= plan.max_agents)
            throw new HttpError(402, "Agentenlimit deines Plans erreicht.");
        } else if (
          !(
            await c.query(
              "SELECT id FROM agents WHERE id=$1 AND workspace_id=$2",
              [b.id, workspace.id],
            )
          ).rowCount
        )
          throw new HttpError(404, "Agent fehlt.");
        for (const [table, ids] of [
          ["skills", b.skill_ids],
          ["connections", b.mcp_ids],
        ] as const)
          if (
            ids.length &&
            (
              await c.query(
                `SELECT id FROM ${table} WHERE id=ANY($1::text[]) AND workspace_id=$2 ${table === "skills" ? "AND status='approved'" : ""}`,
                [ids, workspace.id],
              )
            ).rowCount !== ids.length
          )
            throw new HttpError(
              403,
              "Zuweisung aus fremdem Workspace abgelehnt.",
            );
        if (b.model_id) await validateModel(c, workspace.id, b.model_id);
        await c.query(
          "INSERT INTO agents(id,workspace_id,name,role,instructions,skill_ids,mcp_ids,color,model_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,role=EXCLUDED.role,instructions=EXCLUDED.instructions,skill_ids=EXCLUDED.skill_ids,mcp_ids=EXCLUDED.mcp_ids,color=EXCLUDED.color,model_id=EXCLUDED.model_id",
          [
            agentId,
            workspace.id,
            b.name,
            b.role,
            b.instructions,
            JSON.stringify(b.skill_ids),
            JSON.stringify(b.mcp_ids),
            b.color,
            b.model_id,
          ],
        );
      });
      return NextResponse.json({ id: agentId });
    }
    if (path === "environments/checkpoints" && method === "POST")
      return NextResponse.json(
        await environmentCheckpoints(
          user.id,
          hashToken(req.cookies.get("kc_session")?.value ?? ""),
          workspace.id,
          body,
        ),
      );
    if (
      /^runs\/[^/]+\/checkpoints$/.test(path) &&
      ["GET", "POST"].includes(method)
    )
      return NextResponse.json(
        await runCheckpoints(
          user.id,
          workspace.id,
          path.split("/")[1],
          method === "POST" ? body : undefined,
        ),
      );
    if (path === "run-policy" && method === "POST")
      return NextResponse.json(await saveRunPolicy(workspace.id, body));
    if (/^skills\/[^/]+\/review$/.test(path) && method === "POST")
      return NextResponse.json(
        await reviewSkill(user.id, workspace.id, path.split("/")[1], body),
      );
    if (/^skills\/[^/]+\/history$/.test(path) && method === "GET")
      return NextResponse.json({
        revisions: await skillHistory(workspace.id, path.split("/")[1]),
      });
    if (/^skills\/[^/]+\/evidence$/.test(path) && method === "GET")
      return NextResponse.json(
        await skillEvidence(workspace.id, path.split("/")[1]),
      );
    if (path === "skills" && method === "POST") {
      const b = z
        .object({
          id: id.optional(),
          name: str,
          description: z.string().min(1).max(1024),
          content: z.string().min(1).max(50000),
          version: z.number().int().min(1).optional(),
        })
        .parse(body);
      const skillId = b.id ?? randomUUID();
      if (
        b.id &&
        !(
          await pool.query(
            "SELECT id FROM skills WHERE id=$1 AND workspace_id=$2",
            [b.id, workspace.id],
          )
        ).rowCount
      )
        throw new HttpError(404, "Skill fehlt.");
      await transaction(async (c) => {
        const old = (
          await c.query(
            "SELECT * FROM skills WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
            [skillId, workspace.id],
          )
        ).rows[0];
        if (old && b.version !== old.version)
          throw new HttpError(
            409,
            "Skill wurde zwischenzeitlich geändert. Bitte neu öffnen.",
          );
        await c.query(
          "INSERT INTO skills(id,workspace_id,name,description,content,project_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,content=EXCLUDED.content,version=skills.version+1",
          [
            skillId,
            workspace.id,
            b.name,
            b.description,
            b.content,
            workspace.project_id,
          ],
        );
        if (old?.evidence?.length)
          await c.query(
            "UPDATE skills SET status='draft',reviewed_at=null,reviewed_by=null,review_note='' WHERE id=$1",
            [skillId],
          );
        await c.query(
          "INSERT INTO skill_revisions(skill_id,version,content,status,evidence) SELECT id,version,content,status,evidence FROM skills WHERE id=$1",
          [skillId],
        );
      });
      return NextResponse.json({ id: skillId });
    }
    if (path === "provider") {
      const b = providerSchema.parse(body);
      await saveProvider(b, workspace.id);
      await syncLegacyProvider(workspace.id);
      return NextResponse.json({ ok: true });
    }
    if (path === "ai-mode") {
      const b = z.object({ mode: z.enum(["byok", "managed"]) }).parse(body);
      if (b.mode === "managed") {
        const p = (
          await pool.query("SELECT managed FROM plans WHERE id=$1", [
            workspace.plan_id,
          ])
        ).rows[0];
        if (
          !p?.managed ||
          !["active", "local_test"].includes(workspace.subscription_status)
        )
          throw new HttpError(402, "Aktiver Plan mit KI-Zugang erforderlich.");
      }
      await pool.query(
        "UPDATE workspaces SET ai_mode=$2,default_model_id=null WHERE id=$1",
        [workspace.id, b.mode],
      );
      return NextResponse.json({ ok: true });
    }
    if (path === "connections") {
      const b = z
        .object({
          id: id.optional(),
          name: str,
          url: z.string().url(),
          key: z.string().max(2000).optional(),
          allowed_tools: z.array(z.string().max(200)).max(100).default([]),
          enabled: z.boolean().default(false),
        })
        .parse(body);
      await networkEndpoint(b.url);
      const old = b.id
        ? (
            await pool.query(
              "SELECT * FROM connections WHERE id=$1 AND workspace_id=$2",
              [b.id, workspace.id],
            )
          ).rows[0]
        : null;
      if (b.id && !old) throw new HttpError(404, "MCP-Verbindung fehlt.");
      const connectionId = b.id ?? randomUUID();
      await pool.query(
        "INSERT INTO connections(id,workspace_id,name,url,secret,allowed_tools,enabled) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,url=EXCLUDED.url,secret=EXCLUDED.secret,allowed_tools=EXCLUDED.allowed_tools,enabled=EXCLUDED.enabled",
        [
          connectionId,
          workspace.id,
          b.name,
          b.url,
          b.key !== undefined ? encrypt(b.key) : (old?.secret ?? encrypt("")),
          JSON.stringify(b.allowed_tools),
          b.enabled,
        ],
      );
      return NextResponse.json({ id: connectionId });
    }
    if (/^connections\/[^/]+\/discover$/.test(path)) {
      const conn = (
        await pool.query(
          "SELECT * FROM connections WHERE id=$1 AND workspace_id=$2",
          [path.split("/")[1], workspace.id],
        )
      ).rows[0];
      if (!conn) throw new HttpError(404, "Verbindung fehlt.");
      const tools = await withMcp(conn.url, decrypt(conn.secret), (c) =>
        c.listTools(),
      );
      return NextResponse.json({
        tools: tools.tools.map((t) => ({
          name: t.name,
          description: t.description,
        })),
      });
    }
    if (path === "privacy/export") {
      const workspace = (
        await pool.query(
          "SELECT * FROM workspace_context WHERE owner_id=$1 ORDER BY created_at LIMIT 1",
          [user.id],
        )
      ).rows[0];
      const owned = (
        await pool.query(
          "SELECT * FROM workspace_context WHERE owner_id=$1 ORDER BY created_at",
          [user.id],
        )
      ).rows;
      const data = [];
      for (const w of owned) {
        const state = await snapshot(user, w);
        const attachments = (
          await pool.query(
            "SELECT id,name,mime,source,content,bytes,created_at FROM attachments WHERE workspace_id=$1",
            [w.id],
          )
        ).rows;
        const chat = (
          await pool.query(
            "SELECT * FROM chat_messages WHERE workspace_id=$1 ORDER BY id",
            [w.id],
          )
        ).rows;
        const runs = (
          await pool.query("SELECT * FROM runs WHERE workspace_id=$1", [w.id])
        ).rows;
        const tasks = (
          await pool.query(
            "SELECT id,run_id,agent_id,parent_id,title,instructions,status,result,error,messages,context_state,recovery_attempts,loop_interventions,created_at FROM tasks WHERE workspace_id=$1",
            [w.id],
          )
        ).rows;
        const artifacts = (
          await pool.query(
            "SELECT id,run_id,task_id,name,content,created_at FROM artifacts WHERE workspace_id=$1",
            [w.id],
          )
        ).rows;
        const events = (
          await pool.query(
            "SELECT * FROM events WHERE workspace_id=$1 ORDER BY id",
            [w.id],
          )
        ).rows;
        const usage = (
          await pool.query(
            "SELECT id,run_id,task_id,reserved,managed,status,tokens,model_id,pricing,input_tokens,output_tokens,charged_credits,usage_known,response,created_at FROM model_calls WHERE workspace_id=$1",
            [w.id],
          )
        ).rows;
        const memory = await transaction((c) =>
          listMemory(c, w.id, "", true, null),
        );
        const memory_revisions = (
          await pool.query(
            "SELECT r.* FROM memory_revisions r JOIN memories m ON m.id=r.memory_id WHERE m.workspace_id=$1",
            [w.id],
          )
        ).rows;
        const assignments = (
          await pool.query(
            "SELECT * FROM run_attachments WHERE run_id IN(SELECT id FROM runs WHERE workspace_id=$1)",
            [w.id],
          )
        ).rows;
        data.push({
          ...state,
          work_apps: (
            await pool.query(
              "SELECT id,provider,name,scopes,agent_ids,write_enabled,enabled,created_at FROM work_app_connections WHERE workspace_id=$1",
              [w.id],
            )
          ).rows,
          project_pages: (
            await pool.query(
              "SELECT id,project_id,title,revision,artifact_id,preview_html,share_expires_at,created_at,updated_at FROM project_pages WHERE workspace_id=$1",
              [w.id],
            )
          ).rows,
          project_page_versions: (
            await pool.query(
              "SELECT v.* FROM project_page_versions v JOIN project_pages p ON p.id=v.page_id WHERE p.workspace_id=$1",
              [w.id],
            )
          ).rows,
          workspace_projects: (
            await pool.query(
              "SELECT * FROM workspace_projects WHERE workspace_id=$1",
              [w.id],
            )
          ).rows,
          project_plans: (
            await pool.query(
              "SELECT * FROM project_plan_items WHERE workspace_id=$1",
              [w.id],
            )
          ).rows,
          organisation_rules: (
            await pool.query(
              "SELECT * FROM organisation_settings WHERE workspace_id=$1",
              [w.id],
            )
          ).rows,
          organisation_history: (
            await pool.query(
              "SELECT * FROM organisation_changes WHERE workspace_id=$1 ORDER BY id",
              [w.id],
            )
          ).rows,
          projects: (
            await pool.query(
              "SELECT * FROM work_projects WHERE workspace_id=$1",
              [w.id],
            )
          ).rows,
          quality: await quality(user.id, w.id),
          team: await manageTeam(user.id, w.id),
          briefings: await briefings(user.id, w.id),
          execution_policy: (
            await pool.query(
              "SELECT allow_hosted_execution,execution_host_ids FROM workspaces WHERE id=$1",
              [w.id],
            )
          ).rows[0],
          attachments,
          chat,
          runs,
          tasks,
          artifacts,
          events,
          usage,
          assignments,
          memory,
          memory_revisions,
          memory_exclusions: (
            await pool.query(
              "SELECT kind,source_id,created_at FROM memory_exclusions WHERE workspace_id=$1",
              [w.id],
            )
          ).rows,
          decisions: await listDecisions(w.id, true),
          automations: await listAutomations(w.id, null),
          automation_usage: (
            await pool.query(
              "SELECT period,calls FROM automation_usage WHERE account_id=$1",
              [w.account_id],
            )
          ).rows,
          skill_revisions: (
            await pool.query(
              "SELECT r.* FROM skill_revisions r JOIN skills s ON s.id=r.skill_id WHERE s.workspace_id=$1",
              [w.id],
            )
          ).rows,
          checkpoints: (
            await pool.query(
              "SELECT * FROM run_checkpoints WHERE workspace_id=$1",
              [w.id],
            )
          ).rows,
        });
      }
      const ledger = (
        await pool.query(
          "SELECT amount,reason,created_at,workspace_id FROM ledger WHERE workspace_id=ANY($1::text[])",
          [owned.map((w) => w.id)],
        )
      ).rows;
      const account = (
        await pool.query(
          "SELECT email,name,privacy_version,marketing_consent,created_at FROM users WHERE id=$1",
          [user.id],
        )
      ).rows[0];
      const billingProfile = await profile(user);
      const invoices = await customerInvoices(workspace);
      const analytics = (
        await pool.query(
          "SELECT created_at,kind,page,target,referrer,bot FROM analytics_events WHERE user_id=$1",
          [user.id],
        )
      ).rows;
      return NextResponse.json(
        {
          appearance: await preferredAppearance(user.id),
          project_preferences: (
            await pool.query(
              "SELECT workspace_id,project_id,updated_at FROM user_workspace_preferences WHERE user_id=$1",
              [user.id],
            )
          ).rows,
          team_memberships: (
            await pool.query(
              "SELECT * FROM workspace_members WHERE user_id=$1",
              [user.id],
            )
          ).rows,
          team_invitations: (
            await pool.query(
              "SELECT workspace_id,email,role,expires_at,accepted_at,revoked_at,created_at FROM workspace_invitations WHERE email=$1",
              [user.email],
            )
          ).rows,
          exported_at: new Date().toISOString(),
          complimentary_benefits: await customerBenefits(workspace),
          customer_notes: (
            await pool.query(
              "SELECT content,created_at FROM customer_notes WHERE user_id=$1 ORDER BY created_at",
              [user.id],
            )
          ).rows,
          support_access: (
            await pool.query(
              "SELECT mode,reason,created_at,expires_at,ended_at FROM support_sessions WHERE target_id=$1 ORDER BY created_at",
              [user.id],
            )
          ).rows,
          contract_declarations: (
            await pool.query(
              "SELECT kind,name,email,contract,termination_type,requested_end,reason,created_at,processed_at,outcome FROM contract_declarations WHERE email=$1 ORDER BY created_at",
              [user.email],
            )
          ).rows,
          email_deliveries: (
            await pool.query(
              "SELECT purpose,status,created_at,finished_at FROM mail_outbox WHERE user_id=$1 OR recipient=$2 ORDER BY created_at",
              [user.id, user.email],
            )
          ).rows,
          customer_hosts: (
            await pool.query(
              "SELECT id,name,kind,enabled,cpu_limit,memory_limit_mb,max_running,last_seen,inventory,created_at FROM infrastructure_hosts WHERE customer_account_id=$1",
              [workspace.account_id],
            )
          ).rows,
          model_step_usage: (
            await pool.query(
              "SELECT period,used FROM account_step_usage WHERE account_id=$1",
              [workspace.account_id],
            )
          ).rows,
          account,
          billingProfile,
          security: await securityStatus(user.id),
          runtime: {
            balance: (
              await pool.query(
                "SELECT runtime_included,runtime_purchased,runtime_debt,runtime_period,runtime_period_end FROM accounts WHERE id=$1",
                [workspace.account_id],
              )
            ).rows[0],
            ledger: (
              await pool.query(
                "SELECT id,environment_id,kind,amount,period,reason,created_at FROM runtime_ledger WHERE account_id=$1",
                [workspace.account_id],
              )
            ).rows,
            orders: (
              await pool.query(
                "SELECT id,product_id,minutes,price_cents,status,refunded_cents,created_at FROM runtime_orders WHERE account_id=$1",
                [workspace.account_id],
              )
            ).rows,
          },
          environment_tools: (
            await pool.query(
              "SELECT j.id,j.environment_id,j.task_id,j.tool,j.args,j.status,j.result,j.created_at,j.finished_at FROM environment_tool_calls j JOIN customer_environments e ON e.id=j.environment_id JOIN workspaces w ON w.id=e.workspace_id WHERE w.owner_id=$1",
              [user.id],
            )
          ).rows,
          environments: (
            await pool.query(
              "SELECT e.id,e.name,e.status,e.template_id,e.workspace_id,e.agent_permissions,e.agent_ids,e.created_at FROM customer_environments e JOIN workspaces w ON w.id=e.workspace_id WHERE w.owner_id=$1",
              [user.id],
            )
          ).rows,
          invoices,
          selfHostedInterests: (
            await pool.query(
              "SELECT email,company,use_case,team_size,deployment,locale,status,note,consent_version,consented_at,created_at,expires_at FROM self_hosted_interests WHERE email=$1 AND expires_at>now()",
              [user.email.toLowerCase()],
            )
          ).rows,
          electronicInvoices: await customerEinvoices(workspace.account_id),
          billingRecipient: await billingRecipient(workspace.account_id),
          analytics,
          workspace,
          state: data.find((d) => d.workspace.id === workspace.id),
          workspaces: data,
          ledger,
        },
        {
          headers: {
            "Content-Disposition":
              'attachment; filename="kerncloud-export.json"',
          },
        },
      );
    }
    if (path === "privacy/settings") {
      const b = z
        .object({
          retention_days: z.number().int().min(1).max(365),
          marketing_consent: z.boolean(),
        })
        .parse(body);
      await transaction(async (c) => {
        await c.query("UPDATE workspaces SET retention_days=$2 WHERE id=$1", [
          workspace.id,
          b.retention_days,
        ]);
        await c.query("UPDATE users SET marketing_consent=$2 WHERE id=$1", [
          user.id,
          b.marketing_consent,
        ]);
        await c.query(
          "DELETE FROM runs WHERE workspace_id=$1 AND status IN('completed','failed','canceled') AND created_at<now()-($2*interval '1 day')",
          [workspace.id, b.retention_days],
        );
        await c.query(
          "DELETE FROM chat_messages m WHERE workspace_id=$1 AND created_at<now()-($2*interval '1 day') AND NOT EXISTS(SELECT 1 FROM runs r WHERE r.id=m.run_id AND r.status IN('running','paused','input_required'))",
          [workspace.id, b.retention_days],
        );
        await c.query(
          "DELETE FROM attachments a WHERE a.workspace_id=$1 AND a.created_at<now()-($2*interval '1 day') AND NOT EXISTS(SELECT 1 FROM run_attachments r WHERE r.attachment_id=a.id)",
          [workspace.id, b.retention_days],
        );
        await audit(c, user.id, "privacy.settings.update", workspace.id);
      });
      return NextResponse.json({ ok: true });
    }
    if (path === "privacy/delete") {
      const b = z
        .object({
          password: z.string(),
          code: z.string().max(80).default(""),
          confirmation: z.enum(["KONTO LÖSCHEN", "DELETE ACCOUNT"]),
        })
        .parse(body);
      await throttleSecurity(`account-security:${user.id}`);
      await transaction((c) =>
        accountProof(c, user.id, req, b.password, b.code),
      );
      if (
        (
          await pool.query(
            "SELECT 1 FROM customer_environments e JOIN workspaces w ON w.id=e.workspace_id WHERE w.owner_id=$1 AND e.status<>'deleted'",
            [user.id],
          )
        ).rowCount
      )
        throw new HttpError(
          409,
          "Bitte zuerst deine Containerumgebungen unter Browser & Entwicklungsumgebungen vollständig entfernen. Unklare Vorgänge durch den Betreiber prüfen lassen.",
        );
      if (user.role === "admin")
        throw new HttpError(
          409,
          "Das Administratorkonto wird über den Betreiber verwaltet.",
        );
      const paidAccount = (
        await pool.query(
          "SELECT stripe_subscription_id,subscription_status FROM accounts WHERE owner_id=$1",
          [user.id],
        )
      ).rows[0];
      if (
        paidAccount?.stripe_subscription_id &&
        !["canceled", "incomplete_expired"].includes(
          paidAccount.subscription_status,
        )
      )
        throw new HttpError(
          409,
          "Bitte das Stripe-Abonnement zuerst vollständig beenden, damit nach der Kontolöschung keine weiteren Zahlungen entstehen.",
        );
      await transaction(async (c) => {
        await c.query(
          "DELETE FROM environment_jobs WHERE environment_id IN(SELECT e.id FROM customer_environments e JOIN workspaces w ON w.id=e.workspace_id WHERE w.owner_id=$1)",
          [user.id],
        );
        await c.query(
          "DELETE FROM customer_environments WHERE workspace_id IN(SELECT id FROM workspaces WHERE owner_id=$1)",
          [user.id],
        );
        await c.query("DELETE FROM analytics_events WHERE user_id=$1", [
          user.id,
        ]);
        await audit(c, user.id, "privacy.account.deleted", "account");
        await c.query("DELETE FROM contract_declarations WHERE email=$1", [
          user.email,
        ]);
        await c.query("DELETE FROM mail_outbox WHERE recipient=$1", [
          user.email,
        ]);
        await c.query("DELETE FROM self_hosted_interests WHERE email=$1", [
          user.email.toLowerCase(),
        ]);
        await c.query("DELETE FROM users WHERE id=$1", [user.id]);
      });
      const res = NextResponse.json({ ok: true });
      res.cookies.delete("kc_session");
      res.cookies.delete("kc_workspace");
      return res;
    }
    if (path === "billing/checkout" && method === "POST")
      return NextResponse.json(await checkout(user, workspace, body));
    throw new HttpError(404, "Funktion nicht gefunden.");
  } catch (error) {
    if (path.startsWith("worker/")) {
      const fault = workerError(error);
      return NextResponse.json(fault, { status: fault.status });
    }
    let languageConfig;
    try {
      languageConfig = await languagesConfig();
    } catch {
      languageConfig = {
        enabled: ["de", "en"] as ("de" | "en")[],
        defaultLocale: "en" as const,
      };
    }
    const errorLocale = negotiateLocale(
      {
        explicit: req.nextUrl.searchParams.get("lang"),
        cookie: req.cookies.get("kc_locale")?.value,
        acceptLanguage: req.headers.get("accept-language"),
      },
      languageConfig,
    );
    if (error instanceof HttpError)
      return NextResponse.json(
        {
          error: apiErrorMessage(
            path.startsWith("worker/") ? "de" : errorLocale,
            error.message,
            error.status,
          ),
        },
        { status: error.status },
      );
    if (error instanceof ZodError)
      return NextResponse.json(
        {
          error: apiErrorMessage(errorLocale, "Bitte Eingaben prüfen.", 400),
          fields: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        },
        { status: 400 },
      );
    if (error instanceof SyntaxError)
      return NextResponse.json(
        { error: apiErrorMessage(errorLocale, "Ungültige JSON-Anfrage.", 400) },
        { status: 400 },
      );
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "23505"
    )
      return NextResponse.json(
        {
          error: apiErrorMessage(
            errorLocale,
            "Dieser Eintrag existiert bereits.",
            409,
          ),
        },
        { status: 409 },
      );
    console.error(
      "[API]",
      redact(error instanceof Error ? error.message : "Unbekannter Fehler"),
    );
    return NextResponse.json(
      {
        error: apiErrorMessage(
          errorLocale,
          "Die Aktion konnte nicht abgeschlossen werden. Bitte Konfiguration und Serverprotokoll prüfen.",
          500,
        ),
      },
      { status: 500 },
    );
  }
}

async function readBody(req: NextRequest, limit: number) {
  const reader = req.body?.getReader();
  if (!reader) return Buffer.from("{}");
  const chunks: Buffer[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new HttpError(413, "Anfrage zu groß.");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}
