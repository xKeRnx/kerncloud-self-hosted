import test from "node:test";
import assert from "node:assert/strict";
import {
  budgetDecisionScope,
  fallbackAnswers,
  requestedTokens,
} from "../src/core/decision-answers.ts";
test("budget blocks are classified only from known runtime stops", () => {
  assert.equal(
    budgetDecisionScope(
      "Das feste Auftragslimit reicht für keinen weiteren sinnvollen Modellschritt. Kein Anbieteraufruf gestartet.",
    ),
    "run",
  );
  assert.equal(
    budgetDecisionScope(
      "Projektbudget erreicht. Keine weitere Modellreservierung.",
    ),
    "project",
  );
  assert.equal(budgetDecisionScope("Could you increase my budget?"), null);
});
test("custom token requests are numeric previews with a fixed maximum, never executable commands", () => {
  for (const value of [
    "Limit auf 100mio erweitern",
    "Set limit to 100 million tokens",
    "100.000.000 Tokens",
    "100,000,000 tokens",
  ])
    assert.equal(requestedTokens(value), 100000000, value);
  assert.equal(requestedTokens("250k Tokens"), 250000);
  assert.equal(requestedTokens("-100mio"), null);
  assert.equal(requestedTokens("100.5 Tokens"), null);
  assert.equal(requestedTokens("0,2 Mio"), 200000);
  assert.equal(requestedTokens("Limit auf 1000 Mio erweitern"), null);
  assert.equal(requestedTokens("100k auf 100mio erhöhen"), null);
  assert.equal(requestedTokens("Einfach fortsetzen"), null);
});
test("legacy questions receive three bounded reply suggestions", () => {
  for (const kind of ["information", "access", "review", "approval"]) {
    const replies = fallbackAnswers(kind);
    assert.equal(replies.length, 3);
    assert.equal(new Set(replies).size, 3);
    assert.ok(replies.every((v) => v.length < 1000));
  }
});
