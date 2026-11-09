import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveWorkspacePath,
  workspacePaths,
} from "../src/core/navigation.ts";
import { workspacePermission } from "../src/core/workspace-permissions.ts";
test("central environment route is separate from the scoped project page and cannot grant member write access", () => {
  assert.equal(workspacePaths.environmentOverview, "/environments/all");
  assert.equal(
    resolveWorkspacePath("/environments/all")?.view,
    "environmentOverview",
  );
  assert.equal(resolveWorkspacePath("/environments")?.view, "environments");
  for (const role of ["viewer", "editor"] as const) {
    assert.equal(
      workspacePermission(role, "environments/overview", "GET"),
      true,
    );
    assert.equal(
      workspacePermission(role, "environments/overview/manage", "POST"),
      false,
    );
  }
  assert.equal(
    workspacePermission("admin", "environments/overview/manage", "POST"),
    true,
  );
});
