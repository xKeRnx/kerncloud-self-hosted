import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  DockerEngine,
  executeDockerJob,
  type EnvironmentJob,
} from "../src/infrastructure/docker.ts";
const engine = new DockerEngine(),
  hostId = randomUUID(),
  environmentId = randomUUID();
let generation = 1;
const spec = {
  id: "fixture",
  image: "alpine:3.22",
  command: ["sleep", "infinity"],
  cpu: 1,
  memory_mb: 128,
  container_port: 0,
  network: false,
  user_id: "1000:1000",
  read_only: true,
};
async function run(action: EnvironmentJob["action"]) {
  return executeDockerJob(engine, hostId, {
    id: randomUUID(),
    environmentId,
    lease: randomUUID(),
    action,
    generation,
    spec,
  });
}
async function exec(id: string, command: string[]) {
  const { Id } = await engine.request("POST", `/containers/${id}/exec`, {
    Cmd: command,
    User: "1000:1000",
    WorkingDir: "/home/runner",
  });
  await engine.request("POST", `/exec/${Id}/start`, {
    Detach: false,
    Tty: false,
  });
  return (await engine.request("GET", `/exec/${Id}/json`)).ExitCode;
}
try {
  const first = await run("deploy"),
    detail = await engine.request(
      "GET",
      `/containers/${first.resourceId}/json`,
    );
  assert.equal(detail.HostConfig.ReadonlyRootfs, true);
  assert.equal(detail.HostConfig.Privileged, false);
  assert.deepEqual(detail.HostConfig.CapDrop, ["ALL"]);
  assert.equal(detail.Config.User, "1000:1000");
  assert.equal(detail.HostConfig.Memory, 128 * 1048576);
  assert.equal(detail.Mounts[0].Type, "volume");
  assert.equal(detail.Mounts[0].Destination, "/home/runner");
  assert.equal(
    await exec(first.resourceId, [
      "sh",
      "-c",
      "printf 'persistent' > proof.txt",
    ]),
    0,
  );
  await run("stop");
  assert.equal(
    (await engine.request("GET", `/containers/${first.resourceId}/json`)).State
      .Running,
    false,
  );
  const second = await run("start");
  assert.equal(second.resourceId, first.resourceId);
  assert.equal(
    await exec(second.resourceId, ["test", "-f", "/home/runner/proof.txt"]),
    0,
  );
  generation = 2;
  const reset = await run("reset");
  assert.notEqual(reset.resourceId, first.resourceId);
  assert.equal(
    await exec(reset.resourceId, [
      "sh",
      "-c",
      "test ! -e /home/runner/proof.txt",
    ]),
    0,
  );
  const duplicate = await run("deploy");
  assert.equal(duplicate.resourceId, reset.resourceId);
  console.log(
    "Docker-Lifecycle geprüft: bereitstellen, schreiben, stoppen, mit Volume starten, neu aufsetzen, idempotent abgleichen, entfernen. Ausschließlich eigene zufällige Testressourcen.",
  );
} finally {
  await run("delete");
  const containers = await engine.request(
    "GET",
    `/containers/json?all=1&filters=${encodeURIComponent(JSON.stringify({ label: [`kerncloud.host=${hostId}`] }))}`,
  );
  const volumes = await engine.request(
    "GET",
    `/volumes?filters=${encodeURIComponent(JSON.stringify({ label: [`kerncloud.host=${hostId}`] }))}`,
  );
  assert.equal(containers.length, 0);
  assert.equal((volumes.Volumes ?? []).length, 0);
  console.log("Eigene Testcontainer, Testnetzwerk und Testvolumes entfernt.");
}
