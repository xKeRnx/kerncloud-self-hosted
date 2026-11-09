import test from "node:test";
import assert from "node:assert/strict";
import { parseEnvironmentTool } from "../src/core/environment-tools.ts";
const environment_id = "00000000-0000-4000-8000-000000000000";
test("Containerwerkzeuge begrenzen Laufzeit, Eingaben und getrennte Berechtigungen", () => {
  assert.equal(
    parseEnvironmentTool("environment_command", {
      environment_id,
      command: "node --version",
    }).permission,
    "exec",
  );
  assert.equal(
    parseEnvironmentTool("environment_read_file", {
      environment_id,
      path: "index.js",
    }).permission,
    "files",
  );
  assert.equal(
    parseEnvironmentTool("environment_browser", {
      environment_id,
      action: "snapshot",
    }).permission,
    "browser",
  );
  assert.throws(() =>
    parseEnvironmentTool("environment_command", {
      environment_id,
      command: "sleep 40",
      timeout_seconds: 31,
    }),
  );
  assert.throws(() =>
    parseEnvironmentTool("environment_write_file", {
      environment_id,
      path: "index.js",
      content: "ok",
      command: "whoami",
    }),
  );
  assert.throws(() =>
    parseEnvironmentTool("environment_browser", {
      environment_id,
      action: "evaluate",
      text: "arbitrary JS",
    }),
  );
});
