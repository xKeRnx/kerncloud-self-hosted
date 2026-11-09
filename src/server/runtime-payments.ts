import { runtimePlanBalance } from "../core/runtime-pricing.ts";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import type { PoolClient } from "pg";
import { z } from "zod";
import { pool, transaction, audit } from "./db.ts";
import { stripeClient } from "./business.ts";
import { assertCompanyCheckout, companyInvoiceSettings } from "./company.ts";
import { HttpError } from "./auth.ts";
import { runtimeLock, activeRuntimePlan, runtimeAccount } from "./runtime.ts";
import type { User, Workspace } from "../core/types.ts";
export async function runtimeCheckout(
  user: User,
  workspace: Workspace,
  body: unknown,
) {
  const b = z
    .object({ productId: z.string().max(50), termsAccepted: z.literal(true) })
    .parse(body);
  const { stripe, config } = await stripeClient();
  await assertCompanyCheckout(config.mode);
  const invoiceSettings = await companyInvoiceSettings();
  const product = (
    await pool.query(
      "SELECT * FROM runtime_products WHERE id=$1 AND active AND stripe_price_id IS NOT NULL",
      [b.productId],
    )
  ).rows[0];
  if (!product)
    throw new HttpError(409, "Dieses Laufzeitpaket ist nicht eingerichtet.");
  let price;
  try {
    price = await stripe.prices.retrieve(product.stripe_price_id);
  } catch {
    throw new HttpError(
      503,
      "Stripe-Preis konnte nicht geprüft werden. Bitte den Betreiber kontaktieren.",
    );
  }
  if (
    !price.active ||
    price.type !== "one_time" ||
    price.currency !== "eur" ||
    price.unit_amount !== product.price_cents
  )
    throw new HttpError(
      409,
      "Stripe-Preis und Laufzeitpaket stimmen nicht überein. Der Betreiber muss die Konfiguration prüfen.",
    );
  const account = await transaction(async (c) => {
    const a = await runtimeAccount(c, workspace.account_id);
    if (!activeRuntimePlan(a))
      throw new HttpError(403, "Zuerst einen Plan mit Umgebungen aktivieren.");
    return a;
  });
  let customer = account.stripe_customer_id;
  // Network calls never hold the runtime-metering lock or a database transaction.
  if (!customer) {
    try {
      customer = (
        await stripe.customers.create(
          {
            email: user.email,
            name: user.name,
            metadata: { account_id: account.id },
            ...(invoiceSettings ? { invoice_settings: invoiceSettings } : {}),
          },
          { idempotencyKey: "kc-customer-" + config.mode + "-" + account.id },
        )
      ).id;
    } catch {
      throw new HttpError(
        503,
        "Stripe-Kundenkonto konnte nicht vorbereitet werden.",
      );
    }
    customer = (
      await pool.query(
        "UPDATE accounts SET stripe_customer_id=COALESCE(stripe_customer_id,$2) WHERE id=$1 RETURNING stripe_customer_id",
        [account.id, customer],
      )
    ).rows[0]?.stripe_customer_id;
    if (!customer) throw new HttpError(409, "Konto ist nicht mehr verfügbar.");
  }
  if (invoiceSettings)
    await stripe.customers.update(customer, {
      invoice_settings: invoiceSettings,
    });
  const order = await transaction(async (c) => {
    await runtimeLock(c);
    const a = await runtimeAccount(c, workspace.account_id);
    if (!activeRuntimePlan(a))
      throw new HttpError(403, "Plan-Zugang ist nicht mehr aktiv.");
    const pending = Number(
      (
        await c.query(
          "SELECT count(*) FROM runtime_orders WHERE account_id=$1 AND status='pending' AND created_at>now()-interval '1 hour'",
          [a.id],
        )
      ).rows[0].count,
    );
    if (pending >= 10)
      throw new HttpError(
        429,
        "Zu viele offene Zahlungen. Bitte später erneut versuchen oder den Betreiber kontaktieren.",
      );
    const id = randomUUID();
    await c.query(
      "INSERT INTO runtime_orders(id,account_id,product_id,minutes,price_cents,stripe_price_id) VALUES($1,$2,$3,$4,$5,$6)",
      [
        id,
        a.id,
        product.id,
        product.minutes,
        product.price_cents,
        product.stripe_price_id,
      ],
    );
    return { id };
  });
  let session;
  try {
    session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        customer,
        line_items: [{ price: product.stripe_price_id, quantity: 1 }],
        success_url: config.returnUrl + "/environments?payment=success",
        cancel_url: config.returnUrl + "/environments?payment=canceled",
        client_reference_id: order.id,
        metadata: {
          runtime_order_id: order.id,
          account_id: workspace.account_id,
        },
        billing_address_collection: "required",
        customer_update: { address: "auto", name: "auto" },
        automatic_tax: { enabled: config.automaticTax },
        invoice_creation: {
          enabled: true,
          invoice_data: {
            metadata: {
              account_id: workspace.account_id,
              runtime_order_id: order.id,
            },
          },
        },
        consent_collection: { terms_of_service: "required" },
      },
      { idempotencyKey: "kc-runtime-" + config.mode + "-" + order.id },
    );
  } catch {
    throw new HttpError(
      503,
      "Zahlung konnte nicht geöffnet werden. Es wurde noch kein Laufzeitguthaben gutgeschrieben.",
    );
  }
  await pool.query(
    "UPDATE runtime_orders SET stripe_session_id=COALESCE(stripe_session_id,$2) WHERE id=$1",
    [order.id, session.id],
  );
  await transaction((c) =>
    audit(c, user.id, "runtime.checkout.created", order.id),
  );
  return { url: session.url };
}
export async function grantRuntimeInvoice(
  c: PoolClient,
  account: any,
  plan: any,
  invoice: any,
) {
  const amount = plan.runtime_minutes * 60;
  const ends =
    invoice.lines?.data?.[0]?.period?.end ??
    Math.floor(Date.now() / 1000) + 30 * 86400;
  await c.query(
    "UPDATE accounts SET runtime_included=$2,runtime_allowance=$2,runtime_period=$3,runtime_plan=$4,runtime_period_end=to_timestamp($5) WHERE id=$1",
    [account.id, amount, invoice.id, plan.id, ends],
  );
  await c.query(
    "INSERT INTO runtime_ledger(id,account_id,kind,amount,period,reason) VALUES($1,$2,'plan_grant',$3,$4,'Laufzeitkontingent aus bezahlter Planrechnung') ON CONFLICT DO NOTHING",
    [
      `invoice:${invoice.id}`,
      account.id,
      amount - account.runtime_included,
      invoice.id,
    ],
  );
}
export async function applyRuntimePayment(
  event: Stripe.Event,
  session?: Stripe.Checkout.Session,
) {
  const object = event.data.object as any;
  if (
    !session &&
    ![
      "charge.refunded",
      "charge.dispute.created",
      "charge.dispute.closed",
    ].includes(event.type)
  )
    return;
  await transaction(async (c) => {
    await runtimeLock(c);
    if (
      (
        await c.query("SELECT 1 FROM billing_events WHERE id=$1", [
          `runtime:${event.id}`,
        ])
      ).rowCount
    )
      return;
    if (session) {
      if (
        ![
          "checkout.session.completed",
          "checkout.session.async_payment_succeeded",
        ].includes(event.type) ||
        session.mode !== "payment" ||
        session.payment_status !== "paid"
      )
        return;
      const order = (
        await c.query(
          "SELECT o.*,a.stripe_customer_id FROM runtime_orders o JOIN accounts a ON a.id=o.account_id WHERE o.id=$1 FOR UPDATE OF o,a",
          [session.metadata?.runtime_order_id ?? ""],
        )
      ).rows[0];
      if (!order)
        throw new HttpError(409, "Laufzeitbestellung nicht zugeordnet.");
      const item = session.line_items?.data?.[0];
      if (
        (order.stripe_session_id && order.stripe_session_id !== session.id) ||
        session.metadata?.account_id !== order.account_id ||
        session.client_reference_id !== order.id ||
        session.customer !== order.stripe_customer_id ||
        session.currency !== "eur" ||
        session.amount_subtotal !== order.price_cents ||
        session.line_items?.data.length !== 1 ||
        item?.quantity !== 1 ||
        item.price?.id !== order.stripe_price_id ||
        item.price?.unit_amount !== order.price_cents ||
        item.price?.currency !== "eur"
      )
        throw new HttpError(
          400,
          "Laufzeitbestellung und Stripe-Position stimmen nicht überein.",
        );
      if (order.status !== "paid") {
        const a = (
          await c.query("SELECT * FROM accounts WHERE id=$1 FOR UPDATE", [
            order.account_id,
          ])
        ).rows[0];
        const value = order.minutes * 60,
          settled = Math.min(value, a.runtime_debt);
        await c.query(
          "UPDATE accounts SET runtime_purchased=runtime_purchased+$2,runtime_debt=runtime_debt-$3 WHERE id=$1",
          [a.id, value - settled, settled],
        );
        await c.query(
          "UPDATE runtime_orders SET status='paid',stripe_session_id=$2,payment_intent=$3,paid_total_cents=$4 WHERE id=$1",
          [
            order.id,
            session.id,
            typeof session.payment_intent === "string"
              ? session.payment_intent
              : session.payment_intent?.id,
            session.amount_total,
          ],
        );
        await c.query(
          "INSERT INTO runtime_ledger(id,account_id,kind,amount,reason) VALUES($1,$2,'purchase',$3,$4)",
          [
            `order:${order.id}`,
            a.id,
            value,
            `${order.minutes} Laufzeit-Minuten gekauft; ${settled / 60} Minuten Korrekturausgleich`,
          ],
        );
      }
    } else if (event.type === "charge.refunded") {
      const intent =
        typeof object.payment_intent === "string"
          ? object.payment_intent
          : object.payment_intent?.id;
      const order = (
        await c.query(
          "SELECT * FROM runtime_orders WHERE payment_intent=$1 AND status='paid' FOR UPDATE",
          [intent ?? ""],
        )
      ).rows[0];
      if (order) {
        const refunded = Math.min(
          order.paid_total_cents ?? order.price_cents,
          Number(object.amount_refunded ?? 0),
        );
        const previous = Math.ceil(
            (order.minutes * 60 * order.refunded_cents) /
              (order.paid_total_cents ?? order.price_cents),
          ),
          next = Math.ceil(
            (order.minutes * 60 * refunded) /
              (order.paid_total_cents ?? order.price_cents),
          ),
          change = Math.max(0, next - previous);
        const a = (
            await c.query("SELECT * FROM accounts WHERE id=$1 FOR UPDATE", [
              order.account_id,
            ])
          ).rows[0],
          taken = Math.min(a.runtime_purchased, change);
        await c.query(
          "UPDATE accounts SET runtime_purchased=runtime_purchased-$2,runtime_debt=runtime_debt+$3 WHERE id=$1",
          [a.id, taken, change - taken],
        );
        await c.query(
          "UPDATE runtime_orders SET refunded_cents=GREATEST(refunded_cents,$2) WHERE id=$1",
          [order.id, refunded],
        );
        if (change)
          await c.query(
            "INSERT INTO runtime_ledger(id,account_id,kind,amount,reason) VALUES($1,$2,'refund',$3,'Erstattete Laufzeit-Minuten zurückgebucht')",
            [`refund:${event.id}`, a.id, -change],
          );
      }
    } else {
      // A dispute is reviewed by the operator; block new usage without inventing a payment or refund.
      const intent =
        typeof object.payment_intent === "string"
          ? object.payment_intent
          : object.payment_intent?.id;
      const order = (
        await c.query(
          "SELECT account_id FROM runtime_orders WHERE payment_intent=$1",
          [intent ?? ""],
        )
      ).rows[0];
      if (order) {
        const blocked =
          event.type === "charge.dispute.created" || object.status !== "won";
        await c.query(
          "UPDATE runtime_orders SET disputed=$2 WHERE payment_intent=$1",
          [intent, blocked],
        );
        await c.query(
          "UPDATE accounts SET runtime_disputed=EXISTS(SELECT 1 FROM runtime_orders WHERE account_id=$1 AND disputed) WHERE id=$1",
          [order.account_id],
        );
        await audit(
          c,
          null,
          blocked ? "runtime.dispute.open" : "runtime.dispute.won",
          order.account_id,
        );
      }
    }
    await c.query("INSERT INTO billing_events(id,kind) VALUES($1,$2)", [
      `runtime:${event.id}`,
      event.type,
    ]);
  });
}

export async function applyRuntimePlanChange(
  c: PoolClient,
  a: any,
  p: any,
  invoiceId: string,
) {
  const allowance = p.runtime_minutes * 60,
    balance = runtimePlanBalance(
      a.runtime_allowance ?? 0,
      a.runtime_included,
      allowance,
    );
  const first = (
    await c.query(
      "INSERT INTO runtime_ledger(id,account_id,kind,amount,period,reason) VALUES($1,$2,'plan_change',$3,$4,'Laufzeitkontingent an Planwechsel angepasst') ON CONFLICT DO NOTHING RETURNING id",
      [
        "plan-change:" + invoiceId,
        a.id,
        balance - a.runtime_included,
        a.runtime_period,
      ],
    )
  ).rowCount;
  if (!first) return;
  await c.query(
    "UPDATE accounts SET plan_id=$2,runtime_plan=$2,runtime_included=$3,runtime_allowance=$4 WHERE id=$1",
    [a.id, p.id, balance, allowance],
  );
}
