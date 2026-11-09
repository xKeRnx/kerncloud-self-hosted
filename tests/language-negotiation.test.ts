import test from "node:test";
import assert from "node:assert/strict";
import { negotiateLocale } from "../src/core/language-negotiation.ts";
import { normalizeLanguages } from "../src/core/languages.ts";
import { uiMessage } from "../src/core/ui-messages.ts";
import { apiErrorMessage } from "../src/core/api-error-language.ts";
const config = {
  enabled: ["de", "en"] as ("de" | "en")[],
  defaultLocale: "de" as const,
  browserDetection: true,
};
test("Erster Besuch berücksichtigt Browserpräferenzen, Regionen und q-Gewichte", () => {
  assert.equal(
    negotiateLocale({ acceptLanguage: "en-US,en;q=0.9,de;q=0.6" }, config),
    "en",
  );
  assert.equal(
    negotiateLocale({ acceptLanguage: "de-AT,de;q=0.9,en;q=0.8" }, config),
    "de",
  );
  assert.equal(
    negotiateLocale({ acceptLanguage: "fr-CH,EN-gb;q=0.8,de;q=0.3" }, config),
    "en",
  );
  assert.equal(
    negotiateLocale({ acceptLanguage: "de;q=0,en;q=0.7" }, config),
    "en",
  );
  assert.equal(
    negotiateLocale({ acceptLanguage: "fr,ja;q=0.8" }, config),
    "de",
  );
  assert.equal(
    negotiateLocale({ acceptLanguage: "de;q=bad,en;q=0.8" }, config),
    "en",
  );
});
test("Manuelle Auswahl bleibt vor der Browsersprache bestehen; deaktivierte Sprachen fallen zurück", () => {
  assert.equal(
    negotiateLocale(
      { explicit: "en", cookie: "de", acceptLanguage: "de-DE" },
      config,
    ),
    "en",
  );
  assert.equal(
    negotiateLocale({ cookie: "de", acceptLanguage: "en-US" }, config),
    "de",
  );
  assert.equal(
    negotiateLocale({ cookie: "en", acceptLanguage: "de-DE" }, config),
    "en",
  );
  assert.equal(
    negotiateLocale(
      { explicit: "en", acceptLanguage: "en-US" },
      { enabled: ["de"], defaultLocale: "de" },
    ),
    "de",
  );
  assert.equal(
    negotiateLocale(
      { acceptLanguage: "de-DE" },
      { enabled: ["en"], defaultLocale: "en" },
    ),
    "en",
  );
});
test("UI-Texte sind übersetzt; Platzhalter und unbekannte Nutzerdaten bleiben erhalten", () => {
  assert.equal(
    uiMessage("en", "Profil & Rechnungsdaten"),
    "Profile & billing details",
  );
  assert.equal(
    uiMessage("en", "Kontomenü für {0}", ["Anna"]),
    "Account menu for Anna",
  );
  assert.equal(uiMessage("en", " / Betriebsminute"), " / runtime minute");
  assert.equal(uiMessage("de", "Übersicht"), "Übersicht");
  assert.equal(uiMessage("en", "My own Projekttext"), "My own Projekttext");
  assert.equal(
    apiErrorMessage("en", "Bitte Eingaben prüfen.", 400),
    "Please check your input.",
  );
  assert.equal(apiErrorMessage("de", "Konto fehlt.", 404), "Konto fehlt.");
  assert.match(apiErrorMessage("en", "Konto fehlt.", 404), /not found/);
});

 test("English is the default regardless of browser language; deliberate German selections survive", () => {
   const defaults=normalizeLanguages();
   assert.equal(defaults.defaultLocale,"en");
   assert.deepEqual(defaults.enabled,["en","de"]);
   for(const acceptLanguage of [undefined,"de-DE,de;q=0.9","fr-FR","en-US"])
     assert.equal(negotiateLocale({acceptLanguage},defaults),"en");
   assert.equal(negotiateLocale({cookie:"de",acceptLanguage:"en-US"},defaults),"de");
   assert.equal(negotiateLocale({explicit:"en",cookie:"de"},defaults),"en");
   assert.equal(negotiateLocale({explicit:"de"},defaults),"de");
   assert.equal(negotiateLocale({cookie:"de"},normalizeLanguages({enabled:["en"]})),"en");
 });
