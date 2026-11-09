import test from "node:test";
import assert from "node:assert/strict";
import {
  environmentHost,
  environmentOrigin,
  environmentBase,
} from "../src/server/environment-access.ts";
test("Kundenumgebungen nutzen getrennte Origins und lehnen fremde oder verschleierte Hosts ab", () => {
  const previous = process.env.PUBLIC_ENVIRONMENT_URL;
  try {
    process.env.PUBLIC_ENVIRONMENT_URL = "http://localhost:3200";
    const a = "01234567-89ab-4cde-8f01-23456789abcd",
      b = "11234567-89ab-4cde-8f01-23456789abcd";
    assert.notEqual(environmentOrigin(a), environmentOrigin(b));
    assert.equal(environmentHost(a + ".localhost:3200"), a);
    assert.equal(environmentHost(a + ".localhost:3100"), null);
    assert.equal(environmentHost(a + ".localhost.evil.test:3200"), null);
    assert.equal(environmentHost("user@" + a + ".localhost:3200"), null);
    assert.equal(environmentHost(a + ".localhost:3200/path"), null);
  } finally {
    if (previous === undefined) delete process.env.PUBLIC_ENVIRONMENT_URL;
    else process.env.PUBLIC_ENVIRONMENT_URL = previous;
  }
});
test("Öffentlicher Kundenzugang verlangt HTTPS und eine andere Origin als die Plattform", () => {
  const previous = process.env.PUBLIC_ENVIRONMENT_URL,
    platform = process.env.PUBLIC_URL;
  try {
    process.env.PUBLIC_URL = "https://cloud.example.test";
    process.env.PUBLIC_ENVIRONMENT_URL = "http://environments.example.test";
    assert.throws(environmentBase);
    process.env.PUBLIC_ENVIRONMENT_URL = "https://cloud.example.test";
    assert.throws(environmentBase);
    process.env.PUBLIC_ENVIRONMENT_URL = "https://environments.example.test";
    assert.equal(environmentBase().protocol, "https:");
  } finally {
    for (const [name, value] of [
      ["PUBLIC_ENVIRONMENT_URL", previous],
      ["PUBLIC_URL", platform],
    ])
      if (value === undefined) delete process.env[name!];
      else process.env[name!] = value;
  }
});
