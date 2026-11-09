import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { pool, transaction, seedWorkspace } from "../../src/server/db.ts";
import { hashPassword } from "../../src/server/security.ts";
import { saveModel } from "../../src/server/catalog.ts";
import {
  createRun,
  snapshot,
  recoverExpiredTasks,
} from "../../src/server/store.ts";
import { saveRunPolicy } from "../../src/server/run-policy.ts";
import { modelStep, context, checkpoint } from "../../src/server/engine.ts";
import { guardedToolStep } from "../../src/server/worker-recovery.ts";
import {
  reviewSkill,
  skillHistory,
  skillEvidence,
} from "../../src/server/learned-skills.ts";
import {
  runCheckpoints,
  authorizeCheckpointJob,
} from "../../src/server/checkpoints.ts";
import type { Message } from "../../src/core/types.ts";

export async function agentWorkflowTests(t: any, platformUrl: string) {
  assert.ok(new URL(process.env.DATABASE_URL!).pathname.endsWith("_test"));
  let status = 503,
    delay = 0;
  const calls: string[] = [];
  let lastMessages: any[] = [];
  const server = createServer(async (req, res) => {
    if(req.method === "GET" && req.url?.endsWith("/models")) { res.statusCode=404; res.end(); return; }
    let raw = "";
    for await (const p of req) raw += p;
    const body = JSON.parse(raw);
    lastMessages = body.messages;
    calls.push(body.model);
    if (delay) await new Promise((r) => setTimeout(r, delay));
    if (body.model === "primary" && status !== 200) {
      res.writeHead(status).end("{}");
      return;
    }
    if (body.model === "autonomous-website-fixture") {
      const history = body.messages;
      const outputs = history
        .filter((m: any) => m.role === "tool")
        .map((m: any) => {
          try {
            return JSON.parse(m.content);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      const saved = outputs.find(
        (x: any) => x.name === "index.html" && x.artifact_id,
      );
      const patched = outputs.find((x: any) => x.previous_artifact_id);
      const accepted = outputs.find(
        (x: any) =>
          x.passed === true || x.automatic_validation?.passed === true,
      );
      const call = (name: string, args: any) => ({
        id: randomUUID(),
        type: "function",
        function: { name, arguments: JSON.stringify(args) },
      });
      let tool_calls: any[];
      if (!saved)
        tool_calls = [
          call("save_artifact", {
            name: "index.html",
            content: "<!doctype html><html><body><h1>BROKEN</h1></body></html>",
          }),
        ];
      else if (!outputs.some((x: any) => x.passed === false))
        tool_calls = [
          call("validate_artifact", {
            artifact_id: saved.artifact_id,
            checks: [{ action: "assert_text", selector: "h1", value: "FIXED" }],
          }),
        ];
      else if (!patched)
        tool_calls = [
          call("patch_artifact", {
            artifact_id: saved.artifact_id,
            changes: [{ find: "BROKEN", replace: "FIXED" }],
          }),
        ];
      else if (!accepted)
        tool_calls = [
          call("validate_artifact", {
            artifact_id: patched.artifact_id,
            checks: [{ action: "assert_text", selector: "h1", value: "FIXED" }],
          }),
        ];
      else
        tool_calls = [
          call("propose_skill", {
            name: "Autonomous fixture workflow",
            description: "Protocol fixture for bounded browser repair",
            content:
              "Save a complete file. Test the expected behavior. Inspect the actual failure. Patch only the failing content. Test the current version again and stop within the shared budget.",
            verification:
              "The local protocol fixture supplies a failing report and a passing report for the corrected version.",
          }),
          call("finish_task", {
            summary:
              "Protocol fixture repaired and checked without operator messages",
          }),
        ];
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          choices: [
            {
              message: { role: "assistant", content: null, tool_calls },
              finish_reason: "tool_calls",
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 2,
            total_tokens: 12,
          },
        }),
      );
      return;
    }
    res.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({
        choices: [
          {
            message: {
              role: "assistant",
              content: "Local workflow fixture only",
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  const owner = randomUUID(),
    stranger = randomUUID();
  let workspace = "",
    other = "",
    primary = "",
    fallback = "",
    agent = "";
  const models: string[] = [];
  async function makeModel(name: string, scope: string | null = null) {
    const m = await saveModel(
      owner,
      {
        name,
        provider_name: "Local protocol fixture",
        endpoint: `http://127.0.0.1:${port}/v1`,
        model: name,
        key: "",
        input_rate: 0,
        output_rate: 0,
        base_credits: 1000,
        max_output_tokens: 1024,
        streaming: false,
      },
      scope,
    );
    models.push(m.id);
    return m.id;
  }
  try {
    for (const id of [owner, stranger])
      await pool.query(
        "INSERT INTO users(id,email,name,password_hash,privacy_version) VALUES($1,$2,'Workflow fixture',$3,'fixture')",
        [
          id,
          `workflow-${id}@test.local`,
          hashPassword("workflow-fixture-password"),
        ],
      );
    workspace = await transaction((c) =>
      seedWorkspace(c, owner, "Workflow fixtures", true),
    );
    other = await transaction((c) =>
      seedWorkspace(c, stranger, "Other fixtures", true),
    );
    await pool.query(
      "UPDATE accounts SET plan_id='business',credits=100000,subscription_status='local_test' WHERE owner_id=$1",
      [owner],
    );
    primary = await makeModel("primary");
    fallback = await makeModel("fallback");
    await pool.query(
      "UPDATE workspaces SET ai_mode='managed',default_model_id=$2 WHERE id=$1",
      [workspace, primary],
    );
    agent = (
      await pool.query(
        "SELECT id FROM agents WHERE workspace_id=$1 ORDER BY id LIMIT 1",
        [workspace],
      )
    ).rows[0].id;
    const w = () =>
      pool
        .query("SELECT * FROM workspace_context WHERE id=$1", [workspace])
        .then((r) => r.rows[0]);
    const policy = (ids: string[] = [], credits = 10000) =>
      saveRunPolicy(workspace, {
        credit_limit: credits,
        token_limit: 100000,
        fallback_model_ids: ids,
      });
    async function withTask(work: (data: any) => Promise<void>) {
      // Each protocol case starts with a healthy fixture provider. Shared cooldown
      // behavior is exercised separately by runtime-improvements.ts.
      await pool.query(
        "DELETE FROM provider_health WHERE model_id=ANY($1::text[])",
        [models],
      );
      const run = (
        await createRun(
          await w(),
          "Local workflow fixture. No external actions.",
          agent,
        )
      ).id;
      const task = (
          await pool.query("SELECT * FROM tasks WHERE run_id=$1", [run])
        ).rows[0],
        lease = randomUUID();
      await pool.query(
        "UPDATE tasks SET status='running',lease_token=$2,lease_until=now()+interval '90 seconds' WHERE id=$1",
        [task.id, lease],
      );
      const ctx = await context(task.id, lease);
      const messages: Message[] = [
        { role: "system", content: ctx.system },
        { role: "user", content: "Fixture goal" },
      ];
      await checkpoint(task.id, lease, messages);
      try {
        await work({ run, task: task.id, lease, ctx, messages });
      } finally {
        await pool.query(
          "UPDATE runs SET status='canceled' WHERE id=$1 AND status NOT IN('completed','failed')",
          [run],
        );
        await pool.query(
          "UPDATE tasks SET status='canceled',lease_token=null WHERE run_id=$1 AND status<>'completed'",
          [run],
        );
      }
    }
    await t.test(
      "Ausweichfreigaben sind mandantenbezogen, begrenzt und im Workspace sichtbar",
      async () => {
        const foreign = await makeModel("foreign", other);
        await assert.rejects(policy([foreign]), (e: any) => e.status === 403);
        await assert.rejects(policy([primary, fallback, primary, fallback]));
        await policy([fallback], 5000);
        const s = await snapshot(
          (
            await pool.query(
              "SELECT id,email,name,role FROM users WHERE id=$1",
              [owner],
            )
          ).rows[0],
          await w(),
        );
        assert.equal(s.workspace.run_credit_limit, 5000);
        assert.equal(s.workspace.fallback_model_ids?.[0].id, fallback);
      },
    );
    await t.test(
      "HTTP 503 wechselt nur zum ausdrücklich erlaubten Modell und berechnet jeden Versuch im gemeinsamen Limit",
      async () => {
        await policy([fallback]);
        status = 503;
        await withTask(async ({ task, lease, ctx, messages, run }) => {
          const before = calls.length;
          await assert.rejects(
            modelStep(task, lease, messages, ctx.tools),
            (e: any) => e.details?.code === "MODEL_FALLBACK",
          );
          messages.push({
            role: "user",
            content: "Continue from journal",
            recovery_code: "MODEL_FALLBACK",
          });
          const answer = await modelStep(task, lease, messages, ctx.tools);
          assert.equal(answer!.content, "Local workflow fixture only");
          assert.deepEqual(calls.slice(before), ["primary", "fallback"]);
          assert.deepEqual(
            await modelStep(task, lease, messages, ctx.tools),
            answer,
          );
          assert.equal(calls.length, before + 2);
          const billed = (
            await pool.query(
              "SELECT sum(charged_credits)::int AS credits FROM model_calls WHERE run_id=$1",
              [run],
            )
          ).rows[0].credits;
          assert.equal(billed, 2000);
          assert.ok(billed <= 10000);
        });
      },
    );
    await t.test(
      "Ohne Freigabe und bei HTTP 401 wird kein Ausweichanbieter aufgerufen",
      async () => {
        for (const [ids, http] of [
          [[], 503],
          [[fallback], 401],
        ] as [string[], number][]) {
          await policy(ids);
          status = http;
          await withTask(async ({ task, lease, ctx, messages }) => {
            const before = calls.length;
            await assert.rejects(
              modelStep(task, lease, messages, ctx.tools),
              (e: any) => e.details?.code !== "MODEL_FALLBACK",
            );
            assert.deepEqual(calls.slice(before), ["primary"]);
            assert.equal(
              (
                await pool.query(
                  "SELECT fallback_index FROM tasks WHERE id=$1",
                  [task],
                )
              ).rows[0].fallback_index,
              0,
            );
          });
        }
        status = 200;
      },
    );
    await t.test(
      "Geänderte Anbieter-Tarife erfordern neue Freigabe, auch nach Auftragsanlage",
      async () => {
        await policy([fallback]);
        await pool.query(
          "UPDATE model_offerings SET base_credits=1001 WHERE id=$1",
          [fallback],
        );
        await assert.rejects(
          createRun(await w(), "Changed fallback tariff fixture", agent),
          /erneut freigeben/,
        );
        await pool.query(
          "UPDATE model_offerings SET base_credits=1000 WHERE id=$1",
          [fallback],
        );
        await withTask(async ({ task, lease, ctx, messages }) => {
          const before = calls.length;
          await pool.query(
            "UPDATE model_offerings SET base_credits=1001 WHERE id=$1",
            [primary],
          );
          await assert.rejects(
            modelStep(task, lease, messages, ctx.tools),
            /seit der Freigabe/,
          );
          assert.equal(calls.length, before);
          await pool.query(
            "UPDATE model_offerings SET base_credits=1000 WHERE id=$1",
            [primary],
          );
        });
      },
    );
    await t.test(
      "Null-Credit-Limit und parallele Teilaufgaben können das feste Gesamtlimit nicht überschreiten",
      async () => {
        await policy([], 0);
        status = 200;
        await withTask(async ({ task, lease, ctx, messages }) => {
          const before = calls.length;
          await assert.rejects(
            modelStep(task, lease, messages, ctx.tools),
            (e: any) => e.details?.code === "INPUT_REQUIRED",
          );
          assert.equal(calls.length, before);
        });
        await policy([], 1000);
        delay = 150;
        await withTask(async ({ run, task, lease, ctx, messages }) => {
          const second = randomUUID(),
            lease2 = randomUUID();
          await pool.query(
            "INSERT INTO tasks(id,run_id,workspace_id,agent_id,title,instructions,status,lease_token,lease_until,model_id) VALUES($1,$2,$3,$4,'Parallel fixture','Fixture','running',$5,now()+interval '90 seconds',$6)",
            [second, run, workspace, agent, lease2, primary],
          );
          const before = calls.length;
          const results = await Promise.allSettled([
            modelStep(task, lease, messages, ctx.tools),
            modelStep(second, lease2, messages, ctx.tools),
          ]);
          assert.equal(
            results.filter((r) => r.status === "fulfilled").length,
            1,
          );
          assert.equal(calls.length, before + 1);
          assert.equal(
            (
              await pool.query(
                "SELECT sum(reserved)::int AS credits FROM model_calls WHERE run_id=$1",
                [run],
              )
            ).rows[0].credits,
            1000,
          );
        });
        delay = 0;
        await policy();
      },
    );
    await t.test(
      "Kleines Fortsetzungsbriefing erhält Originale und spätere Nutzervorgaben; es erweitert keine Werkzeuge",
      async () => {
        await policy();
        status = 200;
        await withTask(async ({ run, task: parent }) => {
          const original = (
            await pool.query("SELECT goal FROM runs WHERE id=$1", [run])
          ).rows[0].goal;
          const old = "Older controller context ".repeat(4000);
          const boundary = (
            await pool.query(
              "INSERT INTO events(workspace_id,run_id,kind,content) VALUES($1,$2,'user_message',$3) RETURNING id",
              [workspace, run, old],
            )
          ).rows[0].id;
          const child = randomUUID(),
            lease = randomUUID();
          const handoff = {
            kind: "operator_repair_brief",
            parent_task_id: parent,
            source_goal_sha256: createHash("sha256")
              .update(original)
              .digest("hex"),
            after_event_id: Number(boundary),
            summary:
              "Continue only the existing local file repair; no network, no publishing, no new rights. The original goal and parent journal remain intact.",
            allowed_tools: ["patch_artifact", "propose_skill", "finish_task"],
          };
          await pool.query(
            "INSERT INTO tasks(id,run_id,workspace_id,agent_id,parent_id,title,instructions,model_id,status,lease_token,lease_until,context_state) VALUES($1,$2,$3,$4,$5,'Brief fixture','Repair the existing local file only',$6,'running',$7,now()+interval '90 seconds',$8)",
            [
              child,
              run,
              workspace,
              agent,
              parent,
              primary,
              lease,
              JSON.stringify({ handoff }),
            ],
          );
          try {
            const future = (
              await pool.query(
                "INSERT INTO events(workspace_id,run_id,kind,content) VALUES($1,$2,'user_message','New instruction after handoff') RETURNING id",
                [workspace, run],
              )
            ).rows[0].id;
            const ctx = await context(child, lease);
            assert.deepEqual(
              new Set(ctx.tools.map((t) => t.function.name)),
              new Set(handoff.allowed_tools),
            );
            assert.ok(ctx.system.includes(handoff.summary));
            const messages: Message[] = [
              { role: "system", content: ctx.system },
              { role: "user", content: "Repair the existing local file only" },
            ];
            await modelStep(child, lease, messages, ctx.tools);
            assert.ok(
              JSON.stringify(lastMessages).includes(
                "New instruction after handoff",
              ),
            );
            assert.ok(!JSON.stringify(lastMessages).includes(old));
            assert.equal(
              (
                await pool.query("SELECT content FROM events WHERE id=$1", [
                  boundary,
                ])
              ).rows[0].content,
              old,
            );
            assert.equal(
              (await pool.query("SELECT goal FROM runs WHERE id=$1", [run]))
                .rows[0].goal,
              original,
            );
            assert.deepEqual(
              (
                await pool.query(
                  "SELECT context_state FROM tasks WHERE id=$1",
                  [child],
                )
              ).rows[0].context_state.handoff,
              handoff,
            );
            const denied = await guardedToolStep(
              child,
              lease,
              randomUUID(),
              "environment_command",
              {},
              messages,
              {},
            );
            assert.equal(denied.isError, true);
            for (const changed of [
              { source_goal_sha256: "0".repeat(64) },
              { after_event_id: Number(future) },
              { parent_task_id: randomUUID() },
              { allowed_tools: ["environment_command"] },
            ]) {
              await pool.query(
                "UPDATE tasks SET context_state=$2 WHERE id=$1",
                [
                  child,
                  JSON.stringify({ handoff: { ...handoff, ...changed } }),
                ],
              );
              await assert.rejects(
                context(child, lease),
                (e: any) => e.status === 409,
              );
            }
          } finally {
            await pool.query("DELETE FROM tasks WHERE id=$1", [child]);
          }
        });
      },
    );
    await t.test(
      "Restbudget kompaktiert alte Dateiauszüge vor dem Anbieteraufruf ohne Grenzerhöhung",
      async () => {
        await policy();
        status = 200;
        await withTask(async ({ run, task, lease, ctx, messages }) => {
          await pool.query("UPDATE runs SET token_limit=30000 WHERE id=$1", [
            run,
          ]);
          for (let i = 0; i < 12; i++)
            messages.push(
              {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: `compact-${i}`,
                    type: "function",
                    function: { name: "read_task_history", arguments: "{}" },
                  },
                ],
              },
              {
                role: "tool",
                tool_call_id: `compact-${i}`,
                content: "fixture data ".repeat(500),
              },
            );
          const before = calls.length;
          await modelStep(task, lease, messages, ctx.tools);
          assert.equal(calls.length, before + 1);
          const state = (
            await pool.query("SELECT context_state FROM tasks WHERE id=$1", [
              task,
            ])
          ).rows[0].context_state;
          assert.ok(state.omitted_groups > 0);
          assert.ok(
            state.estimated_input_upper_bound + state.output_tokens <= 30000,
          );
          assert.equal(
            (
              await pool.query("SELECT token_limit FROM runs WHERE id=$1", [
                run,
              ])
            ).rows[0].token_limit,
            30000,
          );
        });
      },
    );
    await t.test(
      "Gezielte Dateireparatur ist vollständig, versioniert, auftragsgebunden und beim Wiederholen idempotent",
      async () => {
        await withTask(async ({ run, task, lease, messages }) => {
          const early = randomUUID();
          const premature = await guardedToolStep(
            task,
            lease,
            early,
            "finish_task",
            { summary: "Must not skip pending work" },
            [
              ...messages,
              {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: early,
                    type: "function",
                    function: { name: "finish_task", arguments: "{}" },
                  },
                  {
                    id: "still-pending",
                    type: "function",
                    function: { name: "save_artifact", arguments: "{}" },
                  },
                ],
              },
            ],
            {},
          );
          assert.equal(premature.isError, true);
          const rejected = randomUUID(),
            prior = randomUUID();
          const afterFailure = await guardedToolStep(
            task,
            lease,
            rejected,
            "finish_task",
            { summary: "Must not skip pending work" },
            [
              ...messages,
              {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: prior,
                    type: "function",
                    function: { name: "save_artifact", arguments: "{}" },
                  },
                  {
                    id: rejected,
                    type: "function",
                    function: { name: "finish_task", arguments: "{}" },
                  },
                ],
              },
              {
                role: "tool",
                tool_call_id: prior,
                content: JSON.stringify({
                  ok: false,
                  error: "fixture failure",
                }),
              },
            ],
            {},
          );
          assert.equal(afterFailure.isError, true);
          assert.equal(
            (await pool.query("SELECT status FROM tasks WHERE id=$1", [task]))
              .rows[0].status,
            "running",
          );
          const saved = JSON.parse(
            (
              await guardedToolStep(
                task,
                lease,
                randomUUID(),
                "save_artifact",
                {
                  name: "repair.html",
                  content: '<button type="submit">Demo</button>',
                },
                messages,
                {},
              )
            ).result,
          );
          const call = randomUUID(),
            args = {
              artifact_id: saved.artifact_id,
              changes: [{ find: 'type="submit"', replace: 'type="button"' }],
            };
          const result = await guardedToolStep(
            task,
            lease,
            call,
            "patch_artifact",
            args,
            messages,
            {},
          );
          assert.deepEqual(
            await guardedToolStep(
              task,
              lease,
              call,
              "patch_artifact",
              args,
              messages,
              {},
            ),
            result,
          );
          const files = (
            await pool.query(
              "SELECT name,content,retired FROM artifacts WHERE run_id=$1 ORDER BY created_at",
              [run],
            )
          ).rows;
          assert.equal(files.length, 2);
          assert.equal(files.filter((f) => !f.retired).length, 1);
          assert.equal(files.find((f) => !f.retired)!.name, "repair.html");
          assert.ok(files.some((f) => f.content.includes('type="submit"')));
          assert.ok(files.some((f) => f.content.includes('type="button"')));
          const bad = await guardedToolStep(
            task,
            lease,
            randomUUID(),
            "patch_artifact",
            {
              artifact_id: saved.artifact_id,
              changes: [{ find: "missing", replace: "x" }],
            },
            messages,
            {},
          );
          assert.equal(bad.isError, true);
          await withTask(
            async ({
              task: otherTask,
              lease: otherLease,
              messages: otherMessages,
            }) => {
              const denied = await guardedToolStep(
                otherTask,
                otherLease,
                randomUUID(),
                "patch_artifact",
                args,
                otherMessages,
                {},
              );
              assert.equal(denied.isError, true);
            },
          );
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::int n FROM artifacts WHERE run_id=$1",
                [run],
              )
            ).rows[0].n,
            2,
          );
        });
      },
    );
    await t.test(
      "Autonomer Browserabschluss prüft aktuelle Dateiversionen und isoliert fremde Artefakte",
      async () => {
        const oldUrl = process.env.ARTIFACT_VALIDATOR_URL;
        const validator = createServer(async (req, res) => {
          let raw = "";
          for await (const chunk of req) raw += chunk;
          const b = JSON.parse(raw);
          assert.equal(
            req.headers.authorization,
            `Bearer ${process.env.WORKER_TOKEN}`,
          );
          assert.match(b.csp, /connect-src 'none'/);
          assert.ok(b.checks.some((c: any) => c.action.startsWith("assert_")));
          res.writeHead(200, { "content-type": "application/json" }).end(
            JSON.stringify({
              ok: true,
              passed: true,
              engine: "PROTOCOL FIXTURE ONLY",
              results: [{ passed: true }],
            }),
          );
        });
        await new Promise<void>((r) => validator.listen(0, "127.0.0.1", r));
        const addr = validator.address();
        assert.ok(addr && typeof addr !== "string");
        process.env.ARTIFACT_VALIDATOR_URL = `http://127.0.0.1:${addr.port}`;
        try {
          await withTask(async ({ run, task, lease, messages }: any) => {
            const saved = await guardedToolStep(
              task,
              lease,
              randomUUID(),
              "save_artifact",
              { name: "index.html", content: "<h1>Fixture one</h1>" },
              messages,
              {},
            );
            const file = JSON.parse(saved.result).artifact_id;
            const early = await checkpoint(
              task,
              lease,
              messages,
              "This fixture is not validated yet",
            );
            assert.match(early?.needsValidation ?? "", /validate_artifact/);
            assert.equal(
              (await pool.query("SELECT status FROM tasks WHERE id=$1", [task]))
                .rows[0].status,
              "running",
            );
            const denied = await guardedToolStep(
              task,
              lease,
              randomUUID(),
              "validate_artifact",
              {
                artifact_id: randomUUID(),
                checks: [
                  { action: "assert_text", selector: "body", value: "Fixture" },
                ],
              },
              messages,
              {},
            );
            assert.equal(denied.isError, true);
            const verified = await guardedToolStep(
              task,
              lease,
              randomUUID(),
              "validate_artifact",
              {
                artifact_id: file,
                checks: [
                  { action: "assert_text", selector: "body", value: "Fixture" },
                ],
              },
              messages,
              {},
            );
            assert.equal(JSON.parse(verified.result).passed, true);
            const patch = await guardedToolStep(
              task,
              lease,
              randomUUID(),
              "patch_artifact",
              { artifact_id: file, changes: [{ find: "one", replace: "two" }] },
              messages,
              {},
            );
            const changed = JSON.parse(patch.result).artifact_id;
            assert.equal(
              JSON.parse(patch.result).automatic_validation.passed,
              true,
            );
            await guardedToolStep(
              task,
              lease,
              randomUUID(),
              "save_artifact",
              {
                name: "icon.svg",
                content: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
              },
              messages,
              {},
            );

            assert.match(
              (
                await checkpoint(
                  task,
                  lease,
                  messages,
                  "Changed content needs a fresh test",
                )
              )?.needsValidation ?? "",
              /validate_artifact/,
            );
            await guardedToolStep(
              task,
              lease,
              randomUUID(),
              "validate_artifact",
              {
                artifact_id: changed,
                checks: [
                  { action: "assert_text", selector: "body", value: "two" },
                ],
              },
              messages,
              {},
            );
            await checkpoint(
              task,
              lease,
              messages,
              "Current fixture version verified",
            );
            assert.equal(
              (await pool.query("SELECT status FROM runs WHERE id=$1", [run]))
                .rows[0].status,
              "completed",
            );
            assert.equal(
              (
                await pool.query(
                  "SELECT count(*)::int n FROM model_calls WHERE run_id=$1",
                  [run],
                )
              ).rows[0].n,
              0,
            );
          });
        } finally {
          process.env.ARTIFACT_VALIDATOR_URL = oldUrl;
          await new Promise<void>((r) => validator.close(() => r()));
        }
      },
    );
    await t.test(
      "Werkzeugkatalog lädt nur bekannte Namen; der gespeicherte Kontext erhält die Auswahl",
      async () => {
        await withTask(async ({ task, lease, messages }: any) => {
          const loaded = await guardedToolStep(
            task,
            lease,
            randomUUID(),
            "tool_catalog",
            { names: ["read_task_history", "search_memory"] },
            messages,
            {},
          );
          assert.deepEqual(JSON.parse(loaded.result).loaded, [
            "read_task_history",
            "search_memory",
          ]);
          const stored = (
            await pool.query("SELECT context_state FROM tasks WHERE id=$1", [
              task,
            ])
          ).rows[0].context_state;
          assert.deepEqual(stored.loaded_tools, [
            "read_task_history",
            "search_memory",
          ]);
          const bad = await guardedToolStep(
            task,
            lease,
            randomUUID(),
            "tool_catalog",
            { names: ["invented_admin_tool"] },
            messages,
            {},
          );
          assert.equal(bad.isError, true);
        });
      },
    );
    await t.test(
      "Unveränderte sichtbare Dateiausschnitte werden wiederverwendet; verdrängte oder neue Versionen bleiben lesbar",
      async () => {
        const { prepareAgentContext } =
          await import("../../src/core/agent-context.ts");
        await withTask(async ({ task, lease, messages }: any) => {
          const saved = JSON.parse(
            (
              await guardedToolStep(
                task,
                lease,
                randomUUID(),
                "save_artifact",
                { name: "source.txt", content: "First block\nSecond block" },
                messages,
                {},
              )
            ).result,
          );
          const readId = randomUUID(),
            args = { artifact_id: saved.artifact_id, offset: 0, length: 11 };
          const read = await guardedToolStep(
            task,
            lease,
            readId,
            "read_artifact",
            args,
            messages,
            {},
          );
          messages.push(
            {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: readId,
                  type: "function",
                  function: {
                    name: "read_artifact",
                    arguments: JSON.stringify(args),
                  },
                },
              ],
            },
            { role: "tool", tool_call_id: readId, content: read.result },
          );
          const projected = prepareAgentContext(messages, [], {
            automatic: true,
            outputTokens: 2048,
          });
          await pool.query(
            "UPDATE tasks SET context_state=context_state||$2::jsonb WHERE id=$1",
            [task, JSON.stringify(projected.state)],
          );
          const repeat = JSON.parse(
            (
              await guardedToolStep(
                task,
                lease,
                randomUUID(),
                "read_artifact",
                args,
                messages,
                {},
              )
            ).result,
          );
          assert.equal(repeat.already_in_context, true);
          assert.equal(repeat.source_call_id, readId);
          assert.equal(repeat.content, undefined);
          const other = JSON.parse(
            (
              await guardedToolStep(
                task,
                lease,
                randomUUID(),
                "read_artifact",
                { ...args, offset: 12 },
                messages,
                {},
              )
            ).result,
          );
          assert.equal(other.content, "Second bloc");
          await pool.query(
            "UPDATE tasks SET context_state=context_state||'{\"visible_artifact_reads\":[]}'::jsonb WHERE id=$1",
            [task],
          );
          const evicted = JSON.parse(
            (
              await guardedToolStep(
                task,
                lease,
                randomUUID(),
                "read_artifact",
                args,
                messages,
                {},
              )
            ).result,
          );
          assert.equal(evicted.content, "First block");
          const patched = JSON.parse(
            (
              await guardedToolStep(
                task,
                lease,
                randomUUID(),
                "patch_artifact",
                {
                  artifact_id: saved.artifact_id,
                  changes: [{ find: "First", replace: "Fresh" }],
                },
                messages,
                {},
              )
            ).result,
          );
          const fresh = JSON.parse(
            (
              await guardedToolStep(
                task,
                lease,
                randomUUID(),
                "read_artifact",
                { ...args, artifact_id: patched.artifact_id },
                messages,
                {},
              )
            ).result,
          );
          assert.equal(fresh.content, "Fresh block");
        });
      },
    );
    await t.test(
      "Schleifenschutz bleibt über neue Teilaufgaben hinweg im selben Budget wirksam",
      async () => {
        await withTask(async ({ run, task, lease, messages }: any) => {
          const { toolArgumentsHash, toolOutcomeHash } =
            await import("../../src/core/agent-loops.ts");
          const parent = (
            await pool.query("SELECT * FROM tasks WHERE id=$1", [task])
          ).rows[0];
          const child = randomUUID();
          await pool.query(
            "INSERT INTO tasks(id,run_id,workspace_id,agent_id,parent_id,title,instructions) VALUES($1,$2,$3,$4,$5,'Loop fixture','Fixture')",
            [child, run, parent.workspace_id, parent.agent_id, task],
          );
          const args = { artifact_id: randomUUID() };
          for (let i = 0; i < 2; i++)
            await pool.query(
              "INSERT INTO operations(id,task_id,status,result,tool_name,arguments_hash,outcome_hash,failed) VALUES($1,$2,'done','{}','read_artifact',$3,$4,true)",
              [
                randomUUID(),
                child,
                toolArgumentsHash(args),
                toolOutcomeHash(
                  "read_artifact",
                  '{"ok":false,"error":"missing"}',
                ),
              ],
            );
          const blocked = await guardedToolStep(
            task,
            lease,
            randomUUID(),
            "read_artifact",
            args,
            messages,
            {},
          );
          assert.equal(JSON.parse(blocked.result).code, "NO_PROGRESS");
          assert.equal(JSON.parse(blocked.result).executed, false);
        });
      },
    );
    await t.test(
      "Normaler Worker repariert eine Website nach Prüfbeleg und speichert Skill ohne manuelle Fortsetzung",
      async () => {
        await policy([], 10000);
        const special = await makeModel("autonomous-website-fixture");
        const oldAgent = (
          await pool.query("SELECT model_id FROM agents WHERE id=$1", [agent])
        ).rows[0].model_id;
        const oldUrl = process.env.ARTIFACT_VALIDATOR_URL;
        const validator = createServer(async (req, res) => {
          let raw = "";
          for await (const c of req) raw += c;
          const b = JSON.parse(raw);
          const passed = b.html.includes("FIXED");
          res.writeHead(200, { "content-type": "application/json" }).end(
            JSON.stringify({
              ok: true,
              passed,
              engine: "PROTOCOL FIXTURE ONLY",
              results: [
                {
                  passed,
                  error: passed
                    ? undefined
                    : "Expected FIXED instead of BROKEN",
                },
              ],
            }),
          );
        });
        await new Promise<void>((r) => validator.listen(0, "127.0.0.1", r));
        const addr = validator.address();
        assert.ok(addr && typeof addr !== "string");
        process.env.ARTIFACT_VALIDATOR_URL = `http://127.0.0.1:${addr.port}`;
        await pool.query("UPDATE agents SET model_id=$2 WHERE id=$1", [
          agent,
          special,
        ]);
        let child: any;
        try {
          await withTask(async ({ run, task }: any) => {
            await pool.query(
              "UPDATE tasks SET status='queued',lease_token=NULL,worker_id=NULL WHERE id=$1",
              [task],
            );
            child = spawn(
              process.execPath,
              ["--import", "tsx", "src/worker.ts"],
              {
                env: {
                  ...process.env,
                  PLATFORM_URL: platformUrl,
                  WORKER_CONCURRENCY: "1",
                },
                stdio: "pipe",
              },
            );
            let result: any;
            for (let i = 0; i < 200; i++) {
              result = (
                await pool.query("SELECT status,error FROM tasks WHERE id=$1", [
                  task,
                ])
              ).rows[0];
              if (
                ["completed", "failed", "input_required"].includes(
                  result.status,
                )
              )
                break;
              await new Promise((r) => setTimeout(r, 50));
            }
            assert.equal(result.status, "completed", JSON.stringify(result));
            const ops = (
              await pool.query(
                "SELECT tool_name,result FROM operations WHERE task_id=$1 ORDER BY recorded_at",
                [task],
              )
            ).rows;
            assert.ok(ops.some((o: any) => o.tool_name === "patch_artifact"));
            assert.ok(
              ops.some(
                (o: any) =>
                  o.tool_name === "validate_artifact" &&
                  JSON.parse(o.result.result).passed === false,
              ),
            );
            assert.ok(
              ops.some(
                (o: any) =>
                  o.tool_name === "validate_artifact" &&
                  JSON.parse(o.result.result).passed === true,
              ),
            );
            assert.equal(
              (
                await pool.query(
                  "SELECT count(*)::int n FROM events WHERE run_id=$1 AND kind IN('user_message','input_required')",
                  [run],
                )
              ).rows[0].n,
              0,
            );
            assert.equal(
              (
                await pool.query(
                  "SELECT status FROM skills WHERE source_run_id=$1",
                  [run],
                )
              ).rows[0].status,
              "draft",
            );
            assert.ok(
              (
                await pool.query(
                  "SELECT tokens_used<=token_limit AND steps_used<=max_steps AS bounded FROM runs WHERE id=$1",
                  [run],
                )
              ).rows[0].bounded,
            );
          });
        } finally {
          child?.kill("SIGTERM");
          process.env.ARTIFACT_VALIDATOR_URL = oldUrl;
          await pool.query("UPDATE agents SET model_id=$2 WHERE id=$1", [
            agent,
            oldAgent,
          ]);
          await new Promise<void>((r) => validator.close(() => r()));
        }
      },
    );
    await t.test(
      "Einzelaufträge können ihr Limit nur senken; Workspace und Freigaben bleiben erhalten",
      async () => {
        await policy([], 10000);
        const ids: string[] = [];
        try {
          for (const [limits, tokens, credits] of [
            [{ tokenLimit: 28412, creditLimit: 1000 }, 28412, 1000],
            [{ tokenLimit: 1000000, creditLimit: 1000000 }, 100000, 10000],
          ] as const) {
            const r = await createRun(
              await w(),
              "Reduced budget fixture",
              agent,
              [],
              false,
              [agent],
              "",
              limits,
            );
            ids.push(r.id);
            const value = (
              await pool.query(
                "SELECT token_limit,credit_limit,model_policy FROM runs WHERE id=$1",
                [r.id],
              )
            ).rows[0];
            assert.equal(value.token_limit, tokens);
            assert.equal(value.credit_limit, credits);
            assert.deepEqual(value.model_policy.fallbacks, []);
            await pool.query("UPDATE runs SET status='canceled' WHERE id=$1", [
              r.id,
            ]);
            await pool.query(
              "UPDATE tasks SET status='canceled' WHERE run_id=$1",
              [r.id],
            );
          }
          for (const [goal, expected] of [
            ["Erstelle eine eigenständige Website als Dateipaket", true],
            ["Erstelle eine Website mit Datenbank und laufendem Server", false],
          ] as const) {
            const r = await createRun(await w(), goal, agent, [], false, [
              agent,
            ]);
            ids.push(r.id);
            assert.equal(
              (
                await pool.query("SELECT model_policy FROM runs WHERE id=$1", [
                  r.id,
                ])
              ).rows[0].model_policy.delivery_bundle,
              expected,
            );
          }
          assert.equal(
            (
              await pool.query(
                "SELECT run_token_limit FROM workspaces WHERE id=$1",
                [workspace],
              )
            ).rows[0].run_token_limit,
            100000,
          );
        } finally {
          for (const id of ids) {
            await pool.query("UPDATE runs SET status='canceled' WHERE id=$1", [
              id,
            ]);
            await pool.query(
              "UPDATE tasks SET status='canceled' WHERE run_id=$1",
              [id],
            );
          }
        }
      },
    );
    await t.test(
      "Gebündelte Website-Lieferung prüft und schließt ohne weiteren Modellaufruf ab; Fehler bleiben offen",
      async () => {
        const previous = process.env.ARTIFACT_VALIDATOR_URL;
        const validator = createServer(async (req, res) => {
          let raw = "";
          for await (const c of req) raw += c;
          const b = JSON.parse(raw);
          const passed = !b.html.includes("BROKEN");
          res.writeHead(200, { "content-type": "application/json" }).end(
            JSON.stringify({
              ok: true,
              passed,
              engine: "PROTOCOL FIXTURE ONLY",
              results: [{ passed }],
            }),
          );
        });
        await new Promise<void>((r) => validator.listen(0, "127.0.0.1", r));
        const address = validator.address();
        assert.ok(address && typeof address !== "string");
        process.env.ARTIFACT_VALIDATOR_URL = `http://127.0.0.1:${address.port}`;
        try {
          for (const fail of [false, true])
            await withTask(async ({ run, task, lease, messages }: any) => {
              const id = randomUUID(),
                args = {
                  files: [
                    {
                      name: "index",
                      content: `<!doctype html><html><body>${fail ? "BROKEN" : "Bundle"}</body></html>`,
                    },
                    {
                      name: "README.md",
                      content: "Local protocol fixture only",
                    },
                  ],
                  checks: [
                    {
                      action: "assert_text",
                      selector: "body",
                      value: "Bundle",
                    },
                  ],
                  summary:
                    "Complete local fixture package with browser receipt",
                };
              messages.push({
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id,
                    type: "function",
                    function: {
                      name: "deliver_artifacts",
                      arguments: JSON.stringify(args),
                    },
                  },
                ],
              });
              const result = await guardedToolStep(
                task,
                lease,
                id,
                "deliver_artifacts",
                args,
                messages,
                {},
              );
              assert.equal(result.yield, !fail);
              assert.equal(result.isError, fail);
              const state = (
                await pool.query("SELECT status FROM tasks WHERE id=$1", [task])
              ).rows[0].status;
              assert.equal(state, fail ? "running" : "completed");
              assert.ok(
                (
                  await pool.query(
                    "SELECT name FROM artifacts WHERE run_id=$1",
                    [run],
                  )
                ).rows.some((f: any) => f.name === "index.html"),
              );
              assert.equal(
                (
                  await pool.query(
                    "SELECT count(*)::int n FROM model_calls WHERE run_id=$1",
                    [run],
                  )
                ).rows[0].n,
                0,
              );
              if (!fail) {
                const skill = (
                  await pool.query(
                    "SELECT id,status FROM skills WHERE source_run_id=$1",
                    [run],
                  )
                ).rows[0];
                assert.equal(skill.status, "draft");
                const evidence = await skillEvidence(workspace, skill.id);
                assert.ok(evidence.evidence.every((e: any) => e.verified));
              } else {
                // Simulate a process loss after transactional file staging and
                // before the local browser receipt was committed. No paid model.
                const delivered = JSON.parse(result.result);
                const countBefore = (
                  await pool.query(
                    "SELECT count(*)::int n FROM artifacts WHERE run_id=$1",
                    [run],
                  )
                ).rows[0].n;
                await pool.query(
                  "UPDATE operations SET status='reserved',result=$2 WHERE id=$1",
                  [
                    `${task}:${id}`,
                    JSON.stringify({
                      files: delivered.files,
                      html: delivered.files.find((f: any) =>
                        /\.html$/i.test(f.name),
                      ).artifact_id,
                      after_event: 0,
                    }),
                  ],
                );
                await pool.query(
                  "UPDATE operations SET status='reserved',result=NULL WHERE id=$1",
                  [`${task}:${id}-bundle-browser`],
                );
                await pool.query(
                  "UPDATE tasks SET lease_until=now()-interval '1 second' WHERE id=$1",
                  [task],
                );
                await transaction(async (c) =>
                  recoverExpiredTasks(
                    c,
                    (await c.query("SELECT * FROM runs WHERE id=$1", [run]))
                      .rows[0],
                  ),
                );
                const recovered = (
                  await pool.query(
                    "SELECT status,error FROM tasks WHERE id=$1",
                    [task],
                  )
                ).rows[0];
                assert.equal(recovered.status, "queued");
                assert.equal(recovered.error, null);
                await pool.query(
                  "UPDATE tasks SET status='running',lease_token=$2,lease_until=now()+interval '90 seconds' WHERE id=$1",
                  [task, lease],
                );
                const resumed = await guardedToolStep(
                  task,
                  lease,
                  id,
                  "deliver_artifacts",
                  args,
                  messages,
                  {},
                );
                assert.equal(resumed.isError, true);
                assert.equal(resumed.yield, false);
                assert.equal(
                  JSON.parse(resumed.result).validation.code,
                  "LOCAL_VALIDATION_INTERRUPTED",
                );
                assert.equal(
                  (
                    await pool.query(
                      "SELECT count(*)::int n FROM artifacts WHERE run_id=$1",
                      [run],
                    )
                  ).rows[0].n,
                  countBefore,
                  "Recovery must reuse the staged files",
                );
              }
            });
        } finally {
          process.env.ARTIFACT_VALIDATOR_URL = previous;
          await new Promise<void>((r) => validator.close(() => r()));
        }
      },
    );
    await t.test(
      "Erfolgreicher Ablauf erzeugt einen belegten Entwurf; Agenten sehen ihn erst nach versionierter menschlicher Prüfung",
      async () => {
        await withTask(async ({ run, task, lease, ctx, messages }) => {
          await guardedToolStep(
            task,
            lease,
            randomUUID(),
            "save_artifact",
            { name: "verified.txt", content: "Workflow fixture artifact" },
            messages,
            {},
          );
          await guardedToolStep(
            task,
            lease,
            randomUUID(),
            "propose_skill",
            {
              name: "Verified fixture workflow",
              description:
                "Save and inspect a local deliverable with evidence.",
              content:
                "1. Check the provided inputs.\n2. Save a complete deliverable using save_artifact.\n3. Read the saved file and compare it to the requested output.\n4. Stop if the input is missing.",
              verification:
                "Download the artifact and confirm the expected fixture content.",
            },
            messages,
            {},
          );
          const finishCall = randomUUID();
          messages.push({
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: finishCall,
                type: "function",
                function: {
                  name: "finish_task",
                  arguments: JSON.stringify({
                    summary: "Finished fixture with a saved file",
                  }),
                },
              },
            ],
          });
          const finished = await guardedToolStep(
            task,
            lease,
            finishCall,
            "finish_task",
            { summary: "Finished fixture with a saved file" },
            messages,
            {},
          );
          assert.equal(finished.yield, true);
          const s = (
            await pool.query("SELECT * FROM skills WHERE source_run_id=$1", [
              run,
            ])
          ).rows[0];
          assert.equal(s.status, "draft");
          assert.ok(s.evidence.some((e: any) => e.kind === "artifact"));
          assert.ok(s.evidence.some((e: any) => e.kind === "operation"));
          assert.equal(s.name, "Verified fixture workflow");
          assert.match(s.content, /Check the provided inputs/);
          const receipts = await skillEvidence(workspace, s.id);
          assert.ok(receipts.evidence.every((e: any) => e.verified));
          await pool.query("UPDATE agents SET skill_ids=$2 WHERE id=$1", [
            agent,
            JSON.stringify([s.id]),
          ]);
          await withTask(async ({ task, lease, ctx, messages }) => {
            assert.ok(!ctx.system.includes("Verified fixture workflow"));
            const result = await guardedToolStep(
              task,
              lease,
              randomUUID(),
              "read_skill",
              { skill_id: s.id },
              messages,
              {},
            );
            assert.ok(!result.result.includes("Check the provided inputs"));
          });
          await assert.rejects(
            reviewSkill(stranger, other, s.id, {
              version: 1,
              action: "approve",
              note: "Cross-tenant review denied",
            }),
            (e: any) => e.status === 404,
          );
          await reviewSkill(owner, workspace, s.id, {
            version: 1,
            action: "approve",
            note: "Artifact and original tool receipt checked.",
          });
          await withTask(async ({ task, lease, ctx, messages }) => {
            assert.ok(ctx.system.includes("Verified fixture workflow"));
            const result = await guardedToolStep(
              task,
              lease,
              randomUUID(),
              "read_skill",
              { skill_id: s.id },
              messages,
              {},
            );
            assert.ok(result.result.includes("Check the provided inputs"));
          });
          await pool.query("UPDATE agents SET skill_ids='[]' WHERE id=$1", [
            agent,
          ]);
          await assert.rejects(
            reviewSkill(owner, workspace, s.id, {
              version: 1,
              action: "approve",
              note: "Stale review denied",
            }),
            (e: any) => e.status === 409,
          );
          assert.equal((await skillHistory(workspace, s.id)).length, 2);
          assert.equal((await skillHistory(other, s.id)).length, 0);
          const checkpoints: any = await runCheckpoints(owner, workspace, run);
          assert.equal(checkpoints.checkpoints?.length, 1);
        });
      },
    );
    await t.test(
      "Ergebnis-Rollback prüft Mandant, Vorschau und Pause, erhält alte Downloads und erzeugt einen Undo-Punkt",
      async () => {
        await withTask(async ({ run, task, lease, messages }) => {
          await guardedToolStep(
            task,
            lease,
            randomUUID(),
            "save_artifact",
            { name: "v1.txt", content: "original" },
            messages,
            {},
          );
          const s: any = await runCheckpoints(owner, workspace, run, {
            action: "create",
            name: "original",
          });
          await guardedToolStep(
            task,
            lease,
            randomUUID(),
            "save_artifact",
            { name: "v2.txt", content: "new" },
            messages,
            {},
          );
          await assert.rejects(
            runCheckpoints(stranger, other, run, {
              action: "preview",
              id: s.id,
            }),
            (e: any) => e.status === 404,
          );
          const p: any = await runCheckpoints(owner, workspace, run, {
            action: "preview",
            id: s.id,
          });
          await assert.rejects(
            runCheckpoints(owner, workspace, run, {
              action: "restore",
              id: s.id,
              token: p.token,
            }),
            /pausieren/,
          );
          await pool.query("UPDATE runs SET status='paused' WHERE id=$1", [
            run,
          ]);
          await runCheckpoints(owner, workspace, run, {
            action: "restore",
            id: s.id,
            token: p.token,
          });
          const blocked = (
            await pool.query(
              "SELECT status,lease_token,messages FROM tasks WHERE id=$1",
              [task],
            )
          ).rows[0];
          assert.equal(blocked.status, "input_required");
          assert.equal(blocked.lease_token, null);
          assert.equal(
            blocked.messages.at(-1).recovery_code,
            "CHECKPOINT_RESTORE",
          );
          assert.deepEqual(
            (
              await pool.query(
                "SELECT name FROM artifacts WHERE run_id=$1 AND NOT retired",
                [run],
              )
            ).rows.map((r) => r.name),
            ["v1.txt"],
          );
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::int AS n FROM artifacts WHERE run_id=$1 AND retired",
                [run],
              )
            ).rows[0].n,
            2,
          );
          await assert.rejects(
            runCheckpoints(owner, workspace, run, {
              action: "restore",
              id: s.id,
              token: p.token,
            }),
            /geändert|abgelaufen/,
          );
        });
      },
    );
    await t.test(
      "Container-Rollback ist durch Sitzung, Eigentümer, Generation und Workspace-Stopp geschützt",
      async () => {
        const host = randomUUID(),
          env = randomUUID(),
          parent = randomUUID();
        await pool.query(
          "INSERT INTO infrastructure_hosts(id,name,kind,token_hash,last_seen) VALUES($1,'Checkpoint fixture host','docker','fixture',now())",
          [host],
        );
        await pool.query(
          "INSERT INTO customer_environments(id,workspace_id,host_id,template_id,name,status,relay_seen,controller_seen) VALUES($1,$2,$3,'minimal','Checkpoint fixture','running',now(),now())",
          [env, workspace, host],
        );
        await pool.query(
          "INSERT INTO sessions(id,user_id,expires_at,mfa_verified) VALUES($1,$2,now()+interval '1 hour',true)",
          [parent, owner],
        );
        const job = {
          environment_id: env,
          generation: 1,
          requested_by: owner,
          parent_session: parent,
          tool: "environment_checkpoint",
          args: { action: "restore" },
          created_at: new Date().toISOString(),
        };
        try {
          await assert.rejects(authorizeCheckpointJob(pool, job), /stoppen/);
          await pool.query(
            "UPDATE workspaces SET execution_paused=true WHERE id=$1",
            [workspace],
          );
          assert.equal((await authorizeCheckpointJob(pool, job)).id, env);
          for (const changed of [
            { generation: 2 },
            { requested_by: stranger },
            { parent_session: "missing" },
            { tool: "environment_command" },
            { created_at: "2000-01-01" },
          ])
            await assert.rejects(
              authorizeCheckpointJob(pool, { ...job, ...changed }),
            );
        } finally {
          await pool.query("DELETE FROM customer_environments WHERE id=$1", [
            env,
          ]);
          await pool.query("DELETE FROM infrastructure_hosts WHERE id=$1", [
            host,
          ]);
          await pool.query(
            "UPDATE workspaces SET execution_paused=false WHERE id=$1",
            [workspace],
          );
        }
      },
    );
    await t.test(
      "Echter Worker setzt einen Anbieterfehler über ein erlaubtes Ausweichmodell fort",
      async () => {
        await policy([fallback]);
        status = 503;
        await withTask(async ({ task, run }) => {
          await pool.query(
            "UPDATE tasks SET status='queued',lease_token=null,lease_until=null WHERE id=$1",
            [task],
          );
          const id = randomUUID(),
            before = calls.length;
          const child = spawn(
            process.execPath,
            ["--import", "tsx", "src/worker.ts"],
            {
              env: {
                ...process.env,
                PLATFORM_URL: platformUrl,
                WORKER_ID: id,
                WORKER_CONCURRENCY: "1",
              },
              stdio: "ignore",
            },
          );
          try {
            let result: any;
            for (let i = 0; i < 300; i++) {
              result = (
                await pool.query(
                  "SELECT status,error,messages FROM tasks WHERE id=$1",
                  [task],
                )
              ).rows[0];
              if (
                ["completed", "failed", "input_required"].includes(
                  result.status,
                )
              )
                break;
              await new Promise((r) => setTimeout(r, 50));
            }
            assert.equal(result.status, "completed", result.error);
            assert.deepEqual(calls.slice(before), ["primary", "fallback"]);
            assert.equal(
              (
                await pool.query("SELECT steps_used FROM runs WHERE id=$1", [
                  run,
                ])
              ).rows[0].steps_used,
              2,
            );
            assert.equal(
              result.messages.filter(
                (m: any) => m.recovery_code === "MODEL_FALLBACK",
              ).length,
              1,
            );
          } finally {
            child.kill("SIGKILL");
            await new Promise<void>((r) => {
              if (child.exitCode !== null || child.signalCode !== null) r();
              else child.once("exit", () => r());
            });
            await pool.query("DELETE FROM workers WHERE id=$1", [id]);
          }
        });
        status = 200;
      },
    );
  } finally {
    await pool.query("DELETE FROM users WHERE id=ANY($1::text[])", [
      [owner, stranger],
    ]);
    if (models.length)
      await pool.query("DELETE FROM model_offerings WHERE id=ANY($1::text[])", [
        models,
      ]);
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
}
