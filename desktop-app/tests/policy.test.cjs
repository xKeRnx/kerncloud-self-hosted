const test = require("node:test"),
  assert = require("node:assert/strict");
const { allowedCommands, allowedNavigation, redact } = require("../policy.cjs");
const { loginAutostart } = require("../policy.cjs");
test("Linux never invokes unsupported login-item APIs; Windows/macOS preserve settings", () => {
  assert.equal(
    loginAutostart(
      {
        getLoginItemSettings() {
          throw Error("Unsupported");
        },
      },
      "linux",
    ),
    false,
  );
  for (const platform of ["win32", "darwin"])
    assert.equal(
      loginAutostart(
        { getLoginItemSettings: () => ({ openAtLogin: true }) },
        platform,
      ),
      true,
    );
});
test("untrusted navigation and arbitrary commands cannot reach host actions", () => {
  assert.equal(
    allowedNavigation("http://localhost:3100/tasks", "http://localhost:3100"),
    true,
  );
  for (const url of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "https://attacker.invalid",
    "http://localhost:3100.attacker.invalid",
    "http://localhost:3200",
  ])
    assert.equal(allowedNavigation(url, "http://localhost:3100"), false);
  for (const cmd of ["exec", "rm", "start;whoami"])
    assert.equal(allowedCommands.has(cmd), false);
});
test("diagnostics redact configured credentials", () => {
  assert.equal(
    redact("failed: fake-secret fake-pass", {
      WORKER_TOKEN: "fake-secret",
      ADMIN_PASSWORD: "fake-pass",
      PUBLIC_URL: "http://localhost",
    }),
    "failed: [redacted] [redacted]",
  );
});

const { allowedWorkspacePopup } = require("../policy.cjs");
test("workplace windows stay on the selected server or exact configured gateway UUID subdomains", () => {
  const origin = "https://workspace.example.test",
    gateway = "https://environments.example.test:444",
    id = "12345678-1234-1234-1234-123456789abc";
  for (const url of [
    "about:blank",
    origin + "/api/preview",
    "https://" + id + ".environments.example.test:444/_launch?ticket=fixture",
  ])
    assert.equal(allowedWorkspacePopup(url, origin, gateway), true, url);
  for (const url of [
    "https://unrelated.example",
    "https://bad.environments.example.test:444",
    "https://" + id + ".environments.example.test.evil:444",
    "http://" + id + ".environments.example.test:444",
    "https://" + id + ".environments.example.test",
    "file:///private.txt",
    "javascript:alert(1)",
    "https://user:pass@workspace.example.test",
  ])
    assert.equal(allowedWorkspacePopup(url, origin, gateway), false, url);
  assert.equal(
    allowedWorkspacePopup(
      "https://" + id + ".environments.example.test:444",
      origin,
      null,
    ),
    false,
  );
});
