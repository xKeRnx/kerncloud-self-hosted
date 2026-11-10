"use strict";
const path = require("node:path"),
  { pathToFileURL } = require("node:url");
import(pathToFileURL(path.join(process.cwd(), "scripts/self-host.mjs")).href)
  .then((m) =>
    m.main(process.argv.slice(2), process.cwd(), {
      onProgress: (event) =>
        process.parentPort?.postMessage({ type: "progress", ...event }),
      onServices: (services) =>
        process.parentPort?.postMessage({ type: "services", services }),
    }),
  )
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
