import { randomUUID } from "node:crypto";
import type { DockerEngine } from "./docker.ts";
export function desiredManagedWorkers(
  demand: number,
  otherSlots: number,
  concurrency: number,
  min: number,
  max: number,
) {
  return Math.min(
    max,
    Math.max(min, Math.ceil(Math.max(0, demand - otherSlots) / concurrency)),
  );
}
type Policy = {
  group: string;
  image: string;
  network: string;
  platform: string;
  token: string;
  min: number;
  max: number;
  concurrency: number;
  memoryMb: number;
  cpu: number;
  idleMs: number;
};
export class WorkerAutoscaler {
  private quietSince: number;
  private readonly leaseToken = randomUUID();
  constructor(
    private engine: Pick<DockerEngine, "request">,
    private api: (path: string, body: unknown) => Promise<any>,
    readonly policy: Policy,
    private now: () => number = Date.now,
  ) {
    this.quietSince = this.now();
    if (
      ![
        policy.min,
        policy.max,
        policy.concurrency,
        policy.memoryMb,
        policy.cpu,
        policy.idleMs,
      ].every(Number.isFinite) ||
      ![
        policy.min,
        policy.max,
        policy.concurrency,
        policy.memoryMb,
        policy.idleMs,
      ].every(Number.isInteger) ||
      !/^[a-zA-Z0-9_-]{1,60}$/.test(policy.group) ||
      policy.min < 0 ||
      policy.max < policy.min ||
      policy.max > 16 ||
      policy.concurrency < 1 ||
      policy.concurrency > 8 ||
      policy.memoryMb < 128 ||
      policy.memoryMb > 2048 ||
      policy.cpu < 0.25 ||
      policy.cpu > 2 ||
      policy.idleMs < 30000
    )
      throw new Error("Invalid bounded worker autoscaling policy.");
  }
  async tick() {
    const p = this.policy;
    if (
      !(
        await this.api("autoscale/lease", {
          group: p.group,
          token: this.leaseToken,
        })
      ).ok
    )
      return;
    let valid = true;
    const renew = setInterval(() => {
      void this.api("autoscale/lease", {
        group: p.group,
        token: this.leaseToken,
      })
        .then((r) => {
          if (!r.ok) valid = false;
        })
        .catch(() => {
          valid = false;
        });
    }, 10000);
    const check = () => {
      if (!valid) throw new Error("Autoscaler lease lost.");
    };
    try {
      const filters = encodeURIComponent(
        JSON.stringify({ label: ["kerncloud.autoscaler=" + p.group] }),
      );
      const list = await this.engine.request(
        "GET",
        "/containers/json?all=1&filters=" + filters,
      );
      const owned: any[] = [];
      for (const item of list ?? []) {
        const detail = await this.engine.request(
          "GET",
          "/containers/" + encodeURIComponent(item.Id) + "/json",
        );
        if (detail?.Config?.Labels?.["kerncloud.autoscaler"] !== p.group)
          continue;
        const env = detail.Config.Env ?? [],
          entry = env.find((s: string) => s.startsWith("WORKER_ID="));
        if (!entry) continue;
        owned.push({
          id: item.Id,
          worker: entry.slice(10),
          state: detail.State.Status,
        });
      }
      const capacity = await this.api("autoscale/capacity", {
        owned: owned.map((x) => x.worker),
      });
      const desired = desiredManagedWorkers(
        capacity.demand_slots,
        capacity.other_slots,
        p.concurrency,
        p.min,
        p.max,
      );
      if (desired >= owned.length) this.quietSince = this.now();
      for (const item of owned)
        if (item.state === "created") {
          check();
          await this.engine.request(
            "POST",
            "/containers/" + item.id + "/start",
          );
          return;
        }
      if (owned.length < desired) {
        check();
        const worker = randomUUID(),
          name = "kc-worker-" + p.group + "-" + worker.slice(0, 8);
        const created = await this.engine.request(
          "POST",
          "/containers/create?name=" + encodeURIComponent(name),
          {
            Image: p.image,
            Cmd: ["npm", "run", "worker"],
            User: "1000:1000",
            Labels: { "kerncloud.autoscaler": p.group },
            Env: [
              "PLATFORM_URL=" + p.platform,
              "WORKER_TOKEN=" + p.token,
              "WORKER_ID=" + worker,
              "WORKER_CONCURRENCY=" + p.concurrency,
              "WORKER_MAINTENANCE=false",
              "NPM_CONFIG_CACHE=/tmp/.npm",
            ],
            HostConfig: {
              ReadonlyRootfs: true,
              Memory: p.memoryMb * 1048576,
              NanoCpus: Math.round(p.cpu * 1e9),
              PidsLimit: 128,
              CapDrop: ["ALL"],
              SecurityOpt: ["no-new-privileges:true"],
              NetworkMode: p.network,
              Tmpfs: { "/tmp": "rw,noexec,nosuid,size=64m,mode=1777" },
              RestartPolicy: { Name: "unless-stopped" },
            },
          },
        );
        check();
        await this.engine.request(
          "POST",
          "/containers/" + created.Id + "/start",
        );
        return;
      }
      if (owned.length > desired && this.now() - this.quietSince >= p.idleMs) {
        const item = owned.at(-1);
        check();
        if (
          !(
            await this.api("autoscale/drain", {
              id: item.worker,
              draining: true,
            })
          ).ok
        )
          return;
        check();
        const detail = await this.engine.request(
          "GET",
          "/containers/" + item.id + "/json",
        );
        if (detail?.Config?.Labels?.["kerncloud.autoscaler"] !== p.group)
          throw new Error("Container ownership changed.");
        await this.engine.request(
          "POST",
          "/containers/" + item.id + "/stop?t=30",
        );
        check();
        await this.engine.request(
          "DELETE",
          "/containers/" + item.id + "?force=false&v=false",
        );
        this.quietSince = this.now();
      }
    } finally {
      clearInterval(renew);
    }
  }
}
