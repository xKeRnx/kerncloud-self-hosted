import test from "node:test";
import assert from "node:assert/strict";
import {
  api,
  selectProject,
  selectWorkspace,
  setProjectScope,
} from "../components/api-client.ts";
test("account project selection waits for server confirmation and state refresh ignores a stale local scope", async () => {
  const original = globalThis.fetch;
  const calls: { path: string; init: RequestInit }[] = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ path: String(input), init: init ?? {} });
    return new Response(JSON.stringify({ id: "project-b", saved: true }), {
      status: 200,
    });
  };
  try {
    selectWorkspace("workspace-a");
    setProjectScope("project-a");
    await selectProject("project-b");
    assert.equal(calls[0].path, "/api/preferences/project");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.body, JSON.stringify({ id: "project-b" }));
    assert.equal((calls[0].init.headers as any)["x-project-id"], undefined);
    await api("state?view=files", undefined, "GET", { projectScope: false });
    assert.equal(
      (calls.at(-1)!.init.headers as any)["x-project-id"],
      undefined,
    );
    assert.equal(
      (calls.at(-1)!.init.headers as any)["x-workspace-id"],
      "workspace-a",
    );
    await api("attachments");
    assert.equal(
      (calls.at(-1)!.init.headers as any)["x-project-id"],
      "project-b",
    );
    selectWorkspace("workspace-b");
    await api("state");
    assert.equal(
      (calls.at(-1)!.init.headers as any)["x-project-id"],
      undefined,
    );
  } finally {
    selectWorkspace(undefined);
    globalThis.fetch = original;
  }
});
test("failed preference writes do not change the current request scope", async () => {
  const original = globalThis.fetch;
  selectWorkspace("workspace-a");
  setProjectScope("project-a");
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: "Denied" }), { status: 403 });
  try {
    await assert.rejects(selectProject("foreign-project"));
    let scope: string | undefined;
    globalThis.fetch = async (_, init) => {
      scope = (init?.headers as any)["x-project-id"];
      return new Response("{}");
    };
    await api("attachments");
    assert.equal(scope, "project-a");
  } finally {
    selectWorkspace(undefined);
    globalThis.fetch = original;
  }
});
