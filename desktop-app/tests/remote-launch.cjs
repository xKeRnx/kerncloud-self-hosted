"use strict";
// Runs only on disposable native CI machines, against a local health fixture.
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { createServer } = require("node:http"),
  { spawn } = require("node:child_process");
(async () => {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
  assert.ok(process.env.RUNNER_TEMP && process.argv[2]);
  const folder = path.join(process.env.RUNNER_TEMP, "remote-client-test"),
    runtime = path.join(folder, "runtime"),
    profile = path.join(folder, "profile");
  fs.mkdirSync(profile, { recursive: true });
  fs.mkdirSync(runtime, { recursive: true });
  const grants = path.join(runtime, "grants.fixture.json");
  fs.writeFileSync(grants, '{"fixture":"preserve-access"}');
  const server = createServer((req, res) => {
    assert.equal(req.url, "/api/health");
    res.setHeader("Content-Type", "application/json");
    res.end('{"service":"kerncloud"}');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    fs.writeFileSync(
      path.join(profile, "connection.json"),
      JSON.stringify({
        mode: "remote",
        url: "http://127.0.0.1:" + server.address().port,
      }),
    );
    const report = path.join(folder, "report.json");
    await new Promise((resolve, reject) => {
      const child = spawn(process.argv[2], ["--diagnostics-report", report], {
        env: { ...process.env, KERNCLOUD_DESKTOP_DATA_DIR: runtime },
        stdio: "ignore",
        windowsHide: true,
      });
      const timer = setTimeout(() => {
        child.kill();
        reject(Error("Remote launcher timed out"));
      }, 60000);
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        code === 0
          ? resolve()
          : reject(Error("Remote launcher failed: " + code));
      });
    });
    const proof = JSON.parse(fs.readFileSync(report, "utf8"));
    assert.equal(proof.ok, true);
    assert.equal(proof.rendererLoaded, true);
    assert.equal(proof.serverReady, true);
    assert.equal(proof.connectionMode, "remote");
    assert.equal(proof.docker, null);
    assert.equal(
      fs.existsSync(path.join(runtime, ".env")),
      false,
      "Client mode must not initialize a local server",
    );
    assert.equal(
      fs.existsSync(path.join(runtime, "scripts")),
      false,
      "Client mode must not copy the local server payload",
    );
    assert.equal(
      fs.readFileSync(grants, "utf8"),
      '{"fixture":"preserve-access"}',
    );
    assert.equal(proof.nodeIntegration, false);
    assert.equal(proof.contextIsolation, true);
    assert.equal(proof.sandbox, true);
    console.log(
      "Native existing-server client launch passed without local server initialization; existing fixture permissions retained.",
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
