// Run only in a disposable non-root environment image with /home/runner tmpfs.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
assert.notEqual(process.getuid?.(), 0);
const token = "controller-fixture-" + "x".repeat(64),
  scope = randomUUID(),
  checkpoint = randomUUID();
const controller = spawn(process.execPath, ["/opt/kerncloud/controller.mjs"], {
  env: { ...process.env, KERNCLOUD_CONTROL_TOKEN: token },
  stdio: "ignore",
});
const headers = {
  authorization: "Bearer " + token,
  "content-type": "application/json",
};
async function action(tool, args, id = randomUUID()) {
  const response = await fetch("http://127.0.0.1:8090/execute", {
    method: "POST",
    headers,
    body: JSON.stringify({
      id,
      tool,
      args: {
        ...args,
        process_scope: scope,
        process_request_id: id,
        checkpoint_scope: checkpoint,
      },
    }),
  });
  return response.json();
}
try {
  let ready = false;
  for (let n = 0; n < 50; n++) {
    try {
      const response = await fetch("http://127.0.0.1:8090/health", { headers });
      if (response.ok) {
        assert.ok(
          (await response.json()).capabilities.includes("processes-v1"),
        );
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 60));
  }
  assert.ok(ready, "Controller ready");
  assert.equal((await fetch("http://127.0.0.1:8090/health")).status, 401);
  const id = randomUUID();
  const args = {
    command: "printf started; sleep 31; printf finished",
    background: true,
    timeout_seconds: 40,
  };
  const first = await action("environment_command", args, id);
  assert.equal(first.status, "running");
  assert.equal(first.process_id, id);
  assert.deepEqual(await action("environment_command", args, id), first);
  const forbidden = await action("environment_process", {
    process_id: id,
    action: "status",
    process_scope: "wrong-task",
  }); // action helper enforces its own task scope.
  assert.equal(forbidden.process_id, id);
  const foreignResponse = await fetch("http://127.0.0.1:8090/execute", {
    method: "POST",
    headers,
    body: JSON.stringify({
      id: randomUUID(),
      tool: "environment_process",
      args: { process_id: id, action: "status", process_scope: randomUUID() },
    }),
  });
  assert.equal((await foreignResponse.json()).ok, false);
  let result = await action("environment_process", {
    process_id: id,
    action: "wait",
    cursor: 0,
  });
  if (result.status === "running")
    result = await action("environment_process", {
      process_id: id,
      action: "wait",
      cursor: 0,
    });
  assert.equal(result.exit_code, 0);
  assert.match(result.output, /startedfinished/);
  const scrubbed = await action("environment_command", {
    command: `node -e 'process.stdout.write(String(process.env.KERNCLOUD_CONTROL_TOKEN))'`,
    timeout_seconds: 5,
  });
  assert.equal(scrubbed.stdout, "undefined");
  console.log(
    JSON.stringify({
      passed: true,
      non_root: true,
      authenticated: true,
      controller_rpc: true,
      task_scope: true,
      elapsed_command_seconds: 31,
      process_handle: true,
      no_duplicate_launch: true,
      credentials_scrubbed: true,
    }),
  );
} finally {
  controller.kill("SIGTERM");
}
