import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { pool, transaction, seedWorkspace } from "../../src/server/db.ts";
import { hashPassword } from "../../src/server/security.ts";
import { saveModel } from "../../src/server/catalog.ts";
import {
  claim,
  lockTask,
  recoverExpiredTasks,
} from "../../src/server/store.ts";
import { context, checkpoint, modelStep } from "../../src/server/engine.ts";
import { guardedToolStep } from "../../src/server/worker-recovery.ts";
import { modelRequestKey } from "../../src/core/agent-context.ts";
import type { Message } from "../../src/core/types.ts";

export async function agentRuntimeTests(t: any, platformUrl: string) {
  assert.ok(new URL(process.env.DATABASE_URL!).pathname.endsWith("_test"));
  let providerCalls = 0,
    delayMs = 0,
    mode = "normal";
  const inputs: any[] = [];
  const server = createServer(async (req, res) => {
    if(req.method === "GET" && req.url?.endsWith("/models")) { res.statusCode=404; res.end(); return; }
    let text = "";
    for await (const chunk of req) text += chunk;
    const body = JSON.parse(text);
    inputs.push(body);
    providerCalls++;
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    let message: any = {
      role: "assistant",
      content: "Local protocol fixture result.",
    };
    if (mode === "loop_repair") {
      const called = (name: string) =>
        body.messages.some((m: any) =>
          m.tool_calls?.some((c: any) => c.function.name === name),
        );
      if (!called("save_artifact")) {
        const repaired = body.messages.some(
          (m: any) =>
            m.role === "tool" && m.content?.includes('"code":"NO_PROGRESS"'),
        );
        message = {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: randomUUID(),
              type: "function",
              function: {
                name: repaired ? "save_artifact" : "search_memory",
                arguments: JSON.stringify(
                  repaired
                    ? {
                        name: "self-repair.txt",
                        content:
                          "Loop detected; solved through another permitted approach.",
                      }
                    : { query: "same fixture search" },
                ),
              },
            },
          ],
        };
      }
    }
    res.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({
        choices: [
          {
            message,
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
  const owner = randomUUID(),
    host = randomUUID(),
    environment = randomUUID();
  let workspace = "",
    model = "";
  await pool.query(
    "INSERT INTO users(id,email,name,password_hash,privacy_version) VALUES($1,$2,'Agent runtime fixture',$3,'fixture')",
    [
      owner,
      `runtime-${owner}@test.local`,
      hashPassword("runtime-fixture-password"),
    ],
  );
  try {
    workspace = await transaction((c) =>
      seedWorkspace(c, owner, "Agent runtime fixtures", true),
    );
    await pool.query(
      "UPDATE accounts SET plan_id='business',credits=100000,subscription_status='local_test' WHERE owner_id=$1",
      [owner],
    );
    model = (
      await saveModel(
        owner,
        {
          name: "Runtime protocol fixture",
          provider_name: "Local fixture",
          endpoint: `http://127.0.0.1:${address.port}/v1`,
          model: "runtime-fixture",
          key: "",
          input_rate: 100,
          output_rate: 200,
          max_output_tokens: 8192,
          streaming: false,
        },
        null,
      )
    ).id;
    await pool.query(
      "UPDATE workspaces SET ai_mode='managed',default_model_id=$2 WHERE id=$1",
      [workspace, model],
    );
    const agent = (
      await pool.query(
        "SELECT id FROM agents WHERE workspace_id=$1 ORDER BY id LIMIT 1",
        [workspace],
      )
    ).rows[0].id;
    await pool.query(
      "INSERT INTO infrastructure_hosts(id,name,kind,token_hash) VALUES($1,'Runtime fixture host','docker','fixture')",
      [host],
    );
    await pool.query(
      "INSERT INTO customer_environments(id,workspace_id,host_id,template_id,name,status) VALUES($1,$2,$3,'minimal','Runtime fixture environment','stopped')",
      [environment, workspace, host],
    );
    const balance = async () =>
      Number(
        (
          await pool.query("SELECT credits FROM accounts WHERE owner_id=$1", [
            owner,
          ])
        ).rows[0].credits,
      );
    async function withTask(work: (x: any) => Promise<void>) {
      const run = randomUUID(),
        task = randomUUID(),
        lease = randomUUID();
      await pool.query(
        "INSERT INTO runs(id,workspace_id,goal,max_steps) VALUES($1,$2,'Local runtime protocol fixture',30)",
        [run, workspace],
      );
      await pool.query(
        "INSERT INTO tasks(id,run_id,workspace_id,agent_id,title,instructions,status,lease_token,lease_until,model_id) VALUES($1,$2,$3,$4,'Runtime fixture','Create a verified local result','running',$5,now()+interval '90 seconds',$6)",
        [task, run, workspace, agent, lease, model],
      );
      const ctx = await context(task, lease);
      const messages: Message[] = [
        { role: "system", content: ctx.system },
        { role: "user", content: "Fixture goal; do not publish anything" },
      ];
      await checkpoint(task, lease, messages);
      try {
        await work({ run, task, lease, ctx, messages });
      } finally {
        await pool.query("UPDATE runs SET status='canceled' WHERE id=$1", [
          run,
        ]);
        await pool.query(
          "UPDATE tasks SET status='canceled',lease_token=NULL WHERE run_id=$1",
          [run],
        );
      }
    }
    const expire = async (task: string) =>
      pool.query(
        "UPDATE tasks SET lease_until=now()-interval '1 second' WHERE id=$1",
        [task],
      );
    const row = async (task: string) =>
      (await pool.query("SELECT * FROM tasks WHERE id=$1", [task])).rows[0];
    async function recover(run: string) {
      await transaction(async (c) => {
        const r = (
          await c.query("SELECT * FROM runs WHERE id=$1 FOR UPDATE", [run])
        ).rows[0];
        await recoverExpiredTasks(c, r);
      });
    }

    await t.test(
      "Verlorene Modellantwort wird nach Worker-Wechsel ohne neuen Anbieteraufruf oder neue Abbuchung wiederverwendet",
      () =>
        withTask(async ({ task, lease, ctx, messages }) => {
          const calls = providerCalls,
            before = await balance();
          const answer = await modelStep(task, lease, messages, ctx.tools);
          const charged = await balance();
          assert.ok(charged < before);
          await expire(task);
          const claimed = await claim(randomUUID());
          assert.equal(claimed?.task.id, task);
          assert.notEqual(claimed!.task.lease_token, lease);
          const changed = [
            {
              ...messages[0],
              content: messages[0].content + "\nRefreshed context",
            },
            messages[1],
          ];
          assert.deepEqual(
            await modelStep(
              task,
              claimed!.task.lease_token,
              changed,
              ctx.tools,
            ),
            answer,
          );
          assert.equal(providerCalls, calls + 1);
          assert.equal(await balance(), charged);
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::int n FROM model_calls WHERE task_id=$1",
                [task],
              )
            ).rows[0].n,
            1,
          );
          assert.equal(
            (
              await pool.query("SELECT steps_used FROM runs WHERE id=$1", [
                claimed!.task.run_id,
              ])
            ).rows[0].steps_used,
            1,
          );
          await assert.rejects(() =>
            transaction((c) => lockTask(c, task, lease)),
          );
        }),
    );
    await t.test(
      "Gleichzeitiger identischer Modellschritt reserviert und verarbeitet nur einmal",
      () =>
        withTask(async ({ task, lease, ctx, messages }) => {
          const calls = providerCalls;
          delayMs = 180;
          try {
            const first = modelStep(task, lease, messages, ctx.tools);
            for (let n = 0; providerCalls === calls && n < 50; n++)
              await new Promise((r) => setTimeout(r, 10));
            await assert.rejects(
              () => modelStep(task, lease, messages, ctx.tools),
              (e: any) => e.details?.code === "MODEL_PENDING",
            );
            await first;
            assert.equal(providerCalls, calls + 1);
          } finally {
            delayMs = 0;
          }
        }),
    );
    await t.test(
      "Bestätigte Dateiaktion wird nach Neustart anhand derselben Werkzeug-ID nicht erneut ausgeführt",
      () =>
        withTask(async ({ run, task, lease, messages }) => {
          const callId = randomUUID(),
            args = { name: "resume.txt", content: "fixture saved once" };
          const saved = await guardedToolStep(
            task,
            lease,
            callId,
            "save_artifact",
            args,
            messages,
            {},
          );
          await expire(task);
          const next = await claim(randomUUID());
          assert.equal(next?.task.id, task);
          assert.deepEqual(
            await guardedToolStep(
              task,
              next!.task.lease_token,
              callId,
              "save_artifact",
              args,
              messages,
              {},
            ),
            saved,
          );
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::int n FROM artifacts WHERE run_id=$1",
                [run],
              )
            ).rows[0].n,
            1,
          );
        }),
    );
    await t.test(
      "Unbestätigte externe Aktion blockiert automatische Wiederaufnahme und bleibt im Journal",
      () =>
        withTask(async ({ run, task }) => {
          const op = `${task}:${randomUUID()}`;
          await pool.query("INSERT INTO operations(id,task_id) VALUES($1,$2)", [
            op,
            task,
          ]);
          await expire(task);
          await recover(run);
          assert.equal((await row(task)).status, "input_required");
          assert.equal(
            (
              await pool.query("SELECT status FROM operations WHERE id=$1", [
                op,
              ])
            ).rows[0].status,
            "pending",
          );
        }),
    );
    await t.test(
      "Unterbrochener Dateilesezugriff ist wiederaufnehmbar, unbestätigter Schreibzugriff benötigt Prüfung",
      async () => {
        for (const tool of ["environment_read_file", "environment_write_file"])
          await withTask(async ({ run, task, lease }) => {
            const op = `${task}:${randomUUID()}`,
              job = randomUUID();
            await pool.query(
              "INSERT INTO operations(id,task_id) VALUES($1,$2)",
              [op, task],
            );
            await pool.query(
              "INSERT INTO environment_tool_calls(id,operation_id,environment_id,generation,task_id,task_lease,permission,tool,args,status) VALUES($1,$2,$3,1,$4,$5,'files',$6,'{}','queued')",
              [job, op, environment, task, lease, tool],
            );
            await expire(task);
            await recover(run);
            assert.equal(
              (await row(task)).status,
              tool === "environment_read_file" ? "queued" : "input_required",
            );
            if (tool === "environment_read_file")
              assert.equal(
                (
                  await pool.query(
                    "SELECT status FROM environment_tool_calls WHERE id=$1",
                    [job],
                  )
                ).rows[0].status,
                "canceled",
              );
          });
      },
    );
    await t.test(
      "Vom Container bestätigtes Ergebnis wird aus dem Job rekonstruiert und die Schreibaktion nicht wiederholt",
      () =>
        withTask(async ({ run, task, lease, messages }) => {
          const callId = randomUUID(),
            op = `${task}:${callId}`;
          await pool.query("INSERT INTO operations(id,task_id) VALUES($1,$2)", [
            op,
            task,
          ]);
          await pool.query(
            "INSERT INTO environment_tool_calls(id,operation_id,environment_id,generation,task_id,task_lease,permission,tool,args,status,result) VALUES($1,$2,$3,1,$4,$5,'files','environment_write_file','{}','done',$6)",
            [
              randomUUID(),
              op,
              environment,
              task,
              lease,
              JSON.stringify({ ok: true, bytes: 12 }),
            ],
          );
          await expire(task);
          await recover(run);
          const next = await claim(randomUUID());
          assert.equal(next?.task.id, task);
          const replay = await guardedToolStep(
            task,
            next!.task.lease_token,
            callId,
            "environment_write_file",
            {},
            messages,
            {},
          );
          assert.equal(JSON.parse(replay.result).bytes, 12);
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::int n FROM environment_tool_calls WHERE operation_id=$1",
                [op],
              )
            ).rows[0].n,
            1,
          );
        }),
    );
    await t.test(
      "Aktiver Modellaufruf wird nicht überlappt; verwaiste Reservierung wird einmal als unklar verbucht",
      () =>
        withTask(async ({ run, task, messages }) => {
          const id = randomUUID(),
            before = await balance();
          await pool.query(
            "UPDATE accounts SET credits=credits-10 WHERE owner_id=$1",
            [owner],
          );
          await pool.query(
            "INSERT INTO model_calls(id,workspace_id,run_id,task_id,reserved,managed,request_key) VALUES($1,$2,$3,$4,10,true,$5)",
            [id, workspace, run, task, modelRequestKey(messages)],
          );
          await expire(task);
          await recover(run);
          assert.equal((await row(task)).status, "running");
          await pool.query(
            "UPDATE model_calls SET heartbeat_at=now()-interval '60 seconds' WHERE id=$1",
            [id],
          );
          await recover(run);
          assert.equal((await row(task)).status, "queued");
          assert.equal(
            (await row(task)).messages.at(-1).recovery_code,
            "MODEL_RESTART",
          );
          await recover(run);
          assert.equal(await balance(), before - 10);
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::int n FROM ledger WHERE id=$1",
                [id],
              )
            ).rows[0].n,
            1,
          );
          assert.equal(
            (
              await pool.query("SELECT status FROM model_calls WHERE id=$1", [
                id,
              ])
            ).rows[0].status,
            "uncertain",
          );
        }),
    );
    await t.test("Automatische Wiederaufnahmen sind persistent begrenzt", () =>
      withTask(async ({ run, task }) => {
        await pool.query("UPDATE tasks SET recovery_attempts=3 WHERE id=$1", [
          task,
        ]);
        await expire(task);
        await recover(run);
        assert.equal((await row(task)).status, "input_required");
        assert.match((await row(task)).error, /Drei/);
      }),
    );
    await t.test(
      "Schleife wird vor erneutem Werkzeugzugriff gestoppt; anderer Ansatz darf weiterarbeiten",
      () =>
        withTask(async ({ task, lease, messages }) => {
          const args = { query: "fixture missing memory" };
          for (let i = 0; i < 3; i++)
            assert.equal(
              (
                await guardedToolStep(
                  task,
                  lease,
                  randomUUID(),
                  "search_memory",
                  args,
                  messages,
                  {},
                )
              ).isError,
              undefined,
            );
          const blocked = await guardedToolStep(
            task,
            lease,
            randomUUID(),
            "search_memory",
            args,
            messages,
            {},
          );
          assert.equal(JSON.parse(blocked.result).code, "NO_PROGRESS");
          assert.equal(blocked.requiresReview, false);
          const other = await guardedToolStep(
            task,
            lease,
            randomUUID(),
            "save_artifact",
            {
              name: "alternative.txt",
              content: "Solved through a different fixture approach",
            },
            messages,
            {},
          );
          assert.ok(JSON.parse(other.result).artifact_id);
          for (let i = 0; i < 2; i++)
            await guardedToolStep(
              task,
              lease,
              randomUUID(),
              "read_memory",
              {},
              messages,
              {},
            );
          const stop = await guardedToolStep(
            task,
            lease,
            randomUUID(),
            "read_memory",
            {},
            messages,
            {},
          );
          assert.equal(stop.requiresReview, true);
        }),
    );
    await t.test(
      "Langer Kontext wird ohne zusätzlichen Modellaufruf gekürzt; Originalstellen bleiben gezielt lesbar",
      () =>
        withTask(async ({ task, lease, ctx, messages }) => {
          const before = providerCalls;
          await pool.query(
            "UPDATE model_offerings SET context_window_tokens=65536 WHERE id=$1",
            [model],
          );
          for (let i = 0; i < 40; i++)
            messages.push(
              {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: `old-${i}`,
                    type: "function",
                    function: {
                      name: "search_memory",
                      arguments: JSON.stringify({ query: `q${i}` }),
                    },
                  },
                ],
              },
              {
                role: "tool",
                tool_call_id: `old-${i}`,
                content: `old output ${i} ` + "x".repeat(5500),
              },
            );
          await checkpoint(task, lease, messages);
          await modelStep(task, lease, messages, ctx.tools);
          const saved = await row(task);
          assert.equal(saved.messages.length, messages.length);
          assert.ok(saved.context_state.omitted_groups > 0);
          assert.equal(providerCalls, before + 1);
          assert.ok(Buffer.byteLength(JSON.stringify(inputs.at(-1))) < 100000);
          const read = await guardedToolStep(
            task,
            lease,
            randomUUID(),
            "read_task_history",
            { message_index: 3, offset: 0, length: 200 },
            messages,
            {},
          );
          assert.match(JSON.parse(read.result).content, /old output 0/);
          assert.equal(
            (
              await guardedToolStep(
                task,
                lease,
                randomUUID(),
                "read_task_history",
                { message_index: 3, task_id: randomUUID() },
                messages,
                {},
              )
            ).isError,
            true,
          );
          await pool.query(
            "UPDATE model_offerings SET context_window_tokens=NULL WHERE id=$1",
            [model],
          );
        }),
    );
    await t.test(
      "Verwaister Modellschritt bei bereits fortgesetzter Aufgabe wird verbucht; Reparatur reserviert kein riesiges Ausgabelimit",
      () =>
        withTask(async ({ run, task, lease, messages, ctx }) => {
          const id = randomUUID(),
            before = providerCalls;
          await pool.query(
            "UPDATE model_offerings SET max_output_tokens=524288 WHERE id=$1",
            [model],
          );
          await pool.query(
            "UPDATE accounts SET credits=credits-10 WHERE owner_id=$1",
            [owner],
          );
          await pool.query(
            "INSERT INTO model_calls(id,workspace_id,run_id,task_id,reserved,managed,request_key,heartbeat_at) VALUES($1,$2,$3,$4,10,true,$5,now()-interval '60 seconds')",
            [id, workspace, run, task, modelRequestKey(messages)],
          );
          try {
            await assert.rejects(
              () => modelStep(task, lease, messages, ctx.tools),
              (e: any) => e.details?.code === "MODEL_INTERRUPTED",
            );
            assert.equal(
              (
                await pool.query("SELECT status FROM model_calls WHERE id=$1", [
                  id,
                ])
              ).rows[0].status,
              "uncertain",
            );
            messages.push({
              role: "user",
              content: "Try a short repair step",
              recovery_code: "MODEL_RESTART",
            });
            await checkpoint(task, lease, messages);
            await modelStep(task, lease, messages, ctx.tools);
            assert.equal(providerCalls, before + 1);
            assert.equal(inputs.at(-1).max_completion_tokens, 16384);
            assert.equal(
              (
                await pool.query(
                  "SELECT max_output_tokens FROM model_offerings WHERE id=$1",
                  [model],
                )
              ).rows[0].max_output_tokens,
              524288,
            );
          } finally {
            await pool.query(
              "UPDATE model_offerings SET max_output_tokens=8192 WHERE id=$1",
              [model],
            );
          }
        }),
    );
    await t.test(
      "Kontextfenster lässt sich begrenzt konfigurieren, bleibt bei ausgelassener Angabe erhalten und kann geleert werden",
      async () => {
        const payload = {
          id: model,
          name: "Runtime protocol fixture",
          provider_name: "Local fixture",
          endpoint: `http://127.0.0.1:${address.port}/v1`,
          model: "runtime-fixture",
          input_rate: 100,
          output_rate: 200,
          max_output_tokens: 8192,
          streaming: false,
        };
        for (const value of [0, 8388609, 32768.5])
          await assert.rejects(() =>
            saveModel(
              owner,
              { ...payload, context_window_tokens: value },
              null,
            ),
          );
        await saveModel(
          owner,
          { ...payload, context_window_tokens: 65536 },
          null,
        );
        await saveModel(owner, payload, null);
        assert.equal(
          (
            await pool.query(
              "SELECT context_window_tokens FROM model_offerings WHERE id=$1",
              [model],
            )
          ).rows[0].context_window_tokens,
          65536,
        );
        await saveModel(
          owner,
          { ...payload, context_window_tokens: null },
          null,
        );
        assert.equal(
          (
            await pool.query(
              "SELECT context_window_tokens FROM model_offerings WHERE id=$1",
              [model],
            )
          ).rows[0].context_window_tokens,
          null,
        );
      },
    );
    await t.test(
      "Echter Worker löst eine erkannte Schleife selbst und liefert eine Datei innerhalb des Auftragsbudgets",
      () =>
        withTask(async ({ run, task }) => {
          const workerId = randomUUID(),
            before = providerCalls;
          await pool.query(
            "UPDATE tasks SET status='queued',lease_token=NULL,lease_until=NULL,worker_id=NULL WHERE id=$1",
            [task],
          );
          mode = "loop_repair";
          const child = spawn(
            process.execPath,
            ["--import", "tsx", "src/worker.ts"],
            {
              env: {
                ...process.env,
                PLATFORM_URL: platformUrl,
                WORKER_ID: workerId,
                WORKER_CONCURRENCY: "1",
              },
              stdio: "ignore",
            },
          );
          try {
            for (let i = 0; i < 200; i++) {
              const state = await row(task);
              if (
                ["completed", "failed", "input_required"].includes(state.status)
              )
                break;
              await new Promise((r) => setTimeout(r, 50));
            }
            const completed = await row(task);
            assert.equal(completed.status, "completed", completed.error);
            assert.equal(completed.loop_interventions, 1);
            assert.equal(
              (
                await pool.query("SELECT name FROM artifacts WHERE run_id=$1", [
                  run,
                ])
              ).rows[0].name,
              "self-repair.txt",
            );
            assert.equal(providerCalls, before + 6);
            assert.equal(
              completed.messages.filter((m: any) => m.recovery_code).length,
              1,
            );
          } finally {
            child.kill("SIGKILL");
            await new Promise<void>((r) => {
              if (child.exitCode !== null || child.signalCode !== null) r();
              else child.once("exit", () => r());
            });
            mode = "normal";
            await pool.query("DELETE FROM workers WHERE id=$1", [workerId]);
          }
        }),
    );
  } finally {
    await pool.query("DELETE FROM customer_environments WHERE id=$1", [
      environment,
    ]);
    await pool.query("DELETE FROM infrastructure_hosts WHERE id=$1", [host]);
    await pool.query("DELETE FROM users WHERE id=$1", [owner]);
    if (model)
      await pool.query("DELETE FROM model_offerings WHERE id=$1", [model]);
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
}
