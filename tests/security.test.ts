import test from "node:test";
import assert from "node:assert/strict";
import {
  hashPassword,
  verifyPassword,
  encrypt,
  decrypt,
  sameSecret,
  validateEndpoint,
} from "../src/server/security.ts";
import { NextRequest } from "next/server";
import { checkOrigin } from "../src/server/auth.ts";
test("Passwörter sind gesalzen; falsche Passwörter werden abgelehnt", () => {
  const a = hashPassword("correct horse battery staple"),
    b = hashPassword("correct horse battery staple");
  assert.notEqual(a, b);
  assert.equal(verifyPassword("correct horse battery staple", a), true);
  assert.equal(verifyPassword("wrong password", a), false);
});
test("Anbieter-Schlüssel sind authentifiziert verschlüsselt", () => {
  process.env.ENCRYPTION_KEY = "a".repeat(64);
  const encrypted = encrypt("fixture-secret");
  assert.ok(!encrypted.includes("fixture-secret"));
  assert.equal(decrypt(encrypted), "fixture-secret");
  const parts = encrypted.split(".");
  parts[2] = Buffer.from("tampered").toString("base64");
  assert.throws(() => decrypt(parts.join(".")));
});
test("Leere Worker-Schlüssel und gefährliche URL-Schemata werden abgelehnt", () => {
  assert.equal(sameSecret("", ""), false);
  assert.equal(sameSecret("key", "another"), false);
  assert.throws(() => validateEndpoint("file:///etc/passwd"));
  assert.throws(() => validateEndpoint("http://name:password@localhost"));
  assert.equal(
    validateEndpoint("https://example.com/v1/"),
    "https://example.com/v1",
  );
});
test("Origin-Prüfung akzeptiert lokalen Browser hinter einem gebundenen Server und lehnt fremde Seiten ab", () => {
  assert.doesNotThrow(() =>
    checkOrigin(
      new NextRequest("http://0.0.0.0:3100/api/auth/login", {
        headers: { host: "localhost:3100", origin: "http://localhost:3100" },
      }),
    ),
  );
  assert.throws(() =>
    checkOrigin(
      new NextRequest("http://0.0.0.0:3100/api/auth/login", {
        headers: { host: "localhost:3100", origin: "https://foreign.example" },
      }),
    ),
  );
});
