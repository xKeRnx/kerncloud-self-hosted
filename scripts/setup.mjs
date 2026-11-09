import { randomBytes } from "node:crypto";
import {
  existsSync,
  writeFileSync,
  readFileSync,
  appendFileSync,
} from "node:fs";
if (existsSync(".env")) {
  console.log("Existing .env preserved.");
} else {
  const password = randomBytes(24).toString("hex");
  writeFileSync(
    ".env",
    `POSTGRES_PASSWORD=${password}\nDATABASE_URL=postgresql://kerncloud:${password}@localhost:55432/kerncloud\nENCRYPTION_KEY=${randomBytes(32).toString("hex")}\nWORKER_TOKEN=${randomBytes(32).toString("hex")}\nAPP_TOKEN=${randomBytes(32).toString("hex")}\nPLATFORM_URL=http://localhost:3100\nWORKER_CONCURRENCY=2\n`,
    { mode: 0o600 },
  );
  console.log("Created local .env with unique keys.");
}
if (!readFileSync(".env", "utf8").includes("ADMIN_EMAIL="))
  appendFileSync(
    ".env",
    `ADMIN_EMAIL=admin@kerncloud.local\nADMIN_PASSWORD=${randomBytes(18).toString("base64url")}\nALLOW_LOCAL_ENDPOINTS=true\n`,
  );
if (!readFileSync(".env", "utf8").includes("ALLOW_LOCAL_ENDPOINTS="))
  appendFileSync(".env", "ALLOW_LOCAL_ENDPOINTS=true\n");
