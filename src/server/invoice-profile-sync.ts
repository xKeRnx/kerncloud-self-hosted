import Stripe from "stripe";
import { pool, audit, transaction } from "./db.ts";
import { decrypt } from "./security.ts";
// The update only sets invoice text, never KYC data, prices, payments or existing invoices.
export async function syncInvoiceProfiles(
  update?: (
    customer: string,
    footer: string,
    idempotencyKey: string,
  ) => Promise<unknown>,
) {
  const config = (
    await pool.query("SELECT value FROM settings WHERE id='billing'")
  ).rows[0]?.value;
  if (!update && (!config?.enabled || !config.secret)) return;
  const c = await pool.connect();
  let locked = false;
  try {
    locked = Boolean(
      (await c.query("SELECT pg_try_advisory_lock(6820192036) locked")).rows[0]
        .locked,
    );
    if (!locked) return;
    await c.query(
      "UPDATE invoice_profile_jobs SET status='queued' WHERE status='running' AND started_at<now()-interval '2 minutes'",
    );
    await c.query(
      "UPDATE invoice_profile_jobs SET status='obsolete',finished_at=now() WHERE status='queued' AND company_version<COALESCE((SELECT (value->>'version')::int FROM settings WHERE id='company'),0)",
    );
    const job = (
      await c.query(
        "UPDATE invoice_profile_jobs SET status='running',started_at=now() WHERE id=(SELECT id FROM invoice_profile_jobs WHERE status='queued' ORDER BY created_at,id LIMIT 1) RETURNING *",
      )
    ).rows[0];
    if (!job) return;
    let status = "done";
    try {
      const send =
        update ??
        (async (customer, footer, idempotencyKey) => {
          const stripe = new Stripe(decrypt(config.secret), {
            timeout: 10000,
            maxNetworkRetries: 0,
          });
          return stripe.customers.update(
            customer,
            { invoice_settings: { footer } },
            { idempotencyKey },
          );
        });
      await send(job.customer_id, decrypt(job.footer), "kc-issuer-" + job.id);
    } catch {
      status = "failed";
    }
    await c.query(
      "UPDATE invoice_profile_jobs SET status=$2,finished_at=now() WHERE id=$1",
      [job.id, status],
    );
    await transaction((tx) =>
      audit(tx, null, "company.invoice_profile." + status, job.id),
    );
  } finally {
    if (locked) await c.query("SELECT pg_advisory_unlock(6820192036)");
    c.release();
  }
}
