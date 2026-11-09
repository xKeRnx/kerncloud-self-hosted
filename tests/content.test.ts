import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLanguages, resolveLocale } from "../src/core/languages.ts";
import { safePageHref } from "../src/core/pages.ts";
test("Ausgeschaltete und unbekannte Sprachen fallen auf eine aktive Standardsprache zurück", () => {
  const config = normalizeLanguages({ enabled: ["en"], defaultLocale: "de" });
  assert.deepEqual(config, { enabled: ["en"], defaultLocale: "en", browserDetection: false });
  assert.equal(resolveLocale("de", config), "en");
  assert.equal(resolveLocale("fr", config), "en");
  assert.equal(resolveLocale(null, config), "en");
});
test("Seiten-Links erlauben lokale Ziele und HTTP(S), verbieten ausführbare und verschleierte URLs", () => {
  for (const url of [
    "/signup",
    "/p/about?lang=en#team",
    "https://example.com/team",
  ])
    assert.equal(safePageHref(url), true, url);
  for (const url of [
    "",
    "javascript:alert(1)",
    "data:text/html,evil",
    "//evil.test",
    "/\\evil.test",
    "https://user:password@example.com",
    "/\nevil.test",
    "https://evil.test\t",
  ])
    assert.equal(safePageHref(url), false, url);
});
