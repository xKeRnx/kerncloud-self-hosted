import test from "node:test";
import assert from "node:assert/strict";
import { base32, totpCode, matchingTotpStep } from "../src/core/totp.ts";
test("TOTP stimmt mit den SHA1-Referenzwerten aus RFC 6238 überein", () => {
  const secret = base32(Buffer.from("12345678901234567890"));
  for (const [seconds, expected] of [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ] as const)
    assert.equal(totpCode(secret, seconds * 1000, 8), expected);
});
test("TOTP hat ein begrenztes Zeitfenster und weist bereits verwendete Schritte zurück", () => {
  const secret = base32(Buffer.from("12345678901234567890")),
    time = 1234567890000,
    step = Math.floor(time / 30000);
  assert.equal(
    matchingTotpStep(secret, totpCode(secret, time), -1, time),
    step,
  );
  assert.equal(
    matchingTotpStep(secret, totpCode(secret, time), step, time),
    null,
  );
  assert.equal(
    matchingTotpStep(secret, totpCode(secret, time + 60000), -1, time),
    null,
  );
  assert.equal(matchingTotpStep(secret, "00000x", -1, time), null);
});
