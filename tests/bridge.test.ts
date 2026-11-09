import test from "node:test";
import assert from "node:assert/strict";
import {
  bridgeScope,
  bridgeScopeAllows,
  bridgeNeedsApproval,
  bridgeAction,
} from "../src/core/bridge.ts";
import { workspacePermission } from "../src/core/workspace-permissions.ts";
import { allowSupport } from "../src/core/support-policy.ts";
import { resolveWorkspacePath } from "../src/core/navigation.ts";
test("bridge scopes require explicit project, agent and capability intersection", () => {
  const p = "00000000-0000-4000-8000-000000000001",
    a = "00000000-0000-4000-8000-000000000002";
  const s = bridgeScope.parse({
    project_ids: [p],
    agent_ids: [a],
    capabilities: ["files.read"],
  });
  assert.equal(bridgeScopeAllows(s, p, a, "files.read"), true);
  assert.equal(bridgeScopeAllows(s, p, a, "files.write"), false);
  assert.equal(bridgeScopeAllows(s, p, p, "files.read"), false);
  assert.equal(
    bridgeScopeAllows(bridgeScope.parse({}), p, a, "files.read"),
    false,
  );
});
test("bridge external actions require exact approval and do not grant new support or member access", () => {
  for (const action of bridgeAction.shape.action.options) {
    const b = bridgeAction.parse({
      device_id: "00000000-0000-4000-8000-000000000001",
      action,
    });
    assert.equal(
      bridgeNeedsApproval(b),
      !["files.list", "files.read", "browser.snapshot"].includes(action),
    );
  }
  assert.equal(workspacePermission("owner", "bridge", "POST"), true);
  for (const r of ["admin", "editor", "viewer"] as const)
    assert.equal(workspacePermission(r, "bridge", "POST"), false);
  assert.equal(allowSupport("bridge", "GET", "write"), false);
  assert.equal(allowSupport("bridge", "POST", "write"), false);
  assert.equal(resolveWorkspacePath("/bridge")?.view, "bridge");
});
