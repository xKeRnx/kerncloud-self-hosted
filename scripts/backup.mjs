import { spawn } from "node:child_process";
import { createWriteStream, writeFileSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const name = `kerncloud-${stamp}-${randomBytes(3).toString("hex")}.dump`;
const destination = resolve("backups", name);
mkdirSync(resolve("backups"), { recursive: true });
execFileSync(
  "docker",
  [
    "compose",
    "exec",
    "-T",
    "postgres",
    "pg_dump",
    "-U",
    "kerncloud",
    "-Fc",
    "-f",
    `/tmp/${name}`,
    "kerncloud",
  ],
  { stdio: "inherit" },
);
execFileSync(
  "docker",
  ["compose", "cp", `postgres:/tmp/${name}`, destination],
  { stdio: "inherit" },
);
console.log(`Backup gespeichert: ${destination}`);
console.log(
  "ENCRYPTION_KEY separat sicher verwahren. Wiederherstellung nur in einer getrennten Datenbank prüfen.",
);

const objectContainer = execFileSync(
  "docker",
  ["compose", "ps", "-q", "object-storage"],
  { encoding: "utf8" },
).trim();
if (objectContainer) {
  const archive = destination + ".objects.tar.gz";
  const child = spawn(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "object-storage",
      "tar",
      "-C",
      "/data",
      "-czf",
      "-",
      ".",
    ],
    { stdio: ["ignore", "pipe", "inherit"], windowsHide: true },
  );
  const completed = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve(null) : reject(new Error("Object backup failed")),
    );
  });
  await Promise.all([
    pipeline(child.stdout, createWriteStream(archive, { flags: "wx" })),
    completed,
  ]);
  writeFileSync(
    destination + ".manifest.json",
    JSON.stringify(
      {
        database: destination,
        objects: archive,
        created_at: new Date().toISOString(),
        encryption_key: "Store separately; required for object restore",
      },
      null,
      2,
    ),
  );
  console.log("Object backup saved: " + archive);
}
