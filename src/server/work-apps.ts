import { randomBytes, randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { pool, transaction, audit } from "./db.ts";
import { HttpError, session } from "./auth.ts";
import { encrypt, decrypt, hashToken, redact } from "./security.ts";
import { workspaceRole } from "./team.ts";
import {
  appProviders,
  appScopes,
  appActionInput,
  appWrites,
  appPlan,
  type AppProvider,
} from "../core/work-apps.ts";
import { lockTask } from "./store.ts";
import { decisionConsent } from "./decisions.ts";
import { executionSignal } from "./execution-control.ts";
import { integrations, integrationById } from "../core/integration-catalog.ts";
import {
  integrationPlan,
  integrationHeaders,
} from "../core/integration-plans.ts";
type Config = {
  publicUrl: string;
  providers: Partial<
    Record<AppProvider, { enabled: boolean; clientId: string; secret: string }>
  >;
};
export async function workAppConfig(): Promise<Config> {
  return (
    (await pool.query("SELECT value FROM settings WHERE id='work_apps'"))
      .rows[0]?.value ?? {
      publicUrl: process.env.PUBLIC_URL ?? "http://localhost:3100",
      providers: {},
    }
  );
}
export async function adminWorkApps(actor: string, body?: unknown) {
  let current = await workAppConfig();
  if (body) {
    const b = z
        .object({
          publicUrl: z.string().url(),
          providers: z.record(
            z.object({
              enabled: z.boolean(),
              clientId: z.string().max(500),
              secret: z.string().max(2000).optional(),
            }),
          ),
        })
        .parse(body),
      u = new URL(b.publicUrl);
    if (
      u.username ||
      u.password ||
      u.pathname !== "/" ||
      u.search ||
      u.hash ||
      (u.protocol !== "https:" &&
        !(
          u.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(u.hostname)
        ))
    )
      throw new HttpError(400, "HTTPS origin or local localhost required");
    const providers: Config["providers"] = {};
    for (const p of appProviders) {
      const v = b.providers[p] ?? { enabled: false, clientId: "" };
      providers[p] = {
        ...v,
        secret: v.secret
          ? encrypt(v.secret)
          : (current.providers[p]?.secret ?? ""),
      };
      if (v.enabled && (!v.clientId || !providers[p]!.secret))
        throw new HttpError(400, "Client ID / secret missing");
    }
    current = { publicUrl: u.origin, providers };
    await transaction(async (c) => {
      await c.query(
        "INSERT INTO settings(id,value) VALUES('work_apps',$1) ON CONFLICT(id) DO UPDATE SET value=$1",
        [JSON.stringify(current)],
      );
      await audit(c, actor, "admin.work_apps", "work_apps");
    });
  }
  return {
    publicUrl: current.publicUrl,
    providers: Object.fromEntries(
      appProviders.map((p) => [
        p,
        {
          enabled: !!current.providers[p]?.enabled,
          clientId: current.providers[p]?.clientId ?? "",
          configured: !!current.providers[p]?.secret,
          callback: current.publicUrl + "/api/suite/apps/callback/" + p,
        },
      ]),
    ),
  };
}
export async function workApps(
  actor: string,
  workspace: string,
  body?: unknown,
) {
  const role = await workspaceRole(actor, workspace);
  if (body) {
    if (!["owner", "admin"].includes(role))
      throw new HttpError(403, "Workspace administration required");
    const b = z
      .object({
        id: z.string().uuid(),
        action: z.enum(["configure", "disconnect"]),
        agent_ids: z.array(z.string().uuid()).max(100).default([]),
        write_enabled: z.boolean().default(false),
        project_ids: z.array(z.string().uuid()).max(100).nullable().optional(),
      })
      .parse(body);
    await transaction(async (c) => {
      const existing = (
        await c.query(
          "SELECT * FROM work_app_connections WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
          [b.id, workspace],
        )
      ).rows[0];
      if (!existing)
        throw new HttpError(404, "Integration connection not found");
      const service = integrationById(existing.service_id);
      if (b.action === "configure" && b.write_enabled && service) {
        const supportsWrites =
          service.actions.some((a) => a.write) ||
          service.operations?.some((o) => appWrites(o));
        if (!supportsWrites)
          throw new HttpError(400, "This integration is read-only");
        const required = service.scopes?.write ?? [];
        if (
          service.auth === "oauth" &&
          required.some((scope) => !existing.scopes.includes(scope))
        )
          throw new HttpError(
            409,
            "Reconnect this service with its write scopes before enabling writes",
          );
      }
      const ids = await c.query(
        "SELECT id FROM agents WHERE workspace_id=$1 AND id=ANY($2::text[])",
        [workspace, b.agent_ids],
      );
      if (ids.rowCount !== new Set(b.agent_ids).size)
        throw new HttpError(400, "Foreign agent");
      if (b.project_ids) {
        const projects = await c.query(
          "SELECT id FROM workspace_projects WHERE workspace_id=$1 AND id=ANY($2::text[])",
          [workspace, b.project_ids],
        );
        if (projects.rowCount !== new Set(b.project_ids).size)
          throw new HttpError(400, "Foreign project");
      }
      if (b.action === "disconnect")
        await c.query(
          "DELETE FROM work_app_connections WHERE id=$1 AND workspace_id=$2",
          [b.id, workspace],
        );
      else
        await c.query(
          "UPDATE work_app_connections SET agent_ids=$3,write_enabled=$4,project_ids=CASE WHEN $5::boolean THEN $6::jsonb ELSE project_ids END,revision=revision+1,updated_at=now() WHERE id=$1 AND workspace_id=$2",
          [
            b.id,
            workspace,
            JSON.stringify(b.agent_ids),
            b.write_enabled,
            b.project_ids !== undefined,
            b.project_ids === undefined || b.project_ids === null
              ? null
              : JSON.stringify(b.project_ids),
          ],
        );
      await audit(c, actor, "work_app." + b.action, b.id);
    });
  }
  const config = await workAppConfig();
  return {
    role,
    catalog: integrations,
    projects: (
      await pool.query(
        "SELECT id,name FROM workspace_projects WHERE workspace_id=$1 AND status='active' ORDER BY name",
        [workspace],
      )
    ).rows,
    providers: appProviders.map((id) => ({
      id,
      configured: !!(
        config.providers[id]?.enabled && config.providers[id]?.secret
      ),
    })),
    connections: (
      await pool.query(
        "SELECT id,provider,service_id,name,scopes,agent_ids,project_ids,write_enabled,enabled,revision,checked_at,health,health_message,updated_at FROM work_app_connections WHERE workspace_id=$1 ORDER BY created_at",
        [workspace],
      )
    ).rows,
    agents: (
      await pool.query("SELECT id,name FROM agents WHERE workspace_id=$1", [
        workspace,
      ])
    ).rows,
  };
}
export async function startWorkApp(
  req: NextRequest,
  actor: string,
  workspace: string,
  body: unknown,
) {
  if (!["owner", "admin"].includes(await workspaceRole(actor, workspace)))
    throw new HttpError(403, "Workspace administration required");
  const b = z
      .object({
        provider: z.enum(appProviders),
        name: z.string().trim().min(1).max(100),
        write: z.boolean().default(false),
        service_id: z.string().max(60).optional(),
        project_ids: z.array(z.string().uuid()).max(100).default([]),
      })
      .strict()
      .parse(body),
    config = await workAppConfig(),
    p = config.providers[b.provider];
  if (!p?.enabled || !p.clientId || !p.secret)
    throw new HttpError(
      409,
      "Work-app OAuth client not configured in administration",
    );
  const service = integrationById(b.service_id);
  if (
    b.service_id &&
    (!service || service.auth !== "oauth" || service.provider !== b.provider)
  )
    throw new HttpError(400, "Service/provider mismatch");
  const projects = await pool.query(
    "SELECT id FROM workspace_projects WHERE workspace_id=$1 AND id=ANY($2::text[])",
    [workspace, b.project_ids],
  );
  if (projects.rowCount !== new Set(b.project_ids).size)
    throw new HttpError(400, "Foreign project");
  const state = randomBytes(32).toString("base64url"),
    verifier = randomBytes(32).toString("base64url"),
    scopes = [
      ...(service?.scopes ?? appScopes[b.provider]).read,
      ...(b.write ? (service?.scopes ?? appScopes[b.provider]).write : []),
    ];
  await pool.query("DELETE FROM work_app_states WHERE expires_at<now()");
  await pool.query(
    "INSERT INTO work_app_states(id,user_id,workspace_id,provider,verifier,scopes,name,session_hash,expires_at,service_id,project_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()+interval '10 minutes',$9,$10)",
    [
      hashToken(state),
      actor,
      workspace,
      b.provider,
      encrypt(verifier),
      scopes,
      b.name,
      hashToken(req.cookies.get("kc_session")?.value ?? ""),
      service?.id ?? null,
      service ? JSON.stringify(b.project_ids) : null,
    ],
  );
  const url = new URL(
    b.provider === "google"
      ? "https://accounts.google.com/o/oauth2/v2/auth"
      : b.provider === "microsoft"
        ? "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
        : "https://github.com/login/oauth/authorize",
  );
  Object.entries({
    client_id: p.clientId,
    redirect_uri: config.publicUrl + "/api/suite/apps/callback/" + b.provider,
    response_type: "code",
    scope: scopes.join(" "),
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    ...(b.provider === "google"
      ? { access_type: "offline", prompt: "consent" }
      : {}),
  }).forEach(([k, v]) => url.searchParams.set(k, v));
  return { url: url.href };
}
const tokenUrl = (p: AppProvider) =>
  p === "google"
    ? "https://oauth2.googleapis.com/token"
    : p === "microsoft"
      ? "https://login.microsoftonline.com/common/oauth2/v2.0/token"
      : "https://github.com/login/oauth/access_token";
async function tokenRequest(
  provider: AppProvider,
  params: Record<string, string>,
) {
  const res = await fetch(tokenUrl(provider), {
    method: "POST",
    redirect: "error",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(20000),
  });
  let value: any;
  try {
    value = await res.json();
  } catch {
    throw new HttpError(
      409,
      "Invalid OAuth token response; reconnect the account",
    );
  }
  if (!res.ok || !value.access_token)
    throw new HttpError(
      409,
      "OAuth token exchange failed; reconnect the work account",
    );
  return value;
}
export async function callbackWorkApp(req: NextRequest, provider: AppProvider) {
  if (req.cookies.get("kc_support"))
    throw new HttpError(403, "Support mode blocked");
  const own = await session(req, true),
    config = await workAppConfig(),
    p = config.providers[provider];
  if (own.user.password_change_required)
    throw new HttpError(428, "Change provisional password first");
  if (!p?.enabled) throw new HttpError(409, "Provider disabled");
  const state = req.nextUrl.searchParams.get("state") ?? "",
    code = req.nextUrl.searchParams.get("code");
  if (!code || code.length > 4000)
    throw new HttpError(400, "Authorization denied or code missing");
  const row = await transaction(async (c) => {
    const r = (
      await c.query(
        "SELECT * FROM work_app_states WHERE id=$1 AND provider=$2 AND user_id=$3 AND session_hash=$4 AND expires_at>now() AND claimed_at IS NULL FOR UPDATE",
        [
          hashToken(state),
          provider,
          own.user.id,
          hashToken(req.cookies.get("kc_session")?.value ?? ""),
        ],
      )
    ).rows[0];
    if (!r) throw new HttpError(403, "OAuth state invalid");
    await c.query("UPDATE work_app_states SET claimed_at=now() WHERE id=$1", [
      r.id,
    ]);
    return r;
  });
  if (
    !["owner", "admin"].includes(
      await workspaceRole(own.user.id, row.workspace_id),
    )
  )
    throw new HttpError(403, "Workspace right revoked");
  const t = await tokenRequest(provider, {
    grant_type: "authorization_code",
    client_id: p.clientId,
    client_secret: decrypt(p.secret),
    code,
    code_verifier: decrypt(row.verifier),
    redirect_uri: config.publicUrl + "/api/suite/apps/callback/" + provider,
  });
  const scopes =
    typeof t.scope === "string"
      ? t.scope.split(/[ ,]+/).filter(Boolean)
      : row.scopes;
  await transaction(async (c) => {
    await c.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
      row.workspace_id,
    ]);
    const access = (
      await c.query(
        "SELECT CASE WHEN owner_id=$1 THEN 'owner' ELSE (SELECT role FROM workspace_members WHERE workspace_id=$2 AND user_id=$1) END role FROM workspaces WHERE id=$2",
        [own.user.id, row.workspace_id],
      )
    ).rows[0]?.role;
    if (!["owner", "admin"].includes(access))
      throw new HttpError(403, "Workspace right revoked during OAuth");
    await c.query(
      "INSERT INTO work_app_connections(id,workspace_id,provider,name,credential,scopes,service_id,project_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        randomUUID(),
        row.workspace_id,
        provider,
        row.name,
        encrypt(
          JSON.stringify({
            ...t,
            expires_at: t.expires_in
              ? Date.now() + Number(t.expires_in) * 1000
              : null,
          }),
        ),
        scopes,
        row.service_id,
        row.project_ids === null ? null : JSON.stringify(row.project_ids),
      ],
    );
  });
  return NextResponse.redirect(new URL("/apps", config.publicUrl), 303);
}
export async function appAccess(connection: string, workspace: string) {
  const config = await workAppConfig();
  return transaction(async (c) => {
    const row = (
      await c.query(
        "SELECT * FROM work_app_connections WHERE id=$1 AND workspace_id=$2 AND enabled FOR UPDATE",
        [connection, workspace],
      )
    ).rows[0];
    if (!row) throw new HttpError(403, "Work account unavailable");
    let t = JSON.parse(decrypt(row.credential));
    if (t.expires_at && t.expires_at < Date.now() + 60000) {
      const p = config.providers[row.provider as AppProvider];
      if (!p?.enabled || !t.refresh_token)
        throw new HttpError(409, "Reconnect expired work account");
      const fresh = await tokenRequest(row.provider, {
        client_id: p.clientId,
        client_secret: decrypt(p.secret),
        grant_type: "refresh_token",
        refresh_token: t.refresh_token,
      });
      t = {
        ...t,
        ...fresh,
        expires_at: Date.now() + Number(fresh.expires_in ?? 3600) * 1000,
      };
      await c.query(
        "UPDATE work_app_connections SET credential=$2 WHERE id=$1",
        [row.id, encrypt(JSON.stringify(t))],
      );
    }
    return { row, token: String(t.access_token) };
  });
}
export async function appFetch(
  token: string,
  url: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
  provider?: string,
) {
  const host = new URL(url).hostname;
  const selected =
    provider ??
    (host === "api.github.com"
      ? "github"
      : host === "graph.microsoft.com"
        ? "microsoft"
        : "google");
  const headers = integrationHeaders(selected, token, url);
  const res = await fetch(url, {
    method,
    redirect: "error",
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(25000)])
      : AbortSignal.timeout(25000),
  });
  const reader = res.body?.getReader();
  let length = 0,
    text = "";
  if (reader) {
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 300000) {
        await reader.cancel();
        throw new HttpError(413, "App result too large; narrow the query");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  }
  if (!res.ok)
    throw new HttpError(
      409,
      `Work app returned HTTP ${res.status}; check connection and permissions`,
    );
  const result = text ? JSON.parse(text) : { accepted: true };
  if (
    result?.ok === false ||
    result?.status === "error" ||
    result?.success === false ||
    (Array.isArray(result?.errors) && result.errors.length)
  )
    throw new HttpError(
      409,
      "Provider rejected the request; check token scopes, shared resources and rate limits",
    );
  // The social profile endpoint can include billing/profile metadata. Only expose useful public account fields.
  if (selected === "ayrshare" && new URL(url).pathname === "/api/user")
    return {
      activeSocialAccounts: result.activeSocialAccounts,
      displayNames: result.displayNames,
      title: result.title,
    };
  return result;
}
export function appConnectionPlan(
  row: { provider: string; service_id?: string | null },
  b: { operation: string; input: unknown },
) {
  const service = integrationById(row.service_id);
  if (row.service_id && (!service || service.provider !== row.provider))
    throw new HttpError(400, "Invalid integration configuration");
  if (service) {
    if (b.operation === "service_read" || b.operation === "service_write")
      return integrationPlan(service.id, b.operation, b.input);
    if (!service.operations?.includes(b.operation))
      throw new HttpError(403, "Operation outside this service grant");
  } else if (!appProviders.includes(row.provider as AppProvider))
    throw new HttpError(403, "Service grant missing");
  if (b.operation === "github_publish") return null;
  return appPlan(row.provider as AppProvider, b.operation as any, b.input);
}
export async function appToolStep(
  taskId: string,
  lease: string,
  callId: string,
  input: unknown,
) {
  const b = appActionInput.parse(input),
    op = taskId + ":" + callId,
    write = appWrites(b.operation);
  const scoped = await transaction(async (c) => {
    const { task, run } = await lockTask(c, taskId, lease);
    const row = (
      await c.query(
        "SELECT * FROM work_app_connections WHERE id=$1 AND workspace_id=$2 AND enabled AND agent_ids ? $3 AND (project_ids IS NULL OR project_ids ? $4)",
        [b.connection_id, task.workspace_id, task.agent_id, run.project_id],
      )
    ).rows[0];
    if (!row || (write && !row.write_enabled))
      throw new HttpError(403, "Work app not granted to this agent");
    appConnectionPlan(row, b);
    if (b.operation === "github_publish") {
      if (row.provider !== "github")
        throw new HttpError(400, "GitHub connection required");
      const { publishInput } = await import("../core/projects.ts");
      publishInput.parse(b.input);
    }
    if (write) await decisionConsent(c, task, "app_action", b, op, {});
    await c.query("INSERT INTO operations(id,task_id) VALUES($1,$2)", [
      op,
      taskId,
    ]);
    return { task, row };
  });
  const control = await executionSignal(taskId, lease);
  try {
    const { token, row } = await appAccess(
      b.connection_id,
      scoped.task.workspace_id,
    );
    if (row.revision !== scoped.row.revision)
      throw new HttpError(409, "Connection permissions changed");
    control.signal.throwIfAborted();
    let result: unknown;
    if (b.operation === "github_publish") {
      const { publishGithub } = await import("./projects.ts");
      result = await publishGithub(token, b.input, control.signal);
    } else if (b.operation === "file_read") {
      result = await readAppFile(row.provider, token, b.input, control.signal);
    } else {
      const plan = appConnectionPlan(row, b)!;
      result = await appFetch(
        token,
        plan.url,
        plan.method,
        plan.body,
        control.signal,
        row.provider,
      );
    }
    const output = {
      result: JSON.stringify({ data: result, untrusted_source: true }).slice(
        0,
        30000,
      ),
      yield: false,
    };
    await transaction(async (c) => {
      await lockTask(c, taskId, lease);
      await c.query(
        "UPDATE operations SET status='done',result=$2 WHERE id=$1",
        [op, JSON.stringify(output)],
      );
    });
    return output;
  } catch (error) {
    if (write)
      throw new HttpError(
        409,
        "External write outcome may be uncertain. Inspect the provider before repeating; this call will not be retried automatically.",
      );
    throw error;
  } finally {
    control.close();
  }
}

async function readAppFile(
  provider: AppProvider,
  token: string,
  input: unknown,
  signal: AbortSignal,
) {
  const plan = appPlan(provider, "file_read", input),
    meta = await appFetch(token, plan.url, "GET", undefined, signal);
  const id = encodeURIComponent(String((input as { id: string }).id));
  let url =
    provider === "google"
      ? String(meta.mimeType).startsWith("application/vnd.google-apps.")
        ? `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=${meta.mimeType === "application/vnd.google-apps.spreadsheet" ? "text%2Fcsv" : "text%2Fplain"}`
        : `https://www.googleapis.com/drive/v3/files/${id}?alt=media`
      : `https://graph.microsoft.com/v1.0/me/drive/items/${id}/content`;
  let response = await fetch(url, {
    redirect: "manual",
    headers: { Authorization: "Bearer " + token },
    signal,
  });
  if (provider === "microsoft" && response.status === 302) {
    const location = new URL(response.headers.get("location") ?? "");
    if (
      location.protocol !== "https:" ||
      location.username ||
      location.password ||
      ![".sharepoint.com", ".1drv.com"].some((s) =>
        location.hostname.endsWith(s),
      )
    )
      throw new HttpError(409, "File download origin not supported");
    // Microsoft pre-authenticated download URL: never forward the OAuth bearer.
    response = await fetch(location, { redirect: "error", signal });
  }
  if (!response.ok) throw new HttpError(409, "File export unavailable");
  const type = response.headers.get("content-type") ?? "";
  if (!/^(text\/|application\/(json|javascript|xml|csv))/i.test(type)) {
    await response.body?.cancel();
    return {
      id: meta.id,
      name: meta.name,
      mime: type,
      message:
        "Binary file: use a document-capable MCP or download it in the provider; no binary bytes added to model context",
    };
  }
  const reader = response.body?.getReader();
  let size = 0,
    content = "";
  const decoder = new TextDecoder();
  if (reader)
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 100000) {
        await reader.cancel();
        throw new HttpError(
          413,
          "File exceeds 100 KB text budget; choose a smaller source",
        );
      }
      content += decoder.decode(chunk.value, { stream: true });
    }
  content += decoder.decode();
  return {
    id: meta.id,
    name: meta.name,
    content,
    mime: type,
    untrusted_source: true,
  };
}
