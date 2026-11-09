import assert from "node:assert/strict";
import test from "node:test";
import { environmentIpam, DockerEngine } from "../src/infrastructure/docker.ts";
test("Container-Subnetze vermeiden vorhandene Bereiche und melden erschöpfte Pools", async () => {
  const previous = process.env.INFRA_DOCKER_SUBNET_POOL;
  try {
    process.env.INFRA_DOCKER_SUBNET_POOL = "10.240.0.0/16";
    const networks = [{ IPAM: { Config: [{ Subnet: "10.240.0.0/17" }] } }];
    const engine = { request: async () => networks } as unknown as DockerEngine;
    const subnet = await environmentIpam(engine, "fixture");
    assert.match(subnet!, /^10\.240\.(1[2-9]\d|2[0-5]\d)\.\d+\/28$/);
    networks[0].IPAM.Config[0].Subnet = "10.240.0.0/16";
    await assert.rejects(
      () => environmentIpam(engine, "fixture"),
      /kein freies/,
    );
    process.env.INFRA_DOCKER_SUBNET_POOL = "203.0.113.0/16";
    await assert.rejects(() => environmentIpam(engine, "fixture"), /privater/);
  } finally {
    if (previous === undefined) delete process.env.INFRA_DOCKER_SUBNET_POOL;
    else process.env.INFRA_DOCKER_SUBNET_POOL = previous;
  }
});
