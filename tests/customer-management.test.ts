import test from "node:test";
import assert from "node:assert/strict";
import { accessExpired } from "../src/core/account-access.ts";
import { allowSupport } from "../src/core/support-policy.ts";
test("Zugangsfrist gilt exakt am Endzeitpunkt, unbefristete Konten bleiben gültig", () => {
  const now = Date.UTC(2026, 9, 20);
  assert.equal(accessExpired({ access_expires_at: null }, now), false);
  assert.equal(
    accessExpired({ access_expires_at: new Date(now + 1) }, now),
    false,
  );
  assert.equal(accessExpired({ access_expires_at: new Date(now) }, now), true);
  assert.equal(
    accessExpired({ access_expires_at: new Date(now - 1) }, now),
    true,
  );
});
test("Lesender Support darf Kundendaten sehen und Workspaces wählen, aber keine Daten oder Rechte ändern", () => {
  for (const path of [
    "state",
    "profile",
    "runtime",
    "memory",
    "live",
    "billing/invoices/a/download",
    "artifacts/a/preview",
  ])
    assert.equal(allowSupport(path, "GET", "read"), true, path);
  assert.equal(allowSupport("workspaces/select", "POST", "read"), true);
  for (const path of [
    "runs",
    "agents",
    "attachments/upload",
    "memory",
    "billing/checkout",
    "profile/password",
    "profile/security/disable",
    "admin/customers",
  ])
    assert.equal(allowSupport(path, "POST", "read"), false, path);
});
test("Schreibender Support bleibt von Zahlung, Kontosicherheit, Schlüsseln und Datenexport getrennt", () => {
  for (const path of [
    "runs",
    "agents",
    "chat",
    "memory",
    "attachments/upload",
    "runs/id/message",
  ])
    assert.equal(allowSupport(path, "POST", "write"), true, path);
  for (const path of [
    "billing/checkout",
    "billing/portal",
    "provider",
    "models",
    "connections",
    "customer-hosts",
    "execution-policy",
    "environments/agents",
    "environments/launch",
    "profile/password",
    "profile/oauth/unlink",
    "privacy/delete",
    "admin/plan",
  ])
    assert.equal(allowSupport(path, "POST", "write"), false, path);
  for (const path of ["privacy/export", "admin/customers", "support/start"])
    assert.equal(allowSupport(path, "GET", "write"), false, path);
  assert.equal(allowSupport("runs/id/admin", "POST", "write"), false);
});
