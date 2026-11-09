import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveWorkspacePath,
  projectPath,
  projectViews,
  adminGroups,
  workspacePaths,
} from "../src/core/navigation.ts";
import { allowSupport } from "../src/core/support-policy.ts";
test("project deep links preserve explicit project scope without replacing existing task and agent routes", () => {
  for (const view of [
    "tasks",
    "chat",
    "files",
    "memory",
    "knowledge",
    "timeline",
    "routines",
    "environments",
    "projectSettings",
  ] as const) {
    const path = projectPath("project-123", view);
    assert.deepEqual(resolveWorkspacePath(path), {
      view,
      projectId: "project-123",
    });
  }
  assert.deepEqual(resolveWorkspacePath("/projects/project-123"), {
    view: "projects",
    projectId: "project-123",
  });
  assert.deepEqual(resolveWorkspacePath("/tasks/all"), { view: "work" });
  assert.deepEqual(resolveWorkspacePath("/tasks/task-123"), {
    view: "tasks",
    runId: "task-123",
  });
  assert.equal(resolveWorkspacePath("/tasks")?.view, "tasks");
  assert.equal(resolveWorkspacePath("/projects/project-123/unknown"), null);
  assert.ok(!projectViews.includes("overview"));
  assert.ok(!projectViews.includes("activity"));
  assert.ok(!projectViews.includes("work"));
});
test("all existing admin destinations remain available in exactly one operator group", () => {
  const items = adminGroups.flatMap((g) => g.items);
  assert.equal(items.length, 18);
  assert.equal(new Set(items).size, 18);
  for (const tab of items)
    assert.deepEqual(resolveWorkspacePath("/admin/" + tab), {
      view: "admin",
      adminTab: tab,
    });
  for (const p of ["/settings", "/settings/budgets", "/worklog"])
    assert.ok(resolveWorkspacePath(p));
});
test("new workspace reads do not permit support writes or change privileged account boundaries", () => {
  for (const p of ["workspace/home", "workspace/tasks", "project/results"]) {
    assert.equal(allowSupport(p, "GET", "read"), true);
    assert.equal(allowSupport(p, "POST", "write"), false);
  }
  assert.equal(allowSupport("admin/company", "GET", "read"), false);
  assert.equal(allowSupport("models", "POST", "write"), false);
});

test("short task titles preserve an explicit first-line name without repeating the full request", async () => {
  const { taskTitle } = await import("../src/core/task-labels.ts");
  assert.equal(
    taskTitle("  Cafe website\n\nBuild a responsive page"),
    "Cafe website",
  );
  assert.equal(taskTitle("One\r\nTwo"), "One");
  assert.equal(taskTitle("A".repeat(200)).length, 110);
  assert.equal(taskTitle("  Plain title  "), "Plain title");
});
