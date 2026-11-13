import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  destination = path.join(root, "desktop-app/payload");
if (
  !/export const edition = 'self-hosted'/.test(
    fs.readFileSync(path.join(root, "src/core/edition.ts"), "utf8"),
  )
)
  throw Error(
    "Desktop installers must use the self-hosted source distribution.",
  );
if (fs.existsSync(destination) && !process.argv.includes("--refresh"))
  throw Error(
    "Desktop payload already exists. Use --refresh to update this generated source payload; existing runtime data is not touched.",
  );
const skip = new Set([
  ".release",
  ".local-service-state.json",
  ".local-rollback.json",
  ".local-rollback-active.json",
  ".local-networks.yaml",
  "node_modules",
  ".next",
  ".git",
  ".github",
  "backups",
  "test-results",
  "desktop-app",
  ".bridge-update-keys",
  ".signing",
  "releases",
  "dist",
  "dist-final",
  "dist-installers",
  "dist-signing",
  "dist-macos",
]);
for (const name of fs.readdirSync(root)) {
  if (
    skip.has(name) ||
    name.startsWith(".env") ||
    name.endsWith(".tsbuildinfo")
  )
    continue;
  fs.cpSync(path.join(root, name), path.join(destination, name), {
    recursive: true,
    filter: (p) =>
      !skip.has(path.basename(p)) &&
      !path.basename(p).startsWith(".env") &&
      !/\.(pfx|p12|p8|key|pem|dump|log)$/i.test(p),
  });
}
console.log(
  "Desktop server source payload prepared without local configuration or data.",
);
