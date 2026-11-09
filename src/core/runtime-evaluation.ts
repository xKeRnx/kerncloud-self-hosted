import { createHash } from "node:crypto";
import { artifactFingerprint } from "./artifact-validation.ts";
export type AcceptanceCase = {
  name: string;
  maxTokens: number;
  files: string[];
  widths: number[];
  assertions: { action: string; selector: string; value?: string }[];
};
// Expected criteria come from a fixed case, independently of model-selected checks.
export function evaluateAcceptance(
  receipt: any,
  files: Record<string, Uint8Array>,
  expected: AcceptanceCase,
) {
  const checks: { name: string; passed: boolean }[] = [];
  const add = (name: string, passed: boolean) => checks.push({ name, passed });
  const tokens = (receipt.calls ?? []).reduce(
    (n: number, c: any) =>
      n + Number(c.input_tokens ?? 0) + Number(c.output_tokens ?? 0),
    0,
  );
  add("run-completed", receipt.run?.status === "completed");
  add(
    "usage-known",
    receipt.calls?.length > 0 &&
      receipt.calls.every((c: any) => c.status === "settled" && c.usage_known),
  );
  add(
    "fixed-budget",
    tokens <= expected.maxTokens &&
      tokens === Number(receipt.run?.tokens_used) &&
      Number(receipt.run?.token_limit) <= expected.maxTokens,
  );
  add(
    "unassisted",
    receipt.assisted === false &&
      receipt.operatorWritesAfterStart === 0 &&
      (receipt.operatorRuntimeChangesAfterFirstClaim ?? 0) === 0,
  );
  for (const name of expected.files) {
    const meta = receipt.files?.find((f: any) => f.name === name),
      bytes = files[name];
    add(
      "file:" + name,
      !!meta &&
        !!bytes &&
        createHash("sha256").update(bytes).digest("hex") === meta.sha256,
    );
  }
  const currentFiles = (receipt.files ?? [])
    .filter(
      (f: any) => /\.(html?|css|m?js|svg)$/i.test(f.name) && files[f.name],
    )
    .map((f: any) => ({
      id: f.id,
      name: f.name,
      content: Buffer.from(files[f.name]).toString("utf8"),
    }));
  const fingerprint = artifactFingerprint(currentFiles);
  const reports = (receipt.operations ?? [])
    .filter((o: any) => o.tool_name === "validate_artifact" && !o.failed)
    .flatMap((o: any) => {
      try {
        return [JSON.parse(o.result.result)];
      } catch {
        return [];
      }
    })
    .filter((r: any) => r.passed === true && r.fingerprint === fingerprint);
  add("current-file-browser-receipt", reports.length > 0);
  for (const width of expected.widths)
    add(
      "browser-width:" + width,
      reports.some((r: any) =>
        r.results?.some(
          (v: any) =>
            v.viewport?.width === width &&
            v.passed &&
            v.errors?.length === 0 &&
            v.layout?.scroll <= v.layout?.client,
        ),
      ),
    );
  for (const c of expected.assertions)
    add(
      "interaction:" + c.action + ":" + c.selector,
      reports.some((r: any) =>
        r.checks?.some(
          (a: any) =>
            a.action === c.action &&
            a.selector === c.selector &&
            (c.value === undefined || String(a.value) === c.value),
        ),
      ),
    );
  add(
    "skill-evidence",
    receipt.skills?.some((s: any) => s.status === "draft") &&
      receipt.evidence?.evidence?.length > 0 &&
      receipt.evidence.evidence.every((e: any) => e.verified),
  );
  return {
    case: expected.name,
    passed: checks.every((c) => c.passed),
    checks,
    model_calls: receipt.calls?.length ?? 0,
    measured_tokens: tokens,
    provider_cost: receipt.providerEuroCost ?? null,
    initial_browser_failure_observed:
      receipt.initialBrowserFailureObserved === true,
  };
}
