import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
export function storageGuard(root) {
  let budget = 0,
    used = null,
    last = 0,
    pending;
  async function measure(force = false) {
    if (!force && Date.now() - last < 1000 && used !== null) return used;
    if (pending) return pending;
    pending = exec("du", ["-sb", "--", root], {
      timeout: 10000,
      maxBuffer: 10000,
    })
      .then(({ stdout }) => {
        const n = Number(stdout.split(/\s/)[0]);
        if (!Number.isSafeInteger(n) || n < 0)
          throw new Error("Storage measurement unavailable");
        used = n;
        last = Date.now();
        return n;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  }
  return {
    configure(n) {
      if (!Number.isSafeInteger(n) || n < 67108864)
        throw new Error("Storage budget missing");
      budget = n;
    },
    measure,
    async check(extra = 0) {
      if (!budget) throw new Error("Storage budget missing");
      if ((await measure(true)) + extra > budget)
        throw new Error(
          "Storage budget exceeded; remove files or increase the budget",
        );
    },
    async over() {
      try {
        return !!budget && (await measure()) > budget;
      } catch {
        return true;
      }
    },
  };
}
