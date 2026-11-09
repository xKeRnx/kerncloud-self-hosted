import { DockerEngine } from "./infrastructure/docker.ts";
import { WorkerAutoscaler } from "./infrastructure/worker-autoscale.ts";
const platform = process.env.PLATFORM_URL ?? "http://app:3100",
  token = process.env.WORKER_TOKEN ?? "";
if (token.length < 40) throw new Error("Operator worker credential required.");
const scaler = new WorkerAutoscaler(
  new DockerEngine(),
  async (path, body) => {
    const response = await fetch(platform + "/api/worker/" + path, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error("Autoscaler API rejected request.");
    return response.json();
  },
  {
    group: process.env.AUTOSCALER_ID ?? "local",
    image: process.env.AUTOSCALE_WORKER_IMAGE ?? "kerncloud-local:0.2",
    network: process.env.AUTOSCALE_NETWORK ?? "kerncloud-local_default",
    platform,
    token,
    min: Number(process.env.AUTOSCALE_MIN ?? 0),
    max: Number(process.env.AUTOSCALE_MAX ?? 4),
    concurrency: Number(process.env.AUTOSCALE_CONCURRENCY ?? 2),
    memoryMb: Number(process.env.AUTOSCALE_MEMORY_MB ?? 256),
    cpu: Number(process.env.AUTOSCALE_CPU ?? 0.5),
    idleMs: Number(process.env.AUTOSCALE_IDLE_SECONDS ?? 120) * 1000,
  },
);
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
console.log(
  "[Autoscaler] Bounded worker scaling on this existing Docker host.",
);
while (!stopping) {
  try {
    await scaler.tick();
  } catch {
    console.error(
      "[Autoscaler] Capacity reconciliation failed; no unbounded retry.",
    );
  }
  await new Promise((r) => setTimeout(r, 10000));
}
