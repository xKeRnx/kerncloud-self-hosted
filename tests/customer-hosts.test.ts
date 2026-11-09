import test from "node:test";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import {
  connectorEndpoints,
  connectorBundle,
} from "../src/server/customer-hosts.ts";
import { validateCustomerJob } from "../src/core/customer-host.ts";
import type { EnvironmentJob } from "../src/infrastructure/docker.ts";
test("Kunden-Connector verlangt HTTPS, hat nur ein kontogebundenes Geheimnis und öffnet keine Docker-Ports", () => {
  assert.deepEqual(
    connectorEndpoints("https://app.example", "https://access.example"),
    {
      platform: "https://app.example",
      relay: "wss://access.example/_relay",
      local: false,
    },
  );
  assert.equal(
    connectorEndpoints("http://localhost:3100", "http://localhost:3200")
      .platform,
    "http://host.docker.internal:3100",
  );
  assert.throws(() =>
    connectorEndpoints("http://remote.example", "https://access.example"),
  );
  assert.throws(() =>
    connectorEndpoints(
      "https://user:secret@app.example",
      "https://access.example",
    ),
  );
  const id = "00000000-0000-4000-a000-000000000000",
    token = "fixture-secret-not-a-real-key".repeat(2);
  const zip = unzipSync(Buffer.from(connectorBundle(id, token), "base64"));
  assert.match(strFromU8(zip[".env.connector"]), new RegExp(id));
  assert.match(strFromU8(zip[".env.connector"]), /INFRA_HOST_TOKEN=/);
  assert.doesNotMatch(
    strFromU8(zip[".env.connector"]),
    /DATABASE_URL|WORKER_TOKEN|ENCRYPTION_KEY/,
  );
  assert.doesNotMatch(
    strFromU8(zip["compose.yaml"]),
    /ports:|privileged:|network_mode: host/,
  );
  assert.ok(zip["environments/controller.mjs"]);
  assert.ok(zip["src/core/customer-host.ts"]);
  assert.match(strFromU8(zip[".dockerignore"]), /\.env.connector/);
});
test("Lokaler Connector akzeptiert nur bekannte isolierte Browser-/Entwicklungsimages", () => {
  const job = {
    spec: {
      id: "browser",
      image: "kerncloud-browser:0.3",
      command: [],
      cpu: 2,
      memory_mb: 2048,
      user_id: "1000:1000",
      read_only: true,
    },
  } as unknown as EnvironmentJob;
  assert.doesNotThrow(() => validateCustomerJob(job));
  for (const change of [
    { image: "arbitrary/image" },
    { user_id: "0:0" },
    { read_only: false },
    { command: ["sh"] },
    { cpu: 100 },
    { memory_mb: 999999 },
  ])
    assert.throws(() =>
      validateCustomerJob({ ...job, spec: { ...job.spec, ...change } }),
    );
});
