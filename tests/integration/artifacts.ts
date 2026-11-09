import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { unzipSync, strFromU8 } from "fflate";
export async function resultTests(
  t: any,
  { request, pool, handle, alice, bob, a }: any,
) {
  const original = (
    await pool.query("SELECT default_model_id FROM workspaces WHERE id=$1", [
      a.workspace.id,
    ])
  ).rows[0].default_model_id;
  const state = (await request("state", undefined, alice.cookie)).data;
  const agent = state.agents[0];
  const oldModel = agent.model_id;
  const endpoint = state.models.find(
    (m: any) => m.workspace_id === a.workspace.id,
  )?.endpoint;
  assert.ok(endpoint);
  const raw = async (path: string, cookie = alice.cookie) =>
    handle(
      new NextRequest(`http://localhost:3100/api/${path}`, {
        headers: { cookie },
      }),
      path.split("?")[0],
    );
  async function start(model: string, maxOutputTokens = 12288, timeout = 600) {
    const saved = await request(
      "models",
      {
        name: model,
        provider_name: "Local protocol fixture",
        model,
        endpoint,
        key: "",
        active: true,
        streaming: true,
        max_output_tokens: maxOutputTokens,
        request_timeout_seconds: timeout,
        reasoning_effort: "provider_default",
      },
      alice.cookie,
    );
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    await pool.query("UPDATE agents SET model_id=$2 WHERE id=$1", [
      agent.id,
      saved.data.id,
    ]);
    const run = await request(
      "runs",
      {
        goal: "Render and download a local fixture website",
        agentId: agent.id,
      },
      alice.cookie,
    );
    assert.equal(run.status, 200, JSON.stringify(run.data));
    // These fixtures verify historical artifact/protocol contracts (including 524K
    // explicit output settings). Existing runs retain that policy after upgrade.
    // New autonomous HTML worker acceptance is covered in agent-workflows.ts.
    await pool.query(
      "UPDATE runs SET model_policy=model_policy-'autonomy_version' WHERE id=$1",
      [run.data.id],
    );
    return run.data.id;
  }
  async function finished(id: string) {
    for (let i = 0; i < 500; i++) {
      const run = (await pool.query("SELECT * FROM runs WHERE id=$1", [id]))
        .rows[0];
      if (["completed", "failed"].includes(run.status)) return run;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw Error("Fixture task did not finish");
  }
  try {
    await t.test(
      "Große Dateiversionen überschreiten das Kontextlimit nicht; Dateien und Originalprotokoll bleiben vollständig",
      async () => {
        const id = await start("recover-context");
        assert.equal((await finished(id)).status, "completed");
        const files = (
          await pool.query(
            "SELECT length(content)::int n FROM artifacts WHERE run_id=$1",
            [id],
          )
        ).rows;
        assert.equal(files.length, 3);
        assert.ok(files.every((f: any) => f.n > 90000));
        const task = (
          await pool.query("SELECT messages FROM tasks WHERE run_id=$1", [id])
        ).rows[0];
        const saves = task.messages
          .flatMap((m: any) => m.tool_calls ?? [])
          .filter((c: any) => c.function.name === "save_artifact");
        assert.equal(saves.length, 3);
        assert.ok(
          saves.every(
            (c: any) => JSON.parse(c.function.arguments).content.length > 90000,
          ),
        );
      },
    );
    await t.test(
      "Agent korrigiert ungültige Werkzeugparameter und erstellt echte Ergebnisdatei ohne Container",
      async () => {
        const id = await start("recover-tool");
        assert.equal((await finished(id)).status, "completed");
        const task = (
          await pool.query("SELECT * FROM tasks WHERE run_id=$1", [id])
        ).rows[0];
        assert.equal(
          task.messages.filter((m: any) => m.recovery_code).length,
          1,
        );
        assert.equal(
          (await pool.query("SELECT name FROM artifacts WHERE run_id=$1", [id]))
            .rows[0].name,
          "recovered.html",
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int n FROM environment_tool_calls WHERE task_id=$1",
              [task.id],
            )
          ).rows[0].n,
          0,
        );
      },
    );
    await t.test(
      "Vorübergehender Modellfehler und echtes Zeitlimit werden einmal wiederholt; unbekannte Tokens bleiben null",
      async () => {
        for (const name of ["recover-transient", "recover-timeout"]) {
          const id = await start(name, 12288, 30);
          assert.equal((await finished(id)).status, "completed");
          const calls = (
            await pool.query(
              "SELECT * FROM model_calls WHERE run_id=$1 ORDER BY created_at",
              [id],
            )
          ).rows;
          assert.equal(calls.length, 2);
          assert.equal(calls[0].tokens, 0);
          assert.equal(calls[0].usage_known, false);
          assert.equal(calls[1].tokens, 110);
          assert.equal(calls[1].usage_known, true);
          const listed = (
            await request("state", undefined, alice.cookie)
          ).data.runs.find((r: any) => r.id === id);
          assert.equal(Number(listed.tokens_used), 110);
          assert.equal(listed.usage_uncertain, true);
        }
      },
    );
    await t.test(
      "Fehlerschleifen halten zur Prüfung an und laufen nicht unbegrenzt weiter",
      async () => {
        for (const name of ["recover-busy", "recover-loop"]) {
          const id = await start(name);
          let task: any;
          for (let i = 0; i < 150; i++) {
            task = (
              await pool.query("SELECT * FROM tasks WHERE run_id=$1", [id])
            ).rows[0];
            if (task.status === "input_required") break;
            await new Promise((r) => setTimeout(r, 100));
          }
          assert.equal(task.status, "input_required");
          const corrections = task.messages.filter((m: any) => m.recovery_code);
          if (name === "recover-busy") assert.equal(corrections.length, 1);
          else {
            assert.ok(
              corrections.length > 0 && corrections.length < 6,
              "identical loops stop before the generic six-correction ceiling",
            );
            assert.ok(
              corrections.some((m: any) =>
                m.content?.includes('"code":"NO_PROGRESS"'),
              ),
            );
          }
          const run = (await pool.query("SELECT * FROM runs WHERE id=$1", [id]))
            .rows[0];
          if (name === "recover-busy") assert.equal(run.steps_used, 2);
          else
            assert.ok(
              run.steps_used < 6,
              "loop detection avoids unnecessary model calls",
            );
          if (name === "recover-loop") {
            const model = (
              await pool.query("SELECT * FROM model_offerings WHERE id=$1", [
                task.model_id,
              ])
            ).rows[0];
            const changed = await request(
              "models",
              {
                id: model.id,
                name: model.name,
                provider_name: model.provider_name,
                endpoint: model.endpoint,
                model: model.model, // Keep the approved provider/model; the new human instruction changes the approach.
                active: true,
                streaming: true,
              },
              alice.cookie,
            );
            assert.equal(changed.status, 200, JSON.stringify(changed.data));
            assert.equal(
              (
                await request(
                  `runs/${id}/message`,
                  { message: "Try a different approach." },
                  alice.cookie,
                )
              ).status,
              200,
            );
            assert.equal((await finished(id)).status, "completed");
          } else
            await request(
              `runs/${id}`,
              { action: "cancel" },
              alice.cookie,
              "PATCH",
            );
        }
      },
    );
    await t.test(
      "Unbestätigte externe Operationen werden nicht wiederholt; gestoppte Leases bleiben gesperrt",
      async () => {
        const runId = randomUUID(),
          taskId = randomUUID(),
          lease = randomUUID();
        await pool.query(
          "INSERT INTO runs(id,workspace_id,goal,max_steps) VALUES($1,$2,'Uncertain operation fixture',20)",
          [runId, a.workspace.id],
        );
        await pool.query(
          "INSERT INTO tasks(id,run_id,workspace_id,agent_id,title,instructions,status,lease_token,lease_until) VALUES($1,$2,$3,$4,'Fixture','Fixture','running',$5,now()+interval '90 seconds')",
          [taskId, runId, a.workspace.id, agent.id, lease],
        );
        const callId = randomUUID();
        await pool.query("INSERT INTO operations(id,task_id) VALUES($1,$2)", [
          `${taskId}:${callId}`,
          taskId,
        ]);
        const { guardedToolStep } =
          await import("../../src/server/worker-recovery.ts");
        const connectionId = randomUUID(),
          failedCall = randomUUID();
        const { encrypt } = await import("../../src/server/security.ts");
        await pool.query(
          "INSERT INTO connections(id,workspace_id,name,url,secret,allowed_tools,enabled) VALUES($1,$2,'Broken transport fixture',$3,$4,'[\"fixture_echo\"]',true)",
          [
            connectionId,
            a.workspace.id,
            new URL("/broken-mcp", endpoint).toString(),
            encrypt(""),
          ],
        );
        await pool.query("UPDATE agents SET mcp_ids=$2 WHERE id=$1", [
          agent.id,
          JSON.stringify([...agent.mcp_ids, connectionId]),
        ]);
        try {
          const failed = await guardedToolStep(
            taskId,
            lease,
            failedCall,
            "mcp_broken",
            { text: "fixture" },
            [],
            { mcp_broken: { connectionId, toolName: "fixture_echo" } },
          );
          assert.equal(failed.requiresReview, true);
          assert.match(failed.result, /EXTERNAL_RESULT_UNKNOWN/);
          assert.equal(
            (
              await pool.query("SELECT status FROM operations WHERE id=$1", [
                `${taskId}:${failedCall}`,
              ])
            ).rows[0].status,
            "pending",
          );
        } finally {
          await pool.query("UPDATE agents SET mcp_ids=$2 WHERE id=$1", [
            agent.id,
            JSON.stringify(agent.mcp_ids),
          ]);
          await pool.query("DELETE FROM connections WHERE id=$1", [
            connectionId,
          ]);
        }
        for (let i = 0; i < 2; i++) {
          const result = await guardedToolStep(
            taskId,
            lease,
            callId,
            "save_artifact",
            { name: "never.html", content: "must not execute" },
            [],
            {},
          );
          assert.equal(result.requiresReview, true);
          assert.match(result.result, /EXTERNAL_RESULT_UNKNOWN/);
        }
        assert.equal(
          (
            await pool.query("SELECT status FROM operations WHERE id=$1", [
              `${taskId}:${callId}`,
            ])
          ).rows[0].status,
          "pending",
        );
        assert.equal(
          (await pool.query("SELECT * FROM artifacts WHERE run_id=$1", [runId]))
            .rowCount,
          0,
        );
        await request(
          `runs/${runId}`,
          { action: "cancel" },
          alice.cookie,
          "PATCH",
        );
        await assert.rejects(
          () =>
            guardedToolStep(
              taskId,
              lease,
              randomUUID(),
              "save_artifact",
              { name: "never.html", content: "must not execute" },
              [],
              {},
            ),
          (e: any) => e.status === 409,
        );
      },
    );
    await t.test(
      "Fehlende Usage wird markiert und nicht aus dem Ausgabelimit erfunden",
      async () => {
        const id = await start("recover-no-usage", 524288);
        const run = await finished(id);
        assert.equal(run.status, "completed");
        assert.equal(Number(run.tokens_used), 0);
        assert.equal(
          (
            await pool.query(
              "SELECT usage_known FROM model_calls WHERE run_id=$1",
              [id],
            )
          ).rows[0].usage_known,
          false,
        );
      },
    );
    await t.test(
      "Großes Tokenbudget wird gespeichert, beibehalten und unverändert an das Modell übergeben",
      async () => {
        await request(
          "run-policy",
          { credit_limit: 10000, token_limit: 1000000, fallback_model_ids: [] },
          alice.cookie,
        );
        const id = await start("deliverable-high-budget", 524288);
        assert.equal((await finished(id)).status, "completed");
        const model = (
          await pool.query(
            "SELECT m.* FROM model_offerings m JOIN tasks t ON t.model_id=m.id WHERE t.run_id=$1",
            [id],
          )
        ).rows[0];
        assert.equal(model.max_output_tokens, 524288);
        const payload = {
          id: model.id,
          name: model.name,
          provider_name: model.provider_name,
          endpoint: model.endpoint,
          model: model.model,
          active: true,
          streaming: true,
        };
        assert.equal(
          (await request("models", payload, alice.cookie)).status,
          200,
        );
        assert.equal(
          (
            await pool.query(
              "SELECT max_output_tokens FROM model_offerings WHERE id=$1",
              [model.id],
            )
          ).rows[0].max_output_tokens,
          524288,
          "omitting the setting must not lower an existing budget",
        );
        const listed = (
          await request("state", undefined, alice.cookie)
        ).data.models.find((m: any) => m.id === model.id);
        assert.equal(listed.max_output_tokens, 524288);
        assert.equal(
          (
            await request(
              "models",
              { ...payload, max_output_tokens: 1048577 },
              alice.cookie,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await request(
              "models",
              { ...payload, max_output_tokens: 524288.5 },
              alice.cookie,
            )
          ).status,
          400,
        );
        await assert.rejects(
          () =>
            pool.query(
              "UPDATE model_offerings SET max_output_tokens=1048577 WHERE id=$1",
              [model.id],
            ),
          (e: any) => e.code === "23514",
        );
        assert.equal(
          (
            await pool.query(
              "SELECT max_output_tokens FROM model_offerings WHERE id=$1",
              [model.id],
            )
          ).rows[0].max_output_tokens,
          524288,
        );
      },
    );
    await t.test(
      "Bestandskorrektur erkennt nur den belegten leeren Worker-Platzhalter",
      async () => {
        assert.equal(
          (
            await pool.query(
              "SELECT status FROM runs WHERE id='migration-empty'",
            )
          ).rows[0].status,
          "failed",
        );
        assert.equal(
          (
            await pool.query(
              "SELECT status FROM runs WHERE id='migration-real'",
            )
          ).rows[0].status,
          "completed",
        );
        assert.equal(
          (
            await pool.query(
              "SELECT status FROM tasks WHERE id='migration-empty'",
            )
          ).rows[0].status,
          "failed",
        );
        assert.equal(
          (
            await pool.query(
              "SELECT status FROM tasks WHERE id='migration-real'",
            )
          ).rows[0].status,
          "completed",
        );
      },
    );
    await t.test(
      "Leere JSON-/SSE-Antworten und Tokenabbruch erzeugen Fehler statt erfolgreicher Platzhalter",
      async () => {
        for (const name of [
          "deliverable-empty",
          "deliverable-truncated",
          "deliverable-empty-stream",
        ]) {
          const id = await start(name),
            run = await finished(id);
          assert.equal(run.status, "failed");
          const task = (
            await pool.query("SELECT * FROM tasks WHERE run_id=$1", [id])
          ).rows[0];
          assert.notEqual(task.result, "Keine Antwort.");
          assert.match(task.result, /leere Antwort|Ausgabelimit/);
          assert.equal(
            (await pool.query("SELECT * FROM artifacts WHERE run_id=$1", [id]))
              .rowCount,
            0,
            "truncated tool must not run",
          );
          assert.equal(
            (
              await pool.query(
                "SELECT status FROM model_calls WHERE run_id=$1",
                [id],
              )
            ).rows[0].status,
            "settled",
            "actual usage is settled even when response is unusable",
          );
        }
      },
    );
    await t.test(
      "Ergebnisse: echte Worker-Dateien, ZIP, isolierte HTML-Vorschau und Mandantentrennung",
      async () => {
        const id = await start("deliverable-files");
        assert.equal((await finished(id)).status, "completed");
        const files = (
          await pool.query(
            "SELECT * FROM artifacts WHERE run_id=$1 ORDER BY name",
            [id],
          )
        ).rows;
        assert.deepEqual(
          files.map((f: any) => f.name),
          ["index.html", "script.js", "styles.css"],
        );
        const html = files[0];
        const download = await raw(`artifacts/${html.id}/download`);
        assert.equal(download.status, 200);
        assert.match(
          download.headers.get("content-disposition")!,
          /attachment;.*index.html/,
        );
        assert.equal(await download.text(), html.content);
        const preview = await raw(`artifacts/${html.id}/preview`);
        assert.match(
          preview.headers.get("content-security-policy")!,
          /sandbox allow-scripts/,
        );
        assert.doesNotMatch(
          preview.headers.get("content-security-policy")!,
          /allow-same-origin/,
        );
        assert.match(
          preview.headers.get("content-security-policy")!,
          /connect-src 'none'/,
        );
        const rendered = await preview.text();
        assert.match(rendered, /<style>body\{background:#f9e4ff\}/);
        assert.match(rendered, /document.querySelector/);
        const archive = await raw(`runs/${id}/download`);
        assert.equal(archive.status, 200);
        const zip = unzipSync(new Uint8Array(await archive.arrayBuffer()));
        assert.equal(strFromU8(zip["index.html"]), html.content);
        assert.ok(zip["styles.css"]);
        assert.ok(zip["script.js"]);
        assert.match(
          strFromU8(zip["_kerncloud/auftrag.md"]),
          /fixture website/,
        );
        for (const path of [
          `artifacts/${html.id}/download`,
          `artifacts/${html.id}/preview`,
          `runs/${id}/download`,
        ]) {
          assert.equal((await raw(path, bob.cookie)).status, 404);
          assert.equal((await raw(path, "")).status, 401);
        }
        const foreign = (
          await pool.query(
            "SELECT id FROM workspaces WHERE owner_id<>$1 LIMIT 1",
            [state.user.id],
          )
        ).rows[0].id;
        assert.equal(
          (await raw(`artifacts/${html.id}/download?workspaceId=${foreign}`))
            .status,
          403,
        );
        // Traversal is rejected before a file can be saved, including when a worker requests it.
        const { artifactPath } = await import("../../src/core/artifacts.ts");
        assert.throws(() => artifactPath("../outside.html"));
        // A user-triggered retry carries attachments and starts a distinct, independently billed run.
        const attachmentId = randomUUID();
        await pool.query(
          "INSERT INTO attachments(id,workspace_id,name,mime,source,content,bytes) VALUES($1,$2,'briefing.txt','text/plain','test','briefing',8)",
          [attachmentId, a.workspace.id],
        );
        await pool.query(
          "INSERT INTO run_attachments(run_id,attachment_id) VALUES($1,$2)",
          [id, attachmentId],
        );
        assert.equal(
          (await request(`runs/${id}/retry`, {}, bob.cookie)).status,
          404,
        );
        const retry = await request(`runs/${id}/retry`, {}, alice.cookie);
        assert.equal(retry.status, 200, JSON.stringify(retry.data));
        assert.notEqual(retry.data.id, id);
        assert.equal(
          (
            await pool.query(
              "SELECT attachment_id FROM run_attachments WHERE run_id=$1",
              [retry.data.id],
            )
          ).rows[0].attachment_id,
          attachmentId,
        );
        assert.equal(
          (
            await pool.query("SELECT model_policy FROM runs WHERE id=$1", [
              retry.data.id,
            ])
          ).rows[0].model_policy.autonomy_version,
          1,
          "A new user retry uses the current acceptance policy",
        );
        // This historical provider fixture only emits final text and never invokes
        // validation. The new run must refuse completion instead of bypassing QA.
        let retryTask: any;
        for (let i = 0; i < 150; i++) {
          retryTask = (
            await pool.query("SELECT status,error FROM tasks WHERE run_id=$1", [
              retry.data.id,
            ])
          ).rows[0];
          if (
            ["input_required", "failed", "completed"].includes(retryTask.status)
          )
            break;
          await new Promise((r) => setTimeout(r, 100));
        }
        assert.equal(
          retryTask.status,
          "input_required",
          JSON.stringify(retryTask),
        );
        assert.match(retryTask.error, /geprüft|Reparaturbudget/);
        await request(
          `runs/${retry.data.id}`,
          { action: "cancel" },
          alice.cookie,
          "PATCH",
        );
      },
    );
    await t.test(
      "Gespeicherte Dateien bleiben nach leerer Abschlussantwort verfügbar",
      async () => {
        const id = await start("deliverable-saved");
        assert.equal((await finished(id)).status, "failed");
        const files = (
          await pool.query("SELECT * FROM artifacts WHERE run_id=$1", [id])
        ).rows;
        assert.equal(files.length, 1);
        assert.equal(files[0].name, "saved.html");
        assert.equal(
          (await raw(`artifacts/${files[0].id}/download`)).status,
          200,
        );
      },
    );
  } finally {
    await request(
      "run-policy",
      {
        credit_limit: state.workspace.run_credit_limit,
        token_limit: state.workspace.run_token_limit,
        fallback_model_ids: [],
      },
      alice.cookie,
    );
    await pool.query("UPDATE agents SET model_id=$2 WHERE id=$1", [
      agent.id,
      oldModel,
    ]);
    await pool.query("UPDATE workspaces SET default_model_id=$2 WHERE id=$1", [
      a.workspace.id,
      original,
    ]);
  }
}
