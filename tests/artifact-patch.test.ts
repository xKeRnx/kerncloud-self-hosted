import test from "node:test";
import assert from "node:assert/strict";
import { applyArtifactPatch } from "../src/core/artifact-patch.ts";
test("Kleine Reparaturen verlangen eindeutige Treffer und verändern bei Fehlern keine Vorlage", () => {
  const original =
    '<button type="submit">Demo</button><script>onSubmit()</script>';
  assert.equal(
    applyArtifactPatch(original, [
      { find: 'type="submit"', replace: 'type="button"' },
      { find: "onSubmit()", replace: "onClick()" },
    ]),
    '<button type="button">Demo</button><script>onClick()</script>',
  );
  assert.throws(() =>
    applyArtifactPatch(original, [
      { find: "Demo", replace: "New" },
      { find: "missing", replace: "" },
    ]),
  );
  assert.throws(() =>
    applyArtifactPatch("repeat repeat", [{ find: "repeat", replace: "x" }]),
  );
  assert.throws(() =>
    applyArtifactPatch(original, [{ find: "", replace: "x" }]),
  );
  assert.ok(original.includes('type="submit"'));
});
