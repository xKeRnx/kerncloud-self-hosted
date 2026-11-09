import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  assertAcyclic,
  assertDependencies,
  projectInput,
  planInput,
  hireInput,
} from "../src/core/organisation.ts";
test("reporting lines reject indirect cycles and excessive depth", () => {
  assert.doesNotThrow(() =>
    assertAcyclic(
      [
        { id: "ceo", parent: null },
        { id: "lead", parent: "ceo" },
        { id: "worker", parent: "lead" },
      ],
      3,
    ),
  );
  assert.throws(
    () =>
      assertAcyclic([
        { id: "a", parent: "c" },
        { id: "b", parent: "a" },
        { id: "c", parent: "b" },
      ]),
    /cycle/,
  );
  assert.throws(
    () =>
      assertAcyclic(
        [
          { id: "a", parent: null },
          { id: "b", parent: "a" },
          { id: "c", parent: "b" },
        ],
        2,
      ),
    /depth/,
  );
});
test("dependency graph admits shared prerequisites but no cycles or foreign steps", () => {
  assert.doesNotThrow(() =>
    assertDependencies([
      { id: "a", dependencies: [] },
      { id: "b", dependencies: ["a"] },
      { id: "c", dependencies: ["a"] },
      { id: "d", dependencies: ["b", "c"] },
    ]),
  );
  assert.throws(
    () =>
      assertDependencies([
        { id: "a", dependencies: ["b"] },
        { id: "b", dependencies: ["a"] },
      ]),
    /cycle/,
  );
  assert.throws(
    () => assertDependencies([{ id: "a", dependencies: ["missing"] }]),
    /outside/,
  );
});
test("plans reject inverted time and estimate ranges", () => {
  const b = { project_id: randomUUID(), title: "Test a usable result" };
  assert.equal(
    planInput.safeParse({ ...b, estimate_min: 20, estimate_max: 5 }).success,
    false,
  );
  assert.equal(
    planInput.safeParse({
      ...b,
      planned_start: "2026-11-02T12:00:00Z",
      target_at: "2026-11-02T11:00:00Z",
    }).success,
    false,
  );
  assert.equal(
    planInput.safeParse({ ...b, estimate_min: 5, estimate_max: 20 }).success,
    true,
  );
});
test("hire payload has bounded cost and cannot carry credentials or elevated grants", () => {
  const b = {
    name: "QA",
    role: "Tester",
    instructions: "Verify concrete outputs with tests.",
    manager_id: randomUUID(),
    project_id: randomUUID(),
    model_id: "fixture",
    credit_limit: 100,
    reason: "A dedicated tester is missing for this project.",
  };
  assert.equal(hireInput.safeParse(b).success, true);
  assert.equal(
    hireInput.safeParse({ ...b, mcp_ids: [randomUUID()] }).success,
    false,
  );
  assert.equal(
    hireInput.safeParse({ ...b, api_key: "fixture-secret" }).success,
    false,
  );
  assert.equal(hireInput.safeParse({ ...b, credit_limit: -1 }).success, false);
  assert.equal(
    projectInput.safeParse({
      name: "Customer project",
      all_agents: false,
      agent_ids: [],
    }).success,
    true,
  );
});
