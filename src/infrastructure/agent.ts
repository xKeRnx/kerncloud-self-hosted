import {
  DockerEngine,
  dockerInventory,
  executeDockerJob,
  type EnvironmentJob,
} from "./docker.ts";
import { AwsEcs } from "./aws.ts";
const url = process.env.PLATFORM_URL ?? "http://app:3100",
  host = process.env.INFRA_HOST_ID ?? "",
  token = process.env.INFRA_HOST_TOKEN ?? "";
if (!host || token.length < 40)
  throw new Error(
    "INFRA_HOST_ID und INFRA_HOST_TOKEN fehlen. Erst den Server im Adminpanel registrieren.",
  );
const engine = new DockerEngine(),
  aws = process.env.INFRA_MODE === "aws_ecs" ? new AwsEcs(host) : null;
let stopping = false,
  active = false,
  lastBeat = 0;
process.on("SIGTERM", () => (stopping = true));
process.on("SIGINT", () => (stopping = true));
async function api(path: string, body: unknown) {
  const r = await fetch(`${url}/api/infrastructure/agent/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "x-host-id": host,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok)
    throw new Error(`Plattform hat Server-Anfrage abgelehnt (${r.status}).`);
  return r.json();
}
async function execute(job: EnvironmentJob) {
  let leaseValid = true;
  const renew = async () => {
    if (!leaseValid) throw new Error("Lease nicht mehr gültig.");
    try {
      await api("job-heartbeat", { id: job.id, lease: job.lease });
    } catch (e) {
      leaseValid = false;
      throw e;
    }
  };
  const interval = setInterval(() => void renew().catch(() => {}), 30000);
  try {
    await renew();
    const result = aws
      ? await aws.execute(job, renew)
      : await executeDockerJob(engine, host, job, renew);
    await api("complete", {
      id: job.id,
      lease: job.lease,
      ok: true,
      ...result,
    });
  } catch {
    try {
      await api("complete", {
        id: job.id,
        lease: job.lease,
        ok: false,
        uncertain: true,
        error:
          "Server-Aktion nicht sicher bestätigt. Ressourcenstatus prüfen und denselben Vorgang abgleichen.",
      });
    } catch {}
    console.error(
      "[Infrastructure] Vorgang konnte nicht sicher bestätigt werden.",
    );
  } finally {
    clearInterval(interval);
    active = false;
  }
}
console.log(
  "[Infrastructure] Betreiber-Connector gestartet; Kunden erhalten keinen Docker-Zugang.",
);
while (!stopping) {
  try {
    if (Date.now() - lastBeat > 10000) {
      const inventory = aws
        ? await aws.inventory()
        : await dockerInventory(engine, host);
      await api("heartbeat", inventory);
      lastBeat = Date.now();
    }
    if (!active && process.env.INFRA_ALLOW_COMMANDS === "true") {
      const { job } = await api("claim", {});
      if (job) {
        active = true;
        void execute(job);
      }
    }
  } catch {
    console.error(
      "[Infrastructure] Verbindung oder Inventarabfrage nicht verfügbar.",
    );
  }
  await new Promise((r) => setTimeout(r, 2000));
}
while (active) await new Promise((r) => setTimeout(r, 250));
