import test from "node:test";
import assert from "node:assert/strict";
import { themeSchema, resolveTheme } from "../src/core/appearance.ts";
import { workspacePermission } from "../src/core/workspace-permissions.ts";
import { allowSupport } from "../src/core/support-policy.ts";
test("appearance follows the system only when requested", () => {
  for (const systemDark of [false, true]) {
    assert.equal(resolveTheme("dark", systemDark), "dark");
    assert.equal(resolveTheme("light", systemDark), "light");
    assert.equal(
      resolveTheme("system", systemDark),
      systemDark ? "dark" : "light",
    );
  }
  for (const value of [null, "", "Dark", "automatic", "<script>", {}])
    assert.equal(themeSchema.safeParse(value).success, false);
});
test("appearance is a personal preference, including viewers, but support cannot overwrite it", () => {
  for (const role of ["owner", "admin", "editor", "viewer"] as const)
    assert.equal(
      workspacePermission(role, "preferences/appearance", "POST"),
      true,
    );
  for (const mode of ["read", "write"])
    assert.equal(allowSupport("preferences/appearance", "POST", mode), false);
});
