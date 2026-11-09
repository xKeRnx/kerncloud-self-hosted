import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool, transaction, seedWorkspace } from "../../src/server/db.ts";
import { hashPassword } from "../../src/server/security.ts";
import { saveModel } from "../../src/server/catalog.ts";
import { createRun } from "../../src/server/store.ts";
import { guardedToolStep } from "../../src/server/worker-recovery.ts";
import { saveRunPolicy } from "../../src/server/run-policy.ts";
import { runtimeInsights } from "../../src/server/runtime-insights.ts";
import { writeMemory, listMemory } from "../../src/server/memory.ts";
import { forgetMemorySource } from "../../src/server/memory-provenance.ts";
import {
  recordProviderFailure,
  providerCooldown,
} from "../../src/server/provider-health.ts";
import { providerFor } from "../../src/server/store.ts";
import { modelStep } from "../../src/server/engine.ts";
import {
  automationAction,
  automationWebhook,
  tickAutomations,
  listAutomations,
} from "../../src/server/automations.ts";
import { spawn } from "node:child_process";
export async function runtimeImprovementTests(
  t: any,
  fixtureUrl: string,
  platformUrl: string,
) {
  const owner = randomUUID();
  await pool.query(
    "INSERT INTO users(id,email,name,password_hash,privacy_version) VALUES($1,$2,'Runtime fixtures',$3,'fixture')",
    [
      owner,
      `runtime-${owner}@test.local`,
      hashPassword("runtime-fixture-password"),
    ],
  );
  try {
    const workspace = await transaction((c) =>
      seedWorkspace(c, owner, "Runtime fixtures", true),
    );
    await pool.query(
      "UPDATE accounts SET plan_id='business',subscription_status='local_test' WHERE owner_id=$1",
      [owner],
    );
    const model = await saveModel(
      owner,
      {
        name: "Never-called protocol fixture",
        provider_name: "Fixture only",
        endpoint: fixtureUrl + "/v1",
        model: "fixture",
        key: "",
        max_output_tokens: 1024,
      },
      workspace,
    );
    await pool.query(
      "UPDATE workspaces SET default_model_id=$2,ai_mode='byok' WHERE id=$1",
      [workspace, model.id],
    );
    const agent = (
      await pool.query("SELECT id FROM agents WHERE workspace_id=$1 LIMIT 1", [
        workspace,
      ])
    ).rows[0].id;
    await saveRunPolicy(workspace, {
      credit_limit: 0,
      token_limit: 10000,
      fallback_model_ids: [],
      context_strategy: "cache_aware",
    });
    const w = (
      await pool.query("SELECT * FROM workspace_context WHERE id=$1", [
        workspace,
      ])
    ).rows[0];
    const run = await createRun(w, "Protocol fixture: local pipeline", agent);
    const task = (
        await pool.query("SELECT * FROM tasks WHERE run_id=$1", [run.id])
      ).rows[0],
      lease = randomUUID();
    await pool.query(
      "UPDATE tasks SET status='running',lease_token=$2,lease_until=now()+interval '10 minutes' WHERE id=$1",
      [task.id, lease],
    );
    await t.test(
      "Pipeline journals each step, resolves dependencies and resumes without duplicate writes",
      async () => {
        const args = {
          steps: [
            {
              tool: "save_artifact",
              args: {
                name: "report.txt",
                content: "deterministic pipeline fixture",
                mime_type: "text/plain",
              },
              select: ["artifact_id", "name"],
            },
            {
              tool: "read_artifact",
              args: { artifact_id: { $step: 0, path: ["artifact_id"] } },
            },
          ],
        };
        const a = await guardedToolStep(
          task.id,
          lease,
          "fixture-pipeline",
          "tool_pipeline",
          args,
          [],
          {},
        );
        assert.equal(a.isError, false, a.result);
        const b = await guardedToolStep(
          task.id,
          lease,
          "fixture-pipeline",
          "tool_pipeline",
          args,
          [],
          {},
        );
        assert.deepEqual(a, b);
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int n FROM artifacts WHERE run_id=$1",
              [run.id],
            )
          ).rows[0].n,
          1,
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int n FROM model_calls WHERE run_id=$1",
              [run.id],
            )
          ).rows[0].n,
          0,
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int n FROM operations WHERE task_id=$1 AND tool_name IN('save_artifact','read_artifact')",
              [task.id],
            )
          ).rows[0].n,
          2,
        );
      },
    );
    await t.test(
      "Pipeline stops on failed authorization and task lease fencing is retained",
      async () => {
        const bad = await guardedToolStep(
          task.id,
          lease,
          "blocked-pipeline",
          "tool_pipeline",
          {
            steps: [
              { tool: "read_artifact", args: { artifact_id: randomUUID() } },
              {
                tool: "save_artifact",
                args: { name: "must-not-exist.txt", content: "wrong" },
              },
            ],
          },
          [],
          {},
        );
        assert.equal(bad.isError, true);
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int n FROM artifacts WHERE run_id=$1 AND name='must-not-exist.txt'",
              [run.id],
            )
          ).rows[0].n,
          0,
        );
        await assert.rejects(
          guardedToolStep(
            task.id,
            randomUUID(),
            "wrong-lease",
            "tool_pipeline",
            {
              steps: [
                { tool: "read_artifact", args: { artifact_id: randomUUID() } },
              ],
            },
            [],
            {},
          ),
        );
      },
    );
    await t.test(
      "Context strategy is snapshotted and cost data cannot leak across workspaces",
      async () => {
        const stored = (
          await pool.query(
            "SELECT model_policy,token_limit FROM runs WHERE id=$1",
            [run.id],
          )
        ).rows[0];
        assert.equal(stored.model_policy.context_strategy, "cache_aware");
        assert.equal(stored.token_limit, 10000);
        const insights = await runtimeInsights(workspace);
        assert.deepEqual(insights.strategies, []);
        assert.equal(insights.provider_cost_currency, "USD");
      },
    );
    await t.test(
      "Tool search finds German intent and cannot disclose unassigned MCP tools",
      async () => {
        const output = await guardedToolStep(
          task.id,
          lease,
          "search-function",
          "tool_search",
          { query: "Dateien lesen" },
          [],
          { private_tool: { connectionId: randomUUID(), toolName: "private" } },
        );
        const result = JSON.parse(output.result);
        assert.ok(
          result.matches.some((m: any) =>
            [
              "read_artifact",
              "environment_read_file",
              "read_attachment",
            ].includes(m.name),
          ),
        );
        assert.ok(!result.matches.some((m: any) => m.name === "private_tool"));
      },
    );
    await t.test(
      "Memory tracks versions, rejects foreign sources, previews deletion and prevents re-ingestion",
      async () => {
        const input = {
          key: "origin-fixture",
          title: "Derived fixture memory",
          content: "Derived from the fixture run",
          kind: "knowledge" as const,
          status: "open" as const,
          evidence: "fixture run",
          expected_revision: null,
          pinned: false,
          verified: false,
          source_refs: [{ kind: "run" as const, id: run.id }],
        };
        await transaction((c) =>
          writeMemory(c, workspace, input, agent, false, true),
        );
        await assert.rejects(
          transaction((c) =>
            writeMemory(
              c,
              workspace,
              {
                ...input,
                key: "forbidden-source",
                source_refs: [{ kind: "run", id: randomUUID() }],
              },
              agent,
            ),
          ),
        );
        const entries = await transaction((c) =>
          listMemory(c, workspace, "", true),
        );
        assert.equal(
          entries.find((e) => e.key === input.key).sources[0].stale,
          false,
        );
        const preview: any = await forgetMemorySource(owner, workspace, {
          source: { kind: "run", id: run.id },
          action: "preview",
        });
        assert.ok(preview.entries.length > 0);
        await assert.rejects(
          forgetMemorySource(owner, workspace, {
            source: { kind: "run", id: run.id },
            action: "forget",
            preview_hash: "outdated",
          }),
        );
        const removed: any = await forgetMemorySource(owner, workspace, {
          source: { kind: "run", id: run.id },
          action: "forget",
          preview_hash: preview.preview_hash,
        });
        assert.equal(removed.deleted, 1);
        await assert.rejects(
          transaction((c) =>
            writeMemory(c, workspace, input, agent, false, true),
          ),
        );
        assert.ok(
          (await pool.query("SELECT id FROM runs WHERE id=$1", [run.id]))
            .rowCount,
        );
      },
    );
    await t.test(
      "Provider cooldown is shared without charging another model call or leaking credential scope",
      async () => {
        const route = await transaction((c) =>
          providerFor(c, workspace, model.id),
        );
        await transaction((c) =>
          recordProviderFailure(c, route.provider, "rate_limit", 60),
        );
        assert.ok(
          await transaction((c) => providerCooldown(c, route.provider)),
        );
        assert.equal(
          await transaction((c) =>
            providerCooldown(c, {
              ...route.provider,
              secret: "other-credential",
            }),
          ),
          null,
        );
        await assert.rejects(
          modelStep(
            task.id,
            lease,
            [
              { role: "system", content: "Fixture" },
              { role: "user", content: "No paid call" },
            ],
            [],
          ),
          (e: any) => e.details?.code === "MODEL_COOLDOWN",
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int n FROM model_calls WHERE run_id=$1",
              [run.id],
            )
          ).rows[0].n,
          0,
        );
        await pool.query("DELETE FROM provider_health WHERE model_id=$1", [
          model.id,
        ]);
      },
    );
    await t.test(
      "Webhook deduplication and real HTTP worker execute an approved pipeline with zero model calls",
      { timeout: 25000 },
      async () => {
        const skill = randomUUID();
        await pool.query(
          "INSERT INTO skills(id,workspace_id,name,description,content,status) VALUES($1,$2,'Approved fixture recipe','Test only','Save a verified text report.','approved')",
          [skill, workspace],
        );
        await pool.query("UPDATE agents SET skill_ids=$2 WHERE id=$1", [
          agent,
          JSON.stringify([skill]),
        ]);
        const created: any = await automationAction(owner, workspace, {
          action: "save",
          name: "No-model fixture",
          agent_id: agent,
          skill_id: skill,
          mode: "pipeline",
          goal: "Save a deterministic report without model calls.",
          recipe: {
            steps: [
              {
                tool: "save_artifact",
                args: {
                  name: "automation.txt",
                  content: "Approved deterministic fixture",
                },
              },
            ],
          },
          interval_minutes: null,
          enabled: true,
          token_limit: 10000,
          credit_limit: 0,
        });
        assert.ok(created.webhook_token);
        assert.ok(
          !JSON.stringify(await listAutomations(workspace)).includes(
            created.webhook_token,
          ),
        );
        await assert.rejects(
          automationWebhook(created.id, "wrong-secret", "test-event-123"),
        );
        await Promise.all([
          automationWebhook(
            created.id,
            created.webhook_token,
            "test-event-123",
          ),
          automationWebhook(
            created.id,
            created.webhook_token,
            "test-event-123",
          ),
        ]);
        await tickAutomations();
        const trigger = (
          await pool.query(
            "SELECT * FROM automation_triggers WHERE automation_id=$1",
            [created.id],
          )
        ).rows;
        assert.equal(trigger.length, 1);
        assert.ok(trigger[0].run_id);
        const again = await createRun(
          w,
          "ignored duplicate",
          agent,
          [],
          false,
          [agent],
          "",
          { automation: { triggerId: trigger[0].id, revision: 1 } },
        );
        assert.equal(again.id, trigger[0].run_id);
        const worker = spawn(
          process.execPath,
          ["--import", "tsx", "src/worker.ts"],
          {
            env: {
              ...process.env,
              PLATFORM_URL: platformUrl,
              WORKER_ID: randomUUID(),
              WORKER_CONCURRENCY: "1",
            },
            stdio: "ignore",
          },
        );
        try {
          let completed = false;
          for (let n = 0; n < 100; n++) {
            const state = (
              await pool.query("SELECT status FROM runs WHERE id=$1", [
                trigger[0].run_id,
              ])
            ).rows[0];
            if (state.status === "completed") {
              completed = true;
              break;
            }
            await new Promise((r) => setTimeout(r, 150));
          }
          assert.ok(completed, "Deterministic worker must complete");
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::int n FROM model_calls WHERE run_id=$1",
                [trigger[0].run_id],
              )
            ).rows[0].n,
            0,
          );
          const allocation = (
            await pool.query(
              "SELECT calls FROM automation_usage WHERE account_id=$1",
              [w.account_id],
            )
          ).rows[0];
          assert.equal(
            allocation.calls,
            1,
            "Duplicate triggers must consume one execution only",
          );
          await pool.query(
            "UPDATE accounts SET access_expires_at=now()-interval '1 minute' WHERE id=$1",
            [w.account_id],
          );
          await assert.rejects(
            automationAction(owner, workspace, {
              action: "run",
              id: created.id,
            }),
          );
          await pool.query(
            "UPDATE accounts SET access_expires_at=NULL WHERE id=$1",
            [w.account_id],
          );
          await pool.query("UPDATE skills SET version=version+1 WHERE id=$1", [
            skill,
          ]);
          await automationAction(owner, workspace, {
            action: "run",
            id: created.id,
          });
          await tickAutomations();
          assert.ok(
            (
              await pool.query(
                "SELECT 1 FROM automation_triggers WHERE automation_id=$1 AND status='blocked'",
                [created.id],
              )
            ).rowCount,
          );
          await pool.query(
            "UPDATE automation_usage SET calls=2000 WHERE account_id=$1",
            [w.account_id],
          );
          await automationAction(owner, workspace, {
            action: "run",
            id: created.id,
          });
          await tickAutomations();
          assert.ok(
            (
              await pool.query(
                "SELECT 1 FROM automation_triggers WHERE automation_id=$1 AND error LIKE '%kontingent%'",
                [created.id],
              )
            ).rowCount,
          );
        } finally {
          worker.kill("SIGTERM");
          await new Promise((r) => setTimeout(r, 600));
          if (worker.exitCode === null) worker.kill("SIGKILL");
        }
      },
    );
  } finally {
    await pool.query("DELETE FROM users WHERE id=$1", [owner]);
  }
}
