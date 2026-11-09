import test from "node:test";
import assert from "node:assert/strict";
import {
  legalPlainText,
  renderLegalHtml,
  sanitizeLegalHtml,
} from "../src/server/legal-html.ts";

test("Rechtstexte behalten Überschriften, Listen und sichere Kontaktlinks", () => {
  const value = sanitizeLegalHtml(
    '<h2>Kontakt</h2><p><strong>Firma</strong> <em>Beispiel</em> <u>Deutschland</u></p><ol start="3"><li>Adresse</li></ol><a href="mailto:kontakt@example.test">E-Mail</a><a href="https://example.test" target="_blank">Website</a>',
  );
  assert.match(value, /<h2>Kontakt<\/h2>/);
  assert.match(value, /<strong>Firma<\/strong>/);
  assert.match(value, /<ol start="3">/);
  assert.match(value, /href="mailto:kontakt@example.test"/);
  assert.match(value, /rel="noopener noreferrer nofollow"/);
});

test("HTML-Ansicht entfernt Skripte, aktive Einbettungen, Events und gefährliche URLs", () => {
  const value = sanitizeLegalHtml(
    '<script>alert(1)</script><style>body{display:none}</style><iframe src="https://evil.test">hidden frame</iframe><svg><script>alert(2)</script></svg><math><mi>unsafe</mi></math><p onclick="alert(3)" style="background:url(https://evil.test)">Sicher</p><img src="x" onerror="alert(4)"><a href="javascript&#58;alert(5)" onclick="alert(6)">Link</a><a href="//evil.test">Relativ</a><a href="data:text/html,attack">Data</a><form action="https://evil.test"><input name="password"></form>',
  );
  assert.match(value, /<p>Sicher<\/p>/);
  assert.doesNotMatch(
    value,
    /<script|<style|<iframe|<svg|<math|<img|<form|<input|onclick|onerror|javascript|data:text|href="\/\//i,
  );
  assert.doesNotMatch(value, /alert\(|hidden frame|unsafe/);
});

test("Bestehender Klartext wird ohne HTML-Interpretation und mit Absatzumbrüchen übernommen", () => {
  const value = renderLegalHtml(
    "Firma <Beispiel> & Partner\nStraße 1\n\nKontakt: <script>nur Text</script>",
    "text",
  );
  assert.match(value, /Firma &lt;Beispiel&gt; &amp; Partner<br/);
  assert.match(
    value,
    /<p>Kontakt: &lt;script&gt;nur Text&lt;\/script&gt;<\/p>/,
  );
  assert.equal(
    legalPlainText("<p><br></p><script>unsichtbare Zeichen</script>", "html"),
    "",
  );
});

test("Bereinigtes HTML bleibt bei erneuter Verarbeitung stabil", () => {
  const first = sanitizeLegalHtml(
    '<h3>Angaben</h3><p>Kontakt <a href="https://example.test">Website</a></p><blockquote>Hinweis</blockquote>',
  );
  assert.equal(sanitizeLegalHtml(first), first);
});
