import { randomUUID } from "node:crypto";
import { pool, transaction } from "./db.ts";
import { tickAutomations } from "./automations.ts";
import { tickBriefings } from "./briefings.ts";
import { tickQuality } from "./quality.ts";
import { tickIdleEnvironments } from "./environment-budgets.ts";
import { checkModel } from "./model-monitor.ts";
import { reconcileMonthlyAllowances } from "./monthly-allowances.ts";
import { expireCustomerAccess } from "./access-expiry.ts";
import { deliverNextMail } from "./mail.ts";
import { syncInvoiceProfiles } from "./invoice-profile-sync.ts";
import { importStripeEinvoice, processEinvoice } from "./einvoices.ts";
import { housekeeping } from "./housekeeping.ts";
import { expireSocialClaims } from "./social.ts";
import { expireContentClaims } from "./content-research.ts";
import {
  migrateBinaryBatch,
  collectDeletedObjects,
  collectOrphanObjects,
} from "./object-migration.ts";
export async function scheduled(
  name: string,
  interval: number,
  fn: () => Promise<unknown>,
) {
  const token = randomUUID();
  const claim = await pool.query(
    `INSERT INTO scheduler_leases(name,token,lease_until,next_at) VALUES($1,$2,now()+interval '5 minutes',now()) ON CONFLICT(name) DO UPDATE SET token=EXCLUDED.token,lease_until=EXCLUDED.lease_until WHERE scheduler_leases.lease_until<now() AND scheduler_leases.next_at<=now() RETURNING name`,
    [name, token],
  );
  if (!claim.rowCount) return false;
  const heartbeat = setInterval(() => {
    void pool
      .query(
        "UPDATE scheduler_leases SET lease_until=now()+interval '5 minutes' WHERE name=$1 AND token=$2 AND lease_until>now()",
        [name, token],
      )
      .catch(() => {});
  }, 30000);
  try {
    await fn();
    await pool.query(
      "UPDATE scheduler_leases SET lease_until=now(),next_at=now()+$3*interval '1 millisecond' WHERE name=$1 AND token=$2",
      [name, token, interval],
    );
    return true;
  } catch (e) {
    await pool
      .query(
        "UPDATE scheduler_leases SET lease_until=now(),next_at=now()+interval '10 seconds' WHERE name=$1 AND token=$2",
        [name, token],
      )
      .catch(() => {});
    throw e;
  } finally {
    clearInterval(heartbeat);
  }
}
const jobs: [string, number, () => Promise<unknown>][] = [
  ["content-recovery", 30000, expireContentClaims],
  ["social-recovery", 30000, expireSocialClaims],
  ["automations", 5000, tickAutomations],
  ["briefings", 30000, tickBriefings],
  ["quality", 5000, tickQuality],
  ["idle", 15000, tickIdleEnvironments],
  ["models", 30000, () => checkModel(null)],
  ["allowances", 5000, reconcileMonthlyAllowances],
  ["access", 10000, expireCustomerAccess],
  ["mail", 2000, deliverNextMail],
  ["invoice-profile", 10000, syncInvoiceProfiles],
  ["invoice-import", 10000, importStripeEinvoice],
  ["invoice", 10000, processEinvoice],
  ["housekeeping", 3600000, housekeeping],
  ["object-migration", 30000, migrateBinaryBatch],
  ["object-deletions", 3600000, collectDeletedObjects],
  ["object-orphans", 3600000, collectOrphanObjects],
];
export async function runMaintenance() {
  const queue = [...jobs];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (queue.length) {
        const [name, interval, fn] = queue.shift()!;
        try {
          await scheduled(name, interval, fn);
        } catch {
          console.error("[Scheduler] Job failed: " + name);
        }
      }
    }),
  );
}
