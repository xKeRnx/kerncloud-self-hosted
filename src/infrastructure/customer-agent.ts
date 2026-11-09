import {
  DockerEngine,
  dockerInventory,
  executeDockerJob,
  type EnvironmentJob,
} from "./docker.ts";
import { validateCustomerJob } from "../core/customer-host.ts";
const platform = new URL(process.env.PLATFORM_URL ?? "https://invalid");
const local = process.env.INFRA_CUSTOMER_LOCAL === "true";
if (
  platform.protocol !== "https:" &&
  !(
    local &&
    platform.protocol === "http:" &&
    ["host.docker.internal", "localhost", "127.0.0.1"].includes(
      platform.hostname,
    )
  )
)
  throw Error("Connector requires HTTPS except explicit local development.");
const host = process.env.INFRA_HOST_ID ?? "",
  token = process.env.INFRA_HOST_TOKEN ?? "";
if (!/^[a-f0-9-]{36}$/.test(host) || token.length < 40)
  throw Error("Connector configuration missing.");
const engine = new DockerEngine();
let stopping = false,
  active = false,
  lastBeat = 0;
process.on("SIGTERM", () => (stopping = true));
process.on("SIGINT", () => (stopping = true));
async function api(path: string, body: unknown) {
  const r = await fetch(`${platform.origin}/api/infrastructure/agent/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "x-host-id": host,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw Error("Connector request rejected.");
  return r.json();
}
async function execute(job: EnvironmentJob) {
  let valid = true;
  const renew = async () => {
    if (!valid) throw Error("Lease lost.");
    try {
      await api("job-heartbeat", { id: job.id, lease: job.lease });
    } catch (e) {
      valid = false;
      throw e;
    }
  };
  const timer = setInterval(() => void renew().catch(() => {}), 30000);
  try {
    validateCustomerJob(job);
    await renew();
    const result = await executeDockerJob(engine, host, job, renew);
    await api("complete", {
      id: job.id,
      lease: job.lease,
      ok: true,
      ...result,
    });
  } catch {
    await api("complete", {
      id: job.id,
      lease: job.lease,
      ok: false,
      uncertain: true,
      error:
        "Lokale Aktion nicht sicher bestätigt. Zustand auf dem Kunden-Rechner prüfen.",
    }).catch(() => {});
    console.error("[Customer connector] Local action needs review.");
  } finally {
    clearInterval(timer);
    active = false;
  }
}
console.log(
  "[Customer connector] Outbound connection; only dedicated KeRnCloud environments.",
);
while (!stopping) {
  try {
    if (Date.now() - lastBeat > 10000) {
      await api(
        "heartbeat",
        await dockerInventory(engine, host, `kerncloud-customer-${host}`),
      );
      lastBeat = Date.now();
    }
    if (!active) {
      const { job } = await api("claim", {});
      if (job) {
        active = true;
        void execute(job);
      }
    }
  } catch {
    console.error("[Customer connector] Platform or local Docker unavailable.");
  }
  await new Promise((r) => setTimeout(r, 2000));
}
while (active) await new Promise((r) => setTimeout(r, 250));
