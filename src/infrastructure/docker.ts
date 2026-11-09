import http from "node:http";
import os from "node:os";
import { readFileSync } from "node:fs";
import { createHash, createHmac } from "node:crypto";
export type EnvironmentJob = {
  id: string;
  environmentId: string;
  action: "deploy" | "start" | "stop" | "reset" | "delete";
  generation: number;
  lease: string;
  spec: {
    id: string;
    image: string;
    command: string[];
    cpu: number;
    memory_mb: number;
    container_port: number;
    network: boolean;
    user_id: string;
    read_only: boolean;
    previous_generation?: number;
    accessPassword?: string;
    relayToken?: string;
  };
};
export class DockerEngine {
  constructor(
    readonly socket = process.env.DOCKER_SOCKET ?? "/var/run/docker.sock",
  ) {}
  async request(method: string, path: string, body?: unknown): Promise<any> {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request(
        {
          socketPath: this.socket,
          path: `/v1.45${path}`,
          method,
          headers: data
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(data),
              }
            : {},
        },
        (response) => {
          let text = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => {
            text += chunk;
            if (text.length > 12000000) {
              response.destroy();
              reject(new Error("Docker-Antwort zu groß."));
            }
          });
          response.on("end", () => {
            if (response.statusCode === 404) return resolve(null);
            if ((response.statusCode ?? 500) >= 400)
              return reject(
                new Error(
                  `Docker-Aktion fehlgeschlagen (HTTP ${response.statusCode}; ${method} ${path.split("?")[0]}${path === "/networks/create" ? "; " + String(JSON.parse(text || "{}").message).slice(0, 300) : ""}).`,
                ),
              );
            try {
              resolve(text ? JSON.parse(text) : {});
            } catch {
              resolve({});
            }
          });
        },
      );
      req.setTimeout(180000, () =>
        req.destroy(
          new Error("Docker-Zeitüberschreitung; Ausgang abgleichen."),
        ),
      );
      req.on("error", () =>
        reject(
          new Error("Docker-Verbindung unterbrochen; Ausgang abgleichen."),
        ),
      );
      if (data) req.write(data);
      req.end();
    });
  }
}
const label = (hostId: string) => ({
  "kerncloud.host": hostId,
  "kerncloud.managed": "true",
});
function relaySettings(environmentId: string) {
  const value = process.env.INFRA_RELAY_URL;
  if (!value) return null;
  const url = new URL(value.replaceAll("{environment}", environmentId));
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/_relay" ||
    !(
      url.protocol === "wss:" ||
      (url.protocol === "ws:" &&
        [
          "localhost",
          "127.0.0.1",
          "gateway",
          "test-gateway",
          ...(process.env.INFRA_CUSTOMER_LOCAL === "true"
            ? ["host.docker.internal"]
            : []),
        ].includes(url.hostname))
    )
  )
    throw new Error(
      "Relay benötigt WSS; lokales WS nur für den eigenen Gateway-Dienst.",
    );
  return {
    url: url.toString(),
    image: process.env.INFRA_RELAY_IMAGE ?? "kerncloud-local:0.2",
  };
}
function availableMemory() {
  try {
    const value = readFileSync("/proc/meminfo", "utf8").match(
      /^MemAvailable:\s+(\d+) kB/m,
    );
    return value ? Number(value[1]) * 1024 : os.freemem();
  } catch {
    return os.freemem();
  }
}
export async function dockerInventory(
  engine: DockerEngine,
  hostId: string,
  project = process.env.DOCKER_PROJECT ?? "kerncloud-local",
) {
  const query = (labels: string[]) =>
    engine.request(
      "GET",
      `/containers/json?all=1&filters=${encodeURIComponent(JSON.stringify({ label: labels }))}`,
    );
  const [owned, platform, version] = await Promise.all([
    query([`kerncloud.host=${hostId}`]),
    query([`com.docker.compose.project=${project}`]),
    engine.request("GET", "/version"),
  ]);
  const map = new Map<string, any>();
  for (const item of [...(owned ?? []), ...(platform ?? [])])
    map.set(item.Id, item);
  const containers = [];
  for (const item of [...map.values()].slice(0, 300)) {
    const detail = await engine.request(
      "GET",
      `/containers/${encodeURIComponent(item.Id)}/json`,
    );
    if (!detail) continue;
    let stats: any = null;
    if (item.State === "running")
      try {
        stats = await engine.request(
          "GET",
          `/containers/${encodeURIComponent(item.Id)}/stats?stream=false&one-shot=true`,
        );
      } catch {}
    const delta =
        (stats?.cpu_stats?.cpu_usage?.total_usage ?? 0) -
        (stats?.precpu_stats?.cpu_usage?.total_usage ?? 0),
      system =
        (stats?.cpu_stats?.system_cpu_usage ?? 0) -
        (stats?.precpu_stats?.system_cpu_usage ?? 0);
    const cpu =
      system > 0
        ? Math.round(
            (delta / system) * (stats.cpu_stats.online_cpus ?? 1) * 10000,
          ) / 100
        : null;
    containers.push({
      id: item.Id,
      name: String(item.Names?.[0] ?? item.Id).replace(/^\//, ""),
      image: item.Image,
      state: item.State,
      health: detail.State?.Health?.Status ?? "ohne Healthcheck",
      environmentId: item.Labels?.["kerncloud.environment"] ?? null,
      cpuPercent: cpu,
      memoryBytes: stats
        ? Math.max(
            0,
            (stats.memory_stats?.usage ?? 0) -
              (stats.memory_stats?.stats?.inactive_file ?? 0),
          )
        : null,
      startedAt: detail.State?.StartedAt ?? null,
    });
  }
  let accessConfigured = false;
  try {
    const relay = relaySettings("00000000-0000-4000-a000-000000000000");
    accessConfigured = Boolean(
      relay &&
      (await engine.request(
        "GET",
        `/images/${encodeURIComponent(relay.image)}/json`,
      )),
    );
  } catch {}
  return {
    accessConfigured,
    version: `Docker ${version?.Version ?? "unbekannt"}`,
    hostname: os.hostname(),
    cpuCount: os.cpus().length,
    memoryTotal: os.totalmem(),
    memoryFree: availableMemory(),
    load: os.loadavg(),
    commandsEnabled: process.env.INFRA_ALLOW_COMMANDS === "true",
    containers,
  };
}
export async function environmentIpam(
  engine: DockerEngine,
  environmentId: string,
) {
  const pool = process.env.INFRA_DOCKER_SUBNET_POOL;
  if (!pool) return null;
  if (
    !/^(10\.\d{1,3}|172\.(1[6-9]|2\d|3[01])|192\.168)\.0\.0\/16$/.test(pool) ||
    pool.split(".").some((x) => Number(x) > 255)
  )
    throw new Error(
      "INFRA_DOCKER_SUBNET_POOL muss ein privater /16-Bereich sein, z.B. 10.240.0.0/16.",
    );
  const ip = (address: string) =>
    address.split(".").reduce((v, n) => v * 256 + Number(n), 0);
  const root = ip(pool.split("/")[0]);
  const ranges: [number, number][] = [];
  for (const network of await engine.request("GET", "/networks"))
    for (const config of network.IPAM?.Config ?? []) {
      if (!config.Subnet || config.Subnet.includes(":")) continue;
      const [address, prefix] = config.Subnet.split("/");
      const size = 2 ** (32 - Number(prefix));
      const start = Math.floor(ip(address) / size) * size;
      ranges.push([start, start + size - 1]);
    }
  const offset =
    createHash("sha256").update(environmentId).digest().readUInt16BE(0) % 4096;
  for (let i = 0; i < 4096; i++) {
    const start = root + ((offset + i) % 4096) * 16;
    if (ranges.some(([a, b]) => start <= b && start + 15 >= a)) continue;
    return (
      [24, 16, 8, 0]
        .map((shift) => Math.floor(start / 2 ** shift) % 256)
        .join(".") + "/28"
    );
  }
  throw new Error(
    "Im konfigurierten Container-Netzbereich ist kein freies /28-Netz verfügbar.",
  );
}
export async function executeDockerJob(
  engine: DockerEngine,
  hostId: string,
  job: EnvironmentJob,
  assertLease: () => Promise<void> = async () => {},
) {
  if (
    !/^[a-f0-9-]{36}$/.test(job.environmentId) ||
    !Number.isInteger(job.generation) ||
    job.generation < 1
  )
    throw new Error("Ungültige Umgebungskennung.");
  const { spec } = job;
  if (
    spec.read_only !== true ||
    !/^\d+:\d+$/.test(spec.user_id) ||
    spec.user_id.startsWith("0:")
  )
    throw new Error(
      "Vorlage benötigt ein schreibgeschütztes Dateisystem und einen normalen Benutzer.",
    );
  const name = `kerncloud-env-${job.environmentId}-g${job.generation}`,
    networkName = `kerncloud-net-${job.environmentId}`;
  const owned = (detail: any) =>
    detail?.Config?.Labels?.["kerncloud.host"] === hostId &&
    detail.Config.Labels["kerncloud.environment"] === job.environmentId;
  const inspect = () =>
    engine.request("GET", `/containers/${encodeURIComponent(name)}/json`);
  async function removeEnvironmentContainers() {
    const list = await engine.request(
      "GET",
      `/containers/json?all=1&filters=${encodeURIComponent(JSON.stringify({ label: [`kerncloud.host=${hostId}`, `kerncloud.environment=${job.environmentId}`] }))}`,
    );
    for (const item of list ?? []) {
      const detail = await engine.request(
        "GET",
        `/containers/${encodeURIComponent(item.Id)}/json`,
      );
      if (!owned(detail))
        throw new Error("Fremder Container wird nicht verändert.");
      await assertLease();
      await engine.request(
        "DELETE",
        `/containers/${encodeURIComponent(item.Id)}?force=1&v=1`,
      );
    }
  }
  async function removeVolumes() {
    const result = await engine.request(
      "GET",
      `/volumes?filters=${encodeURIComponent(JSON.stringify({ label: [`kerncloud.host=${hostId}`, `kerncloud.environment=${job.environmentId}`] }))}`,
    );
    for (const volume of result?.Volumes ?? []) {
      if (
        volume.Labels?.["kerncloud.host"] !== hostId ||
        volume.Labels?.["kerncloud.environment"] !== job.environmentId
      )
        throw new Error("Fremdes Volume wird nicht entfernt.");
      await assertLease();
      await engine.request(
        "DELETE",
        `/volumes/${encodeURIComponent(volume.Name)}`,
      );
    }
  }
  if (job.action === "delete") {
    await removeEnvironmentContainers();
    await removeVolumes();
    await assertLease();
    const network = await engine.request(
      "GET",
      `/networks/${encodeURIComponent(networkName)}`,
    );
    if (network?.Labels?.["kerncloud.host"] === hostId)
      await engine.request(
        "DELETE",
        `/networks/${encodeURIComponent(networkName)}`,
      );
    return { resourceId: null, endpoint: null };
  }
  async function accessRelay(stop = false) {
    const relayName = name + "-access";
    let relay = await engine.request("GET", `/containers/${relayName}/json`);
    if (relay && !owned(relay))
      throw new Error("Fremdes Zugangs-Relay wird nicht verändert.");
    if (stop) {
      if (relay?.State?.Running) {
        await assertLease();
        await engine.request("POST", `/containers/${relay.Id}/stop?t=10`);
      }
      return;
    }
    if (
      !spec.relayToken ||
      !spec.container_port ||
      !process.env.INFRA_RELAY_URL
    )
      return;
    const settings = relaySettings(job.environmentId);
    if (!settings) return;
    if (!relay) {
      await assertLease();
      await engine.request("POST", `/containers/create?name=${relayName}`, {
        Image: settings.image,
        User: "1000:1000",
        WorkingDir: "/app",
        Entrypoint: ["node", "--import", "tsx", "src/gateway/relay.ts"],
        Cmd: [],
        Env: [
          `RELAY_ENVIRONMENT_ID=${job.environmentId}`,
          `RELAY_GENERATION=${job.generation}`,
          `RELAY_TOKEN=${spec.relayToken}`,
          `RELAY_CONTROL_TOKEN=${createHmac("sha256", spec.relayToken ?? "")
            .update("controller:" + job.generation)
            .digest("hex")}`,
          `RELAY_URL=${settings.url}`,
          `RELAY_TARGET=http://${name}:${spec.container_port}`,
          `RELAY_AUTH=${(spec as any).access_mode ?? "none"}`,
          `RELAY_PASSWORD=${spec.accessPassword ?? ""}`,
        ],
        Labels: {
          ...label(hostId),
          "kerncloud.environment": job.environmentId,
          "kerncloud.generation": String(job.generation),
          "kerncloud.role": "access-relay",
        },
        HostConfig: {
          NetworkMode: networkName,
          ReadonlyRootfs: true,
          Privileged: false,
          CapDrop: ["ALL"],
          SecurityOpt: ["no-new-privileges:true"],
          PidsLimit: 64,
          Memory: 134217728,
          NanoCpus: 500000000,
          Tmpfs: { "/tmp": "rw,nosuid,nodev,noexec,size=32m" },
          RestartPolicy: { Name: "unless-stopped" },
        },
      });
      relay = await engine.request("GET", `/containers/${relayName}/json`);
      if (process.env.INFRA_RELAY_NETWORK) {
        await assertLease();
        await engine.request(
          "POST",
          `/networks/${encodeURIComponent(process.env.INFRA_RELAY_NETWORK)}/connect`,
          { Container: relay.Id },
        );
      }
    }
    if (!relay.State?.Running) {
      await assertLease();
      await engine.request("POST", `/containers/${relay.Id}/start`);
    }
  }
  let detail = await inspect();
  if (job.action === "reset" && !detail) {
    await removeEnvironmentContainers();
    await removeVolumes();
  }
  if (!detail && ["start", "stop"].includes(job.action))
    throw new Error("Container fehlt. Nach Prüfung neu aufsetzen.");
  if (!detail) {
    const image = await engine.request(
      "GET",
      `/images/${encodeURIComponent(spec.image)}/json`,
    );
    if (!image) {
      await assertLease();
      await engine.request(
        "POST",
        `/images/create?fromImage=${encodeURIComponent(spec.image)}`,
      );
    }
    let network = await engine.request(
      "GET",
      `/networks/${encodeURIComponent(networkName)}`,
    );
    if (network && network.Labels?.["kerncloud.host"] !== hostId)
      throw new Error("Fremdes Netzwerk wird nicht verwendet.");
    if (!network) {
      const ipam = await environmentIpam(engine, job.environmentId);
      await assertLease();
      await engine.request("POST", "/networks/create", {
        Name: networkName,
        Driver: "bridge",
        ...(ipam ? { IPAM: { Config: [{ Subnet: ipam }] } } : {}),
        Internal: !spec.network,
        Labels: {
          ...label(hostId),
          "kerncloud.environment": job.environmentId,
        },
      });
    }
    await assertLease();
    const labels = {
      ...label(hostId),
      "kerncloud.environment": job.environmentId,
      "kerncloud.generation": String(job.generation),
      "kerncloud.job": job.id,
    };
    const volumeName = `kerncloud-data-${job.environmentId}-g${job.generation}`;
    const volume = await engine.request(
      "GET",
      `/volumes/${encodeURIComponent(volumeName)}`,
    );
    if (volume && volume.Labels?.["kerncloud.host"] !== hostId)
      throw new Error("Fremdes Volume wird nicht verwendet.");
    if (!volume) {
      await assertLease();
      await engine.request("POST", "/volumes/create", {
        Name: volumeName,
        Labels: labels,
      });
    }
    // A fixed operator-owned helper sets directory ownership. Customer processes never get its root identity or Docker socket.
    const helperName = `${name}-init`;
    const helperImage = await engine.request(
      "GET",
      `/images/${encodeURIComponent("alpine:3.22")}/json`,
    );
    if (!helperImage) {
      await assertLease();
      await engine.request(
        "POST",
        `/images/create?fromImage=${encodeURIComponent("alpine:3.22")}`,
      );
    }
    let helper = await engine.request("GET", `/containers/${helperName}/json`);
    if (helper && !owned(helper))
      throw new Error("Fremder Initialisierungscontainer.");
    if (!helper) {
      await assertLease();
      await engine.request("POST", `/containers/create?name=${helperName}`, {
        Image: "alpine:3.22",
        Cmd: ["chown", "-R", spec.user_id, "/workspace"],
        User: "0:0",
        Labels: labels,
        HostConfig: {
          NetworkMode: "none",
          ReadonlyRootfs: true,
          Privileged: false,
          CapDrop: ["ALL"],
          CapAdd: ["CHOWN", "DAC_OVERRIDE", "FOWNER"],
          SecurityOpt: ["no-new-privileges:true"],
          PidsLimit: 32,
          Memory: 67108864,
          Mounts: [
            {
              Type: "volume",
              Source: volumeName,
              Target: "/workspace",
              VolumeOptions: { NoCopy: true },
            },
          ],
        },
      });
      helper = await engine.request("GET", `/containers/${helperName}/json`);
    }
    await assertLease();
    await engine.request("POST", `/containers/${helper.Id}/start`);
    const initialized = await engine.request(
      "POST",
      `/containers/${helper.Id}/wait`,
    );
    if (initialized.StatusCode !== 0)
      throw new Error("Arbeitsvolume konnte nicht vorbereitet werden.");
    await assertLease();
    await engine.request("DELETE", `/containers/${helper.Id}`);
    const port = spec.container_port ? `${spec.container_port}/tcp` : null;
    await engine.request(
      "POST",
      `/containers/create?name=${encodeURIComponent(name)}`,
      {
        Image: spec.image,
        Cmd: spec.command,
        User: spec.user_id,
        Env: [
          "HOME=/home/runner",
          `KERNCLOUD_CONTROL_TOKEN=${createHmac("sha256", spec.relayToken ?? "")
            .update("controller:" + job.generation)
            .digest("hex")}`,
          ...(spec.accessPassword
            ? [
                `PASSWORD=${spec.accessPassword}`,
                `KERNCLOUD_ACCESS_PASSWORD=${spec.accessPassword}`,
              ]
            : []),
        ],
        Labels: labels,
        WorkingDir: "/home/runner",
        ExposedPorts: port ? { [port]: {} } : {},
        HostConfig: {
          ReadonlyRootfs: true,
          Privileged: false,
          CapDrop: ["ALL"],
          SecurityOpt: ["no-new-privileges:true"],
          PidsLimit: 512,
          ShmSize: Math.min(536870912, spec.memory_mb * 262144),
          NanoCpus: spec.cpu * 1e9,
          Memory: spec.memory_mb * 1048576,
          MemorySwap: spec.memory_mb * 1048576,
          NetworkMode: networkName,
          RestartPolicy: { Name: "unless-stopped" },
          Tmpfs: { "/tmp": "rw,nosuid,nodev,noexec,size=128m" },
          Mounts: [
            {
              Type: "volume",
              Source: volumeName,
              Target: "/home/runner",
              VolumeOptions: { NoCopy: true },
            },
          ],
          PortBindings: port
            ? { [port]: [{ HostIp: "127.0.0.1", HostPort: "0" }] }
            : {},
        },
      },
    );
    detail = await inspect();
  }
  if (!owned(detail))
    throw new Error("Fremder Container wird nicht verändert.");
  await assertLease();
  await engine.request(
    "POST",
    `/containers/${encodeURIComponent(detail.Id)}/${job.action === "stop" ? "stop?t=10" : "start"}`,
  );
  await accessRelay(job.action === "stop");
  detail = await inspect();
  const binding = spec.container_port
    ? detail.NetworkSettings?.Ports?.[`${spec.container_port}/tcp`]?.[0]
    : null;
  return {
    resourceId: detail.Id,
    endpoint:
      binding?.HostIp === "127.0.0.1"
        ? `http://127.0.0.1:${binding.HostPort}/`
        : null,
  };
}
