import {
  grantRuntimeInvoice,
  applyRuntimePayment,
  applyRuntimePlanChange,
} from "./runtime-payments.ts";
import { runtimeLock } from "./runtime.ts";
import Stripe from "stripe";
import { queueStripeEinvoice } from "./einvoices.ts";
import { z } from "zod";
import { pool, transaction, audit } from "./db.ts";
import { encrypt, decrypt } from "./security.ts";
import { HttpError } from "./auth.ts";
import type { User, Workspace } from "../core/types.ts";
import { adminContent, languagesConfig, publicPageLinks } from "./content.ts";
import { adminOauth } from "./oauth.ts";
import { adminInfrastructure } from "./infrastructure.ts";
import {
  companyProfile,
  resolvedLegalHtml,
  validateLegalPublication,
  assertCompanyCheckout,
  companyInvoiceSettings,
} from "./company.ts";
import { resolveCompanyText, normalizeCompany } from "../core/company.ts";
import {
  legalPlainText,
  renderLegalHtml,
  sanitizeLegalHtml,
} from "./legal-html.ts";
export const legalKeys = [
  "impressum",
  "datenschutz",
  "agb",
  "cookies",
  "widerruf",
] as const;
export async function setting(id: string) {
  return (await pool.query("SELECT value FROM settings WHERE id=$1", [id]))
    .rows[0]?.value;
}
export async function publicSite() {
  const config = (await setting("site")) ?? {};
  const billing = (await setting("billing")) ?? {};
  const pages = [];
  for (const key of legalKeys) {
    const page = await setting(`legal:${key}`);
    pages.push({
      key,
      title: page?.title ?? key,
      published: Boolean(page?.published),
      version: page?.version ?? 0,
    });
  }
  return {
    brand: config.brand ?? "KeRnCloud",
    analyticsEnabled: Boolean(config.analyticsEnabled),
    analyticsRetention: config.analyticsRetention ?? 30,
    pages,
    consentVersion: `${pages.find((p) => p.key === "datenschutz")?.version ?? 0}:${(await setting("legal:en:datenschutz"))?.version ?? 0}`,
    languages: await languagesConfig(),
    customPages: await publicPageLinks(),
    billingEnabled: Boolean(
      billing.enabled && billing.secret && billing.webhookSecret,
    ),
  };
}
export async function adminBusiness(
  user: User,
  path: string,
  body: unknown,
  method: string,
) {
  if (path === "security")
    return adminOauth(user.id, method === "GET" ? undefined : body);
  if (path === "infrastructure")
    return adminInfrastructure(user.id, method === "GET" ? undefined : body);
  const contentResult = await adminContent(user.id, path, body, method);
  if (contentResult !== null) return contentResult;
  if (path === "site" && method === "GET") {
    const billing = (await setting("billing")) ?? {};
    const legal: Record<string, unknown> = {};
    for (const k of legalKeys)
      legal[k] = (await setting(`legal:${k}`)) ?? {
        title: k,
        content: "",
        published: false,
      };
    const english: Record<string, unknown> = {};
    for (const k of legalKeys)
      english[k] = (await setting(`legal:en:${k}`)) ?? {
        title: "",
        content: "",
        published: false,
      };
    return {
      ...(await publicSite()),
      legal,
      legalTranslations: { de: legal, en: english },
      billing: {
        enabled: Boolean(billing.enabled),
        configured: Boolean(billing.secret),
        webhookConfigured: Boolean(billing.webhookSecret),
        mode: billing.mode ?? "test",
        returnUrl: billing.returnUrl ?? "http://localhost:3100",
        automaticTax: Boolean(billing.automaticTax),
        country: billing.country ?? "DE",
        taxTreatment: billing.taxTreatment ?? "unset",
        invoiceService: billing.invoiceService ?? "",
        einvoiceStatus: "local_generator",
      },
      site: (await setting("site")) ?? {
        brand: "KeRnCloud",
        analyticsEnabled: false,
        analyticsRetention: 30,
      },
    };
  }
  if (path === "site" && method === "POST") {
    const b = z
      .object({
        brand: z.string().trim().min(1).max(80),
        analyticsEnabled: z.boolean(),
        analyticsRetention: z.number().int().min(1).max(365),
      })
      .parse(body);
    await transaction(async (c) => {
      await c.query(
        "INSERT INTO settings(id,value) VALUES('site',$1) ON CONFLICT(id) DO UPDATE SET value=EXCLUDED.value",
        [JSON.stringify(b)],
      );
      await c.query(
        "DELETE FROM analytics_events WHERE created_at<now()-($1*interval '1 day')",
        [b.analyticsRetention],
      );
      await audit(c, user.id, "admin.site.update", "site");
    });
    return { ok: true };
  }
  if (path === "legal-preview" && method === "POST") {
    const b = z
      .object({
        content: z.string().max(100000),
        format: z.enum(["text", "html"]).default("html"),
        locale: z.enum(["de", "en"]).default("en"),
      })
      .parse(body);
    return {
      html: renderLegalHtml(
        resolveCompanyText(
          b.content,
          await companyProfile(),
          b.locale,
          b.format === "html",
        ).text,
        b.format,
      ),
    };
  }
  if (path === "legal" && method === "POST") {
    const b = z
      .object({
        key: z.enum(legalKeys),
        locale: z.enum(["de", "en"]).default("en"),
        title: z.string().trim().min(1).max(150),
        content: z.string().trim().max(100000),
        format: z.enum(["text", "html"]).default("text"),
        published: z.boolean(),
        template: z.boolean().default(false),
        templateVersion: z.string().max(40).optional(),
        reviewed: z.boolean().default(false),
      })
      .parse(body);
    const content =
      b.format === "html" ? sanitizeLegalHtml(b.content) : b.content;
    if (content.length > 100000)
      throw new HttpError(400, "Der bereinigte Text ist zu lang.");
    if (b.published && legalPlainText(content, b.format).length < 50)
      throw new HttpError(
        400,
        "Zum Veröffentlichen einen vollständigen Text eintragen.",
      );
    await transaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(6820192027)");
      const company = normalizeCompany(
        (await c.query("SELECT value FROM settings WHERE id='company'")).rows[0]
          ?.value,
      );
      if (b.published) validateLegalPublication({ ...b, content }, company);
      const old = (
        await c.query("SELECT value FROM settings WHERE id=$1", [
          b.locale === "de" ? `legal:${b.key}` : `legal:en:${b.key}`,
        ])
      ).rows[0]?.value;
      const value = {
        ...b,
        content,
        version: (old?.version ?? 0) + 1,
        updated_at: new Date().toISOString(),
        companyVersion: company.version,
      };
      if (old)
        await c.query(
          "INSERT INTO settings(id,value) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [
            `legal-history:${b.locale === "de" ? "" : "en:"}${b.key}:${old.version}`,
            JSON.stringify({
              ...old,
              rendered_content: await resolvedLegalHtml(old, company),
            }),
          ],
        );
      await c.query(
        "INSERT INTO settings(id,value) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET value=EXCLUDED.value",
        [
          b.locale === "de" ? `legal:${b.key}` : `legal:en:${b.key}`,
          JSON.stringify(value),
        ],
      );
      await audit(c, user.id, "admin.legal.update", b.key);
    });
    return { ok: true };
  }
  if (path === "billing" && method === "POST") {
    const b = z
      .object({
        enabled: z.boolean(),
        mode: z.enum(["test", "live"]),
        secret: z.string().max(2000).optional(),
        webhookSecret: z.string().max(2000).optional(),
        returnUrl: z.string().url(),
        automaticTax: z.boolean(),
        country: z.literal("DE").default("DE"),
        taxTreatment: z
          .enum(["unset", "regular", "small_business"])
          .default("unset"),
        invoiceService: z.string().max(200).default(""),
      })
      .parse(body);
    const url = new URL(b.returnUrl);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !["http:", "https:"].includes(url.protocol)
    )
      throw new HttpError(400, "Ungültige Rückkehr-URL.");
    if (b.mode === "live" && url.protocol !== "https:")
      throw new HttpError(400, "Live-Zahlungen benötigen eine HTTPS-Adresse.");
    const old = (await setting("billing")) ?? {};
    if (
      old.mode &&
      old.mode !== b.mode &&
      (
        await pool.query(
          "SELECT id FROM accounts WHERE stripe_customer_id IS NOT NULL LIMIT 1",
        )
      ).rowCount
    )
      throw new HttpError(
        409,
        "Stripe-Modus ist bereits mit Kunden verknüpft. Für den Wechsel eine getrennte Umgebung verwenden.",
      );
    if (old.mode && old.mode !== b.mode && !b.secret)
      throw new HttpError(
        400,
        "Bei einem Moduswechsel bitte den passenden API-Schlüssel neu eingeben.",
      );
    if (
      b.secret &&
      !b.secret.startsWith(b.mode === "test" ? "sk_test_" : "sk_live_")
    )
      throw new HttpError(
        400,
        "Stripe-Schlüssel passt nicht zum gewählten Modus.",
      );
    const secret = b.secret ? encrypt(b.secret) : old.secret;
    const webhookSecret = b.webhookSecret
      ? encrypt(b.webhookSecret)
      : old.webhookSecret;
    if (b.enabled && (!secret || !webhookSecret))
      throw new HttpError(
        400,
        "API-Schlüssel und Webhook-Secret sind erforderlich.",
      );
    if (b.enabled) {
      for (const key of ["impressum", "datenschutz", "agb"])
        if (!(await setting(`legal:${key}`))?.published)
          throw new HttpError(
            409,
            "Vor der Aktivierung die Rechtstexte vervollständigen und veröffentlichen.",
          );
      await assertCompanyCheckout(b.mode);
    }
    await transaction(async (c) => {
      await c.query(
        "INSERT INTO settings(id,value) VALUES('billing',$1) ON CONFLICT(id) DO UPDATE SET value=EXCLUDED.value",
        [
          JSON.stringify({
            ...b,
            secret,
            webhookSecret,
            returnUrl: b.returnUrl.replace(/\/$/, ""),
          }),
        ],
      );
      await audit(c, user.id, "admin.billing.update", b.mode);
    });
    return { ok: true };
  }
  if (path === "analytics" && method === "POST") return analyticsReport(body);
  if (path === "analytics-summary" && method === "GET")
    return analyticsSummary();
  return null;
}
export async function profile(user: User, body?: unknown) {
  if (body) {
    const b = z
      .object({
        name: z.string().trim().min(1).max(80),
        company: z.string().max(200).default(""),
        billing_email: z.union([z.string().email(), z.literal("")]).default(""),
        address: z.string().max(1000).default(""),
        vat_id: z.string().max(80).default(""),
      })
      .parse(body);
    await transaction(async (c) => {
      await c.query("UPDATE users SET name=$2 WHERE id=$1", [user.id, b.name]);
      await c.query(
        "INSERT INTO profiles(user_id,company,billing_email,address,vat_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id) DO UPDATE SET company=EXCLUDED.company,billing_email=EXCLUDED.billing_email,address=EXCLUDED.address,vat_id=EXCLUDED.vat_id",
        [user.id, b.company, b.billing_email, b.address, b.vat_id],
      );
      await audit(c, user.id, "profile.update", "account");
    });
  }
  return {
    ...user,
    ...(
      await pool.query(
        "SELECT company,billing_email,address,vat_id FROM profiles WHERE user_id=$1",
        [user.id],
      )
    ).rows[0],
  };
}
export async function customerInvoices(workspace: Workspace) {
  return (
    await pool.query(
      "SELECT id,number,status,currency,amount,created_at FROM invoices WHERE account_id=$1 ORDER BY created_at DESC",
      [workspace.account_id],
    )
  ).rows;
}
export async function stripeClient() {
  const config = await setting("billing");
  if (!config?.enabled || !config.secret)
    throw new HttpError(
      503,
      "Stripe ist noch nicht eingerichtet oder aktiviert.",
    );
  return { stripe: new Stripe(decrypt(config.secret)), config };
}
export async function checkout(
  user: User,
  workspace: Workspace,
  body: unknown,
) {
  const b = z
    .object({
      planId: z.string().min(1).max(40),
      termsAccepted: z.literal(true),
    })
    .parse(body);
  const p = (
    await pool.query("SELECT * FROM plans WHERE id=$1 AND active=true", [
      b.planId,
    ])
  ).rows[0];
  if (!p?.stripe_price_id)
    throw new HttpError(409, "Dieser Plan hat noch keinen Stripe-Preis.");
  const { stripe, config } = await stripeClient();
  await assertCompanyCheckout(config.mode);
  const invoiceSettings = await companyInvoiceSettings();
  // Serialize customer creation. Stripe idempotency also protects recovery after a network interruption.
  const customerId = await transaction(async (c) => {
    const a = (
      await c.query("SELECT * FROM accounts WHERE id=$1 FOR UPDATE", [
        workspace.account_id,
      ])
    ).rows[0];
    if (
      a.stripe_subscription_id &&
      !["canceled", "incomplete_expired"].includes(a.subscription_status)
    )
      throw new HttpError(
        409,
        "Ein Abonnement besteht bereits. Bitte im Kundenportal verwalten.",
      );
    if (
      a.stripe_subscription_id &&
      ["canceled", "incomplete_expired"].includes(a.subscription_status)
    )
      await c.query(
        "UPDATE accounts SET stripe_subscription_id=null WHERE id=$1",
        [a.id],
      );
    if (a.stripe_customer_id) return a.stripe_customer_id;
    const customer = await stripe.customers.create(
      {
        email: user.email,
        name: user.name,
        metadata: { account_id: a.id },
        ...(invoiceSettings ? { invoice_settings: invoiceSettings } : {}),
      },
      { idempotencyKey: `kc-customer-${config.mode}-${a.id}` },
    );
    await c.query("UPDATE accounts SET stripe_customer_id=$2 WHERE id=$1", [
      a.id,
      customer.id,
    ]);
    return customer.id;
  });
  if (invoiceSettings)
    await stripe.customers.update(customerId, {
      invoice_settings: invoiceSettings,
    });
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: p.stripe_price_id, quantity: 1 }],
    success_url: `${config.returnUrl}/?billing=success`,
    cancel_url: `${config.returnUrl}/?billing=canceled`,
    client_reference_id: workspace.account_id,
    subscription_data: { metadata: { account_id: workspace.account_id } },
    billing_address_collection: "required",
    tax_id_collection: { enabled: true },
    customer_update: { address: "auto", name: "auto" },
    automatic_tax: { enabled: config.automaticTax },
    consent_collection: { terms_of_service: "required" },
  });
  await transaction((c) =>
    audit(c, user.id, "billing.checkout.created", session.id),
  );
  return { url: session.url };
}
export async function billingPortal(workspace: Workspace) {
  const { stripe, config } = await stripeClient();
  const a = (
    await pool.query("SELECT stripe_customer_id FROM accounts WHERE id=$1", [
      workspace.account_id,
    ])
  ).rows[0];
  if (!a.stripe_customer_id)
    throw new HttpError(409, "Noch kein Stripe-Kundenkonto vorhanden.");
  return {
    url: (
      await stripe.billingPortal.sessions.create({
        customer: a.stripe_customer_id,
        return_url: config.returnUrl,
      })
    ).url,
  };
}
export async function invoiceUrl(workspace: Workspace, id: string) {
  const row = (
    await pool.query(
      "SELECT pdf_url,hosted_url FROM invoices WHERE id=$1 AND account_id=$2",
      [id, workspace.account_id],
    )
  ).rows[0];
  if (!row) throw new HttpError(404, "Rechnung nicht gefunden.");
  const value = row.pdf_url ?? row.hosted_url;
  if (!value) throw new HttpError(409, "Rechnungsdatei noch nicht verfügbar.");
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !(url.hostname === "stripe.com" || url.hostname.endsWith(".stripe.com"))
  )
    throw new HttpError(409, "Ungültiger Rechnungslink.");
  return value;
}
export async function stripeWebhook(raw: Buffer, signature: string) {
  const config = await setting("billing");
  if (!config?.webhookSecret)
    throw new HttpError(503, "Webhook nicht eingerichtet.");
  const stripe = new Stripe(decrypt(config.secret));
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      raw,
      signature,
      decrypt(config.webhookSecret),
    );
  } catch {
    throw new HttpError(400, "Ungültige Stripe-Signatur.");
  }
  if (Boolean(event.livemode) !== (config.mode === "live"))
    throw new HttpError(400, "Falscher Stripe-Modus.");
  if (
    (await pool.query("SELECT id FROM billing_events WHERE id=$1", [event.id]))
      .rowCount
  )
    return { received: true };
  const object = event.data.object as unknown as Record<string, any>;
  if (
    event.type.startsWith("checkout.session.") &&
    object.metadata?.runtime_order_id
  ) {
    const checked = await stripe.checkout.sessions.retrieve(object.id, {
      expand: ["line_items"],
    });
    await applyRuntimePayment(event, checked);
  }
  if (
    [
      "charge.refunded",
      "charge.dispute.created",
      "charge.dispute.closed",
    ].includes(event.type)
  )
    await applyRuntimePayment(event);
  // Fetch current subscription state so delayed events cannot restore already canceled access.
  let subscription: Stripe.Subscription | undefined;
  const subId = event.type.startsWith("customer.subscription.")
    ? object.id
    : (object.parent?.subscription_details?.subscription ??
      object.subscription);
  if (subId)
    subscription = await stripe.subscriptions.retrieve(
      typeof subId === "string" ? subId : subId.id,
    );
  return applyStripeEvent(event, subscription);
}
export async function applyStripeEvent(
  event: Stripe.Event,
  subscription?: Stripe.Subscription,
) {
  const object = event.data.object as unknown as Record<string, any>;
  const customerId =
    typeof object.customer === "string" ? object.customer : object.customer?.id;
  if (
    subscription &&
    String(
      typeof subscription.customer === "string"
        ? subscription.customer
        : subscription.customer.id,
    ) !== customerId
  )
    throw new HttpError(400, "Stripe-Kundenzuordnung stimmt nicht überein.");
  await transaction(async (c) => {
    await runtimeLock(c);
    if (
      !(
        await c.query(
          "INSERT INTO billing_events(id,kind) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id",
          [event.id, event.type],
        )
      ).rowCount
    )
      return;
    const a = (
      await c.query(
        "SELECT * FROM accounts WHERE stripe_customer_id=$1 FOR UPDATE",
        [customerId ?? ""],
      )
    ).rows[0];
    if (!a) return;
    const price = subscription?.items.data[0]?.price.id;
    const p = price
      ? (await c.query("SELECT * FROM plans WHERE stripe_price_id=$1", [price]))
          .rows[0]
      : null;
    if (subscription) {
      const old = (
        await c.query("SELECT * FROM plans WHERE id=$1", [a.plan_id])
      ).rows[0];
      if (
        p &&
        event.type.startsWith("customer.subscription.") &&
        subscription.status === "active" &&
        p.id !== a.plan_id &&
        [
          "max_environments",
          "max_running_environments",
          "runtime_minutes",
          "max_agents",
          "max_workspaces",
        ].every((key) => p[key] <= old[key])
      )
        await applyRuntimePlanChange(c, a, p, "downgrade:" + event.id);
      if (
        a.stripe_subscription_id &&
        a.stripe_subscription_id !== subscription.id
      )
        throw new HttpError(
          409,
          "Mehrere Stripe-Abonnements müssen vom Betreiber geprüft werden.",
        );
      await c.query(
        "UPDATE accounts SET stripe_subscription_id=$2,subscription_status=$3,subscription_period_end=$4,subscription_cancel_at=$5,access_expires_at=CASE WHEN $3 NOT IN('active','trialing') THEN now() WHEN access_source='manual_limit' THEN access_expires_at ELSE NULL END,access_source=CASE WHEN access_source='manual_limit' THEN access_source ELSE 'stripe' END WHERE id=$1",
        [
          a.id,
          subscription.id,
          subscription.status,
          (subscription.items.data[0] as any)?.current_period_end ||
          (subscription as any).current_period_end
            ? new Date(
                ((subscription.items.data[0] as any)?.current_period_end ??
                  (subscription as any).current_period_end) * 1000,
              )
            : null,
          subscription.cancel_at
            ? new Date(subscription.cancel_at * 1000)
            : subscription.cancel_at_period_end &&
                ((subscription.items.data[0] as any)?.current_period_end ??
                  (subscription as any).current_period_end)
              ? new Date(
                  ((subscription.items.data[0] as any)?.current_period_end ??
                    (subscription as any).current_period_end) * 1000,
                )
              : null,
        ],
      );
      if (subscription.status !== "active")
        await c.query(
          "UPDATE runs SET status='paused' WHERE workspace_id IN(SELECT id FROM workspaces WHERE owner_id=$1 AND ai_mode='managed') AND status='running'",
          [a.owner_id],
        );
    }
    if (event.type.startsWith("invoice.") && object.number) {
      await c.query(
        "INSERT INTO invoices(id,account_id,number,status,currency,amount,hosted_url,pdf_url,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,to_timestamp($9)) ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,hosted_url=EXCLUDED.hosted_url,pdf_url=EXCLUDED.pdf_url RETURNING id",
        [
          object.id,
          a.id,
          object.number,
          object.status ?? "open",
          object.currency,
          object.amount_due ?? 0,
          object.hosted_invoice_url,
          object.invoice_pdf,
          object.created,
        ],
      );
      if (
        event.type === "invoice.paid" &&
        subscription?.status === "active" &&
        p &&
        object.billing_reason === "subscription_update"
      ) {
        const first = (
          await c.query(
            "INSERT INTO billing_events(id,kind) VALUES($1,'runtime_plan_update') ON CONFLICT DO NOTHING RETURNING id",
            ["plan-update:" + object.id],
          )
        ).rowCount;
        if (first) await applyRuntimePlanChange(c, a, p, object.id);
      }
      await queueStripeEinvoice(c, a.id, object);
      // Invoice ID, rather than event ID, guarantees one monthly grant across webhook retries/types.
      if (
        event.type === "invoice.paid" &&
        subscription?.status === "active" &&
        p &&
        ["subscription_create", "subscription_cycle"].includes(
          object.billing_reason,
        )
      ) {
        const first = (
          await c.query(
            "INSERT INTO billing_events(id,kind) VALUES($1,'credit_grant') ON CONFLICT DO NOTHING RETURNING id",
            [`grant:${object.id}`],
          )
        ).rowCount;
        if (first) {
          await grantRuntimeInvoice(c, a, p, object);
          await c.query(
            "UPDATE accounts SET plan_id=$2,credits=LEAST(100000000,credits+$3),subscription_status='active' WHERE id=$1",
            [a.id, p.id, p.credits],
          );
          const w = (
            await c.query(
              "SELECT id FROM workspaces WHERE owner_id=$1 ORDER BY created_at LIMIT 1",
              [a.owner_id],
            )
          ).rows[0];
          await c.query(
            "INSERT INTO ledger(id,workspace_id,amount,reason) VALUES($1,$2,$3,$4)",
            [
              `stripe:${object.id}`,
              w.id,
              p.credits,
              `Abonnement-Guthaben für Rechnung ${object.number}`,
            ],
          );
        }
      }
    }
    await audit(c, null, "billing.webhook.processed", event.id);
  });
  return { received: true };
}
export function cleanPage(value: string) {
  return (
    value
      .split(/[?#]/)[0]
      .replace(/[^a-zA-Z0-9/_-]/g, "")
      .slice(0, 100) || "/"
  );
}
export async function recordAnalytics(
  body: unknown,
  userId: string | null,
  userAgent: string,
) {
  const b = z
    .object({
      kind: z.enum(["page", "click"]),
      page: z.string().max(200),
      target: z
        .string()
        .regex(/^[a-zA-Z0-9:_-]{0,80}$/)
        .default(""),
      referrer: z.string().max(1000).default(""),
      consent: z.literal(true),
    })
    .parse(body);
  const config = await setting("site");
  if (!config?.analyticsEnabled) return { recorded: false };
  let referrer = "";
  try {
    referrer = new URL(b.referrer).hostname.slice(0, 200);
  } catch {}
  const bot =
    /bot|crawler|spider|headless|slurp|curl|wget|python-requests/i.test(
      userAgent,
    );
  await pool.query(
    "INSERT INTO analytics_events(kind,page,target,referrer,bot,user_id) VALUES($1,$2,$3,$4,$5,$6)",
    [b.kind, cleanPage(b.page), b.target, referrer, bot, userId],
  );
  await pool.query(
    "DELETE FROM analytics_events WHERE created_at<now()-($1*interval '1 day')",
    [config.analyticsRetention ?? 30],
  );
  return { recorded: true };
}
async function analyticsReport(body: unknown) {
  const b = z
    .object({
      from: z.string().datetime(),
      to: z.string().datetime(),
      bucket: z.enum(["hour", "day", "week", "month", "year"]),
      bots: z.enum(["all", "exclude", "only"]).default("exclude"),
    })
    .parse(body);
  if (
    Date.parse(b.to) <= Date.parse(b.from) ||
    Date.parse(b.to) - Date.parse(b.from) > 366 * 86400000 * 5
  )
    throw new HttpError(
      400,
      "Bitte einen gültigen Zeitraum von maximal fünf Jahren wählen.",
    );
  const params = [b.from, b.to, b.bots];
  if (
    b.bucket === "hour" &&
    Date.parse(b.to) - Date.parse(b.from) > 31 * 86400000
  )
    throw new HttpError(
      400,
      "Stündliche Auswertung ist auf 31 Tage begrenzt. Für längere Zeiträume bitte täglich oder gröber gruppieren.",
    );
  const filter =
    "created_at>=$1 AND created_at<$2 AND($3='all' OR bot=($3='only'))";
  const [series, pages, referrers, clicks, totals, registrations] =
    await Promise.all([
      pool.query(
        `SELECT date_trunc('${b.bucket}',created_at ${b.bucket === "hour" ? "" : "AT TIME ZONE 'Europe/Berlin'"}) AS date,count(*) FILTER(WHERE kind='page')::int AS views,count(DISTINCT user_id)::int AS users,count(*) FILTER(WHERE kind='click')::int AS clicks FROM analytics_events WHERE ${filter} GROUP BY 1 ORDER BY 1`,
        params,
      ),
      pool.query(
        `SELECT page,count(*)::int AS count FROM analytics_events WHERE ${filter} AND kind='page' GROUP BY page ORDER BY count DESC LIMIT 30`,
        params,
      ),
      pool.query(
        `SELECT referrer,count(*)::int AS count FROM analytics_events WHERE ${filter} AND kind='page' GROUP BY referrer ORDER BY count DESC LIMIT 30`,
        params,
      ),
      pool.query(
        `SELECT page,target,count(*)::int AS count FROM analytics_events WHERE ${filter} AND kind='click' GROUP BY page,target ORDER BY count DESC LIMIT 30`,
        params,
      ),
      pool.query(
        `SELECT count(*) FILTER(WHERE kind='page')::int AS views,count(DISTINCT user_id)::int AS users,count(*) FILTER(WHERE kind='click')::int AS clicks,count(*) FILTER(WHERE bot)::int AS suspected_bots FROM analytics_events WHERE ${filter}`,
        params,
      ),
      pool.query(
        `SELECT date_trunc('${b.bucket}',created_at AT TIME ZONE 'Europe/Berlin') AS date,count(*)::int AS registrations FROM users WHERE created_at>=$1 AND created_at<$2 GROUP BY 1 ORDER BY 1`,
        [b.from, b.to],
      ),
    ]);
  return {
    series: series.rows,
    pages: pages.rows,
    referrers: referrers.rows,
    clicks: clicks.rows,
    totals: totals.rows[0],
    registrations: registrations.rows,
    note: "Aktive Nutzer zählen nur angemeldete Konten mit Analyse-Einwilligung. Anonyme Aufrufe sind keine eindeutigen Besucher. Bot-Erkennung ist eine User-Agent-Heuristik.",
  };
}

async function analyticsSummary() {
  const now = new Date();
  const periods = [
    { key: "24h", days: 1 },
    { key: "30d", days: 30 },
    { key: "365d", days: 365 },
  ];
  const ranges = periods.map((p) => ({
    ...p,
    from: new Date(now.getTime() - p.days * 86400000).toISOString(),
    to: now.toISOString(),
  }));
  const results = await Promise.all(
    ranges.map(async (range) => {
      const result = await pool.query(
        "SELECT count(*) FILTER(WHERE kind='page')::int AS views, count(DISTINCT user_id)::int AS users, count(*) FILTER(WHERE kind='click')::int AS clicks, (SELECT count(*)::int FROM users WHERE created_at>=$1 AND created_at<$2) AS registrations FROM analytics_events WHERE created_at>=$1 AND created_at<$2 AND bot=false",
        [range.from, range.to],
      );
      return { ...range, ...result.rows[0] };
    }),
  );
  const site = await setting("site");
  return {
    periods: results,
    asOf: now.toISOString(),
    retentionDays: site?.analyticsRetention ?? 30,
    enabled: Boolean(site?.analyticsEnabled),
    note: "Rollierende Zeiträume; vermutete Bots ausgeblendet. Aufrufe, aktive Konten und Klicks nur mit Analyse-Einwilligung. Registrierungen stammen unabhängig davon aus dem Kontobestand. Bereits gelöschte Ereignisse werden nicht rekonstruiert.",
  };
}
