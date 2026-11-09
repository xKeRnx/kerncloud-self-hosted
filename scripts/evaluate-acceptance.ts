import fs from "node:fs/promises";
import path from "node:path";
import { evaluateAcceptance } from "../src/core/runtime-evaluation.ts";
const directory = process.argv[2];
if (!directory)
  throw new Error(
    "Usage: evaluate-acceptance.ts <receipt-and-files-directory> [case.json]",
  );
const expected = JSON.parse(
  await fs.readFile(process.argv[3] ?? "tests/evals/website.json", "utf8"),
);
const receipt = JSON.parse(
  (
    await fs.readFile(path.join(directory, "test-receipt.json"), "utf8")
  ).replace(/^\uFEFF/, ""),
);
const files: Record<string, Uint8Array> = {};
const root = path.resolve(directory);
for (const { name } of receipt.files) {
  const target = path.resolve(root, name);
  if (!target.startsWith(root + path.sep))
    throw new Error("Receipt path outside selected directory");
  files[name] = await fs.readFile(target);
}
const result = evaluateAcceptance(receipt, files, expected);
await fs.mkdir("test-results/runtime-regression", { recursive: true });
await fs.writeFile(
  "test-results/runtime-regression/acceptance-scorecard.json",
  JSON.stringify(
    {
      ...result,
      kind: "existing-run-evidence-recheck",
      new_provider_calls: 0,
      run_id: receipt.run.id,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(result));
if (!result.passed) process.exitCode = 1;
