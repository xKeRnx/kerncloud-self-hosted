import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { transaction } from "../../src/server/db.ts";
import {
  writeMemory,
  listMemory,
  type MemoryInput,
} from "../../src/server/memory.ts";
export async function memoryTests(
  t: TestContext,
  { request, pool, alice, bob, admin, a, b, fixtureUrl }: Record<string, any>,
) {
  await t.test(
    "Projektgedächtnis: Schutz, konkurrierende Übernahme, Belege und Mandantentrennung",
    async () => {
      const fact: MemoryInput = {
        key: "existing.login",
        title: "Anmeldung bereits vorhanden",
        content:
          "Die Anmeldung ist bereits implementiert. Vor Änderungen den aktuellen Quellstand prüfen.",
        kind: "knowledge",
        status: "done",
        evidence: "fixture: Implementierte Anmeldung im Testprojekt.",
        expected_revision: null,
        pinned: true,
        verified: true,
      };
      const saved = await request("memory", fact, alice.cookie);
      assert.equal(saved.status, 200, JSON.stringify(saved.data));
      assert.equal(saved.data.pinned, true);
      const nova = a.agents.find((x: any) => x.name === "Nova"),
        echo = a.agents.find((x: any) => x.name === "Echo");
      await assert.rejects(
        () =>
          transaction((c) =>
            writeMemory(
              c,
              a.workspace.id,
              { ...fact, expected_revision: 1, content: "Überschreibversuch" },
              nova.id,
            ),
          ),
        /geschützt/,
      );
      const work: MemoryInput = {
        ...fact,
        key: "review.todo",
        title: "Anmeldung prüfen",
        content: "Die vorhandene Anmeldung gegen Anforderungen prüfen.",
        kind: "work",
        status: "open",
        expected_revision: null,
        pinned: false,
        verified: false,
      };
      assert.equal((await request("memory", work, alice.cookie)).status, 200);
      const results = await Promise.allSettled(
        [nova, echo].map((agent) =>
          transaction((c) =>
            writeMemory(
              c,
              a.workspace.id,
              { ...work, status: "in_progress", expected_revision: 1 },
              agent.id,
            ),
          ),
        ),
      );
      assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
      assert.equal(results.filter((x) => x.status === "rejected").length, 1);
      const current = (
        await pool.query(
          "SELECT * FROM memories WHERE workspace_id=$1 AND key='review.todo'",
          [a.workspace.id],
        )
      ).rows[0];
      const loser = current.assignee === nova.id ? echo.id : nova.id;
      await assert.rejects(
        () =>
          transaction((c) =>
            writeMemory(
              c,
              a.workspace.id,
              { ...work, status: "in_progress", expected_revision: 2 },
              loser,
            ),
          ),
        /bereits/,
      );
      await assert.rejects(
        () =>
          transaction((c) =>
            writeMemory(
              c,
              a.workspace.id,
              { ...work, status: "done", evidence: "", expected_revision: 2 },
              current.assignee,
            ),
          ),
        /Beleg/,
      );
      const finished = await transaction((c) =>
        writeMemory(
          c,
          a.workspace.id,
          {
            ...work,
            status: "done",
            evidence: "fixture: Testprotokoll für die geprüfte Funktion.",
            expected_revision: 2,
            verified: true,
            pinned: true,
          },
          current.assignee,
        ),
      );
      assert.equal(finished.verified, false);
      assert.equal(finished.pinned, false);
      assert.equal(finished.revision, 3);
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS count FROM memory_revisions WHERE memory_id=$1",
            [finished.id],
          )
        ).rows[0].count,
        2,
      );
      assert.ok(
        !(
          await transaction((c) =>
            listMemory(c, b.workspace.id, "Anmeldung", true),
          )
        ).some((m: any) => m.key === "existing.login"),
      );
      const exported = await request("privacy/export", undefined, alice.cookie);
      assert.ok(
        exported.data.workspaces
          .find((w: any) => w.workspace.id === a.workspace.id)
          .memory.some((m: any) => m.key === "existing.login"),
      );
    },
  );
  await t.test(
    "Neue Agenten-Aufträge lesen vorhandenes Wissen und erzeugen keinen doppelten Arbeitseintrag",
    async () => {
      const state = (await request("state", undefined, alice.cookie)).data;
      const model = await request(
        "models",
        {
          name: "Memory fixture",
          provider_name: "Fixture",
          endpoint: `${fixtureUrl}/v1`,
          model: "memory-fixture",
          key: "memory-fixture-only",
        },
        alice.cookie,
      );
      assert.equal(model.status, 200);
      const agents = state.agents.filter((a: any) =>
        ["Nova", "Echo"].includes(a.name),
      );
      const artifactsBefore = Number(
        (
          await pool.query(
            "SELECT count(*) FROM artifacts WHERE workspace_id=$1",
            [a.workspace.id],
          )
        ).rows[0].count,
      );
      for (const agent of agents) {
        assert.equal(
          (
            await request(
              "agents",
              { ...agent, model_id: model.data.id },
              alice.cookie,
            )
          ).status,
          200,
        );
        const run = await request(
          "runs",
          {
            goal: "Prüfe die vorhandene Anmeldung anhand des Projektgedächtnisses.",
            agentId: agent.id,
          },
          alice.cookie,
        );
        assert.equal(run.status, 200, JSON.stringify(run.data));
        for (let i = 0; i < 100; i++) {
          await new Promise((r) => setTimeout(r, 100));
          if (
            (
              await pool.query("SELECT status FROM runs WHERE id=$1", [
                run.data.id,
              ])
            ).rows[0].status === "completed"
          )
            break;
        }
        assert.equal(
          (
            await pool.query("SELECT status FROM runs WHERE id=$1", [
              run.data.id,
            ])
          ).rows[0].status,
          "completed",
        );
        const saved = (
          await pool.query(
            "SELECT * FROM memories WHERE workspace_id=$1 AND key=$2",
            [a.workspace.id, `run-${run.data.id}`],
          )
        ).rows[0];
        assert.equal(saved.automatic, true);
        assert.equal(saved.verified, false);
      }
      const notes = (
        await pool.query(
          "SELECT * FROM memories WHERE workspace_id=$1 AND key='review.completed'",
          [a.workspace.id],
        )
      ).rows;
      assert.equal(notes.length, 1);
      assert.equal(notes[0].revision, 1);
      assert.equal(
        Number(
          (
            await pool.query(
              "SELECT count(*) FROM artifacts WHERE workspace_id=$1",
              [a.workspace.id],
            )
          ).rows[0].count,
        ),
        artifactsBefore,
      );
    },
  );
}
