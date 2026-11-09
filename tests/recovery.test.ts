import test from "node:test";
import assert from "node:assert/strict";
import {
  providerReasoning,
  mayRetryModel,
  recoveryCount,
  maxWorkerModelWaitMs,
} from "../src/core/agent-recovery.ts";
import { keepAliveWorkerResult } from "../src/server/worker-recovery.ts";
import { HttpError } from "../src/server/auth.ts";
test("Modellkorrektur bleibt begrenzt", () => {
  assert.equal(mayRetryModel([]), true);
  assert.equal(
    mayRetryModel([
      { role: "user", content: "retry", recovery_code: "MODEL_TIMEOUT" },
    ]),
    false,
  );
  const tools = Array.from({ length: 6 }, () => ({
    role: "tool" as const,
    content: "invalid",
    recovery_code: "TOOL_CORRECTION",
  }));
  assert.equal(recoveryCount(tools), 6);
  assert.equal(mayRetryModel(tools), false);
  assert.equal(maxWorkerModelWaitMs, 1860000);
});
test("Worker erhält sofort Keepalive und danach vollständiges JSON oder konkrete Fehlermetadaten", async () => {
  let resolve!: (value: unknown) => void;
  const pending = new Promise((r) => (resolve = r));
  const response = keepAliveWorkerResult(pending, new AbortController().signal);
  const reader = response.body!.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), "\n");
  resolve({ role: "assistant", content: "done" });
  assert.deepEqual(
    JSON.parse(new TextDecoder().decode((await reader.read()).value)),
    { role: "assistant", content: "done" },
  );
  assert.equal((await reader.read()).done, true);
  const fault = await keepAliveWorkerResult(
    Promise.reject(
      new HttpError(504, "timeout", { code: "MODEL_TIMEOUT", retryable: true }),
    ),
    new AbortController().signal,
  ).json();
  assert.equal(fault.worker_error.code, "MODEL_TIMEOUT");
  assert.equal(fault.worker_error.status, 504);
  assert.equal(fault.worker_error.retryable, true);
});

test("Automatik verwendet ausschließlich die gespeicherte Modellvorgabe; manuelle Auswahl hat Vorrang", () => {
  for (const endpoint of [
    "https://openrouter.ai/api/v1",
    "https://models.example/v1",
  ]) {
    assert.deepEqual(providerReasoning(endpoint), {});
    assert.deepEqual(
      providerReasoning(endpoint, "auto", "provider_default"),
      {},
    );
    assert.deepEqual(
      providerReasoning(endpoint, "provider_default", "low"),
      {},
    );
    assert.deepEqual(providerReasoning(endpoint, "auto", "auto"), {});
    assert.deepEqual(providerReasoning(endpoint, "auto", "unsupported"), {});
  }
  assert.deepEqual(
    providerReasoning("https://models.example/v1", "auto", "low"),
    { reasoning_effort: "low" },
  );
  assert.deepEqual(
    providerReasoning("https://models.example/v1", "high", "low"),
    { reasoning_effort: "high" },
  );
  assert.deepEqual(
    providerReasoning("https://models.example/v1", "minimal", "high"),
    { reasoning_effort: "minimal" },
  );
  assert.deepEqual(
    providerReasoning("https://openrouter.ai/api/v1", "auto", "low"),
    { reasoning: { effort: "low" } },
  );
  assert.deepEqual(
    providerReasoning("https://openrouter.ai/api/v1", "high", "low"),
    { reasoning: { effort: "high" } },
  );
});
