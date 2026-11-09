import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { zipSync, strToU8 } from "fflate";
import { z } from "zod";
import { pool, transaction, audit } from "./db.ts";
import { hashToken } from "./security.ts";
import { HttpError } from "./auth.ts";
import { executionPolicy } from "./execution-policy.ts";
import type { Workspace } from "../core/types.ts";
export function connectorEndpoints(platform: string, gateway: string) {
  const p = new URL(platform),
    g = new URL(gateway);
  for (const u of [p, g])
    if (
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      u.pathname !== "/" ||
      !(
        u.protocol === "https:" ||
        (u.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(u.hostname))
      )
    )
      throw new HttpError(
        409,
        "Connector benötigt öffentliche HTTPS-Adressen; HTTP nur für die lokale Testumgebung.",
      );
  const local = p.protocol === "http:";
  if (local) {
    p.hostname = "host.docker.internal";
    g.hostname = "host.docker.internal";
  }
  g.protocol = g.protocol === "https:" ? "wss:" : "ws:";
  g.pathname = "/_relay";
  return { platform: p.origin, relay: g.toString(), local };
}
export function connectorBundle(id: string, token: string) {
  const urls = connectorEndpoints(
    process.env.PUBLIC_URL ?? "http://localhost:3100",
    process.env.PUBLIC_ENVIRONMENT_URL ?? "http://localhost:3200",
  );
  const files: Record<string, Uint8Array> = {};
  for (const file of [
    "src/core/customer-host.ts",
    "src/infrastructure/customer-agent.ts",
    "src/infrastructure/docker.ts",
    "src/gateway/relay.ts",
    "environments/controller.mjs",
    "environments/checkpoints.mjs",
    "environments/processes.mjs",
    "environments/storage-budget.mjs",
    "environments/browser/Dockerfile",
    "environments/browser/start.sh",
    "environments/development/Dockerfile",
    "environments/development/start.sh",
  ])
    files[file] = new Uint8Array(readFileSync(join(process.cwd(), file)));
  const text = (name: string, value: string) => (files[name] = strToU8(value));
  text(
    "package.json",
    JSON.stringify({
      private: true,
      type: "module",
      dependencies: { tsx: "4.23.15", ws: "8.22.0" },
    }),
  );
  text(
    "Dockerfile",
    'FROM node:22-bookworm-slim\nWORKDIR /app\nCOPY package.json ./\nRUN npm install --omit=dev --no-audit --no-fund --ignore-scripts\nCOPY src ./src\nCMD ["node","--import","tsx","src/infrastructure/customer-agent.ts"]\n',
  );
  text(".dockerignore", ".env.connector\n.git\n");
  text(".gitignore", ".env.connector\n");
  text(
    ".env.connector",
    `PLATFORM_URL=${urls.platform}\nINFRA_RELAY_URL=${urls.relay}\nINFRA_HOST_ID=${id}\nINFRA_HOST_TOKEN=${token}\nINFRA_ALLOW_COMMANDS=true\nINFRA_CUSTOMER_HOST=true\nINFRA_CUSTOMER_LOCAL=${urls.local}\nINFRA_RELAY_IMAGE=kerncloud-customer-connector:0.3\nINFRA_DOCKER_SUBNET_POOL=10.240.0.0/16\nDOCKER_PROJECT=kerncloud-customer-${id}\n`,
  );
  text(
    "compose.yaml",
    `name: kerncloud-customer-${id.slice(0, 8)}\nservices:\n  connector:\n    build: .\n    image: kerncloud-customer-connector:0.3\n    env_file: .env.connector\n    user: "0:0"\n    network_mode: bridge\n    volumes: ["/var/run/docker.sock:/var/run/docker.sock"]\n    read_only: true\n    tmpfs: [/tmp]\n    cap_drop: [ALL]\n    security_opt: ["no-new-privileges:true"]\n    pids_limit: 128\n    mem_limit: 384m\n    restart: unless-stopped\n  browser-image:\n    profiles: [images]\n    build:\n      context: .\n      dockerfile: environments/browser/Dockerfile\n    image: kerncloud-browser:0.5\n  development-image:\n    profiles: [images]\n    build:\n      context: .\n      dockerfile: environments/development/Dockerfile\n    image: kerncloud-development:0.5\n`,
  );
  text(
    "README.txt",
    "KeRnCloud Kunden-Connector / Customer connector\n\nLinux Docker Engine oder Docker Desktop mit Linux-Containern erforderlich.\n1. Paket lokal entpacken. .env.connector geheim halten: Zugriff nur auf diesen Kunden-Rechner, kein Plattform-/Worker-Token.\n2. docker compose --profile images build\n3. docker compose up -d connector\n4. Im Workspace erlaubte Ausführungsorte auswählen, Umgebung auf diesem Rechner anlegen und starten. Agentenrechte separat freigeben.\n\nDie Verbindung geht ausgehend zur Plattform und zum geschützten Gateway; keine Docker-TCP-Schnittstelle und keine eingehenden Routerfreigaben öffnen. Der vertrauenswürdige Connector braucht lokal Docker-Socket-Zugriff und kann damit den Docker-Host verwalten. Agenten und Kundenumgebungen erhalten diesen Socket nicht. Der Connector bearbeitet ausschließlich eigene KeRnCloud-Ressourcen mit seiner Hostkennung; vorhandene fremde Container werden nicht übernommen.\n\nNetzwerke: INFRA_DOCKER_SUBNET_POOL reserviert kleine /28-Subnetze aus einem privaten /16-Bereich. Bei Konflikten mit Firmen-/VPN-Netzen in .env.connector anpassen. Bereits vorhandene Docker-Netze werden vor jeder Anlage abgeglichen.\n\nDateien/CPU bleiben auf diesem Rechner. Steuerdaten, ausgewählte Werkzeugausgaben, gelesene Inhalte, Chat und gespeicherte Ergebnisse werden weiterhin in der Plattform verarbeitet und können an das gewählte KI-Modell gehen. Dies ist kein vollständig lokaler oder Ende-zu-Ende-verschlüsselter KI-Betrieb. Lokale Strom-/Hardwarekosten trägt der Kunde; keine Betreiber-Laufzeit-Minuten für lokale Umgebungen.\n\nStoppen: Umgebungen zuerst in KeRnCloud stoppen, dann docker compose stop connector. Widerruf sperrt den Cloud-Zugang sofort, kann aber einen offline befindlichen Rechner nicht physisch stoppen. Ressourcen lokal mit docker ps --filter label=kerncloud.host=" +
      id +
      " prüfen. Volumes nicht unbesehen löschen. Einrichtung neu erzeugen rotiert nur den Connector-Schlüssel; bestehende Dateien bleiben.\n\nOutbound connections only. Keep .env.connector private. Local files and compute do not prevent selected outputs and content from being sent to KeRnCloud and the configured AI provider. No hosted runtime minutes are charged for customer-hosted environments.\n",
  );
  return Buffer.from(zipSync(files, { level: 6 })).toString("base64");
}
export async function customerHosts(
  actor: string,
  w: Workspace,
  body?: unknown,
) {
  if (body !== undefined) {
    const b = z
      .object({
        action: z.enum(["create", "rotate", "revoke"]),
        id: z.string().uuid().optional(),
        name: z.string().trim().min(1).max(100).optional(),
        cpu: z.number().int().min(2).max(128).default(4),
        memory: z.number().int().min(3072).max(262144).default(8192),
      })
      .parse(body);
    const id = b.id ?? randomUUID(),
      token = randomBytes(32).toString("hex");
    const archive =
      b.action === "revoke" ? undefined : connectorBundle(id, token);
    await transaction(async (c) => {
      const a = (
        await c.query(
          "SELECT a.*,row_to_json(p) AS plan FROM accounts a JOIN plans p ON p.id=a.plan_id WHERE a.id=$1 FOR UPDATE OF a",
          [w.account_id],
        )
      ).rows[0];
      if (b.action === "create") {
        if (
          !a.plan.active ||
          (a.access_expires_at &&
            new Date(a.access_expires_at).getTime() <= Date.now()) ||
          !["active", "local_test"].includes(a.subscription_status) ||
          a.plan.max_customer_hosts < 1
        )
          throw new HttpError(
            403,
            "Dein Plan enthält keinen Kunden-Connector.",
          );
        const count = (
          await c.query(
            "SELECT count(*)::int n FROM infrastructure_hosts WHERE customer_account_id=$1",
            [a.id],
          )
        ).rows[0].n;
        if (count >= a.plan.max_customer_hosts)
          throw new HttpError(409, "Connector-Limit deines Plans erreicht.");
        if (!b.name)
          throw new HttpError(400, "Bitte einen Rechnernamen angeben.");
        await c.query(
          "INSERT INTO infrastructure_hosts(id,name,kind,token_hash,customer_account_id,provisioning,self_service,cpu_limit,memory_limit_mb,max_running) VALUES($1,$2,'docker',$3,$4,true,false,$5,$6,$7)",
          [
            id,
            b.name,
            hashToken(token),
            a.id,
            b.cpu,
            b.memory,
            Math.max(1, a.plan.max_running_local),
          ],
        );
      } else {
        const changed = await c.query(
          "UPDATE infrastructure_hosts SET enabled=$3,token_hash=$4,last_seen=NULL WHERE id=$1 AND customer_account_id=$2 RETURNING id",
          [id, a.id, b.action === "rotate", hashToken(token)],
        );
        if (!changed.rowCount)
          throw new HttpError(404, "Connector fehlt in deinem Konto.");
        await c.query(
          "UPDATE customer_environments SET access_blocked=true WHERE host_id=$1",
          [id],
        );
      }
      await audit(c, actor, `customer_host.${b.action}`, id);
    });
    return { id, ...(archive ? { archive } : {}), ok: true };
  }
  const a = (
    await pool.query(
      "SELECT p.*,a.subscription_status,a.access_expires_at FROM accounts a JOIN plans p ON p.id=a.plan_id WHERE a.id=$1",
      [w.account_id],
    )
  ).rows[0];
  const hosts = (
    await pool.query(
      "SELECT h.id,h.name,h.enabled,h.last_seen,h.cpu_limit,h.memory_limit_mb,h.max_running,jsonb_build_object('version',h.inventory->'version','containers',h.inventory->'containers') AS inventory,(SELECT count(*)::int FROM customer_environments e WHERE e.host_id=h.id AND e.status<>'deleted') AS environments FROM infrastructure_hosts h WHERE customer_account_id=$1 ORDER BY h.created_at",
      [w.account_id],
    )
  ).rows;
  return {
    hosts,
    policy: await executionPolicy(actor, w),
    eligible:
      a.active &&
      (!a.access_expires_at ||
        new Date(a.access_expires_at).getTime() > Date.now()) &&
      ["active", "local_test"].includes(a.subscription_status) &&
      a.max_customer_hosts > 0,
    limits: {
      hosts: a.max_customer_hosts,
      environments: a.max_local_environments,
      running: a.max_running_local,
    },
  };
}
