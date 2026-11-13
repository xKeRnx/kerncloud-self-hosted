import { ensureDb, pool } from "./server/db.ts";
import { dispatchSocialReply } from "./server/social.ts";
import { dispatchContent } from "./server/content-research.ts";
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
await ensureDb();
const parallel = Math.max(
  1,
  Math.min(16, Number(process.env.PUBLISHER_CONCURRENCY ?? 4) || 4),
);
console.log("[Publisher] Approved content queue ready; no model calls.");
while (!stopping) {
  await Promise.all(
    Array.from({ length: parallel }, () =>
      Promise.all([dispatchContent(), dispatchSocialReply()]).catch(() => {
        console.error(
          "[Publisher] Claim failed; dispatch state retained for review.",
        );
      }),
    ),
  );
  if (!stopping) await new Promise((resolve) => setTimeout(resolve, 2000));
}
await pool.end();
