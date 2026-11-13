import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  studioAction,
  dispatchContent,
  researchSearch,
  researchJob,
} from "../../src/server/content-research.ts";
export async function studioResearchTests(
  t: any,
  { request, pool, owner, member, ws, agent, foreignWorkspace }: any,
) {
  const project = (
    await pool.query(
      "SELECT id FROM workspace_projects WHERE workspace_id=$1 ORDER BY created_at LIMIT 1",
      [ws],
    )
  ).rows[0].id;
  const token = async (service: string) => {
    const r = await request(
      "suite/apps/token",
      {
        service_id: service,
        name: service + " studio fixture",
        token: "studio-protocol-fixture-secret",
        project_ids: [project],
      },
      owner.cookie,
    );
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data.id;
  };
  const social = await token("ayrshare"),
    search = await token("tavily");
  await request(
    "suite/apps",
    {
      id: social,
      action: "configure",
      agent_ids: [agent],
      project_ids: [project],
      write_enabled: true,
    },
    owner.cookie,
  );
  await request(
    "suite/apps",
    {
      id: search,
      action: "configure",
      agent_ids: [agent],
      project_ids: [project],
      write_enabled: false,
    },
    owner.cookie,
  );
  const ownerId = (
    await pool.query("SELECT owner_id FROM workspaces WHERE id=$1", [ws])
  ).rows[0].owner_id;
  const act = (body: any) => studioAction(ownerId, ws, project, body);
  const price = async (id: string, value = "0.010000") =>
    act({
      action: "price",
      connection_id: id,
      price: value,
      valid_until: new Date(Date.now() + 86400000).toISOString(),
      confirm: true,
    });
  const original = globalThis.fetch;
  let calls = 0;
  try {
    await t.test(
      "new project budgets and unknown prices prevent provider calls, including health-check bypass",
      async () => {
        globalThis.fetch = async () => {
          calls++;
          throw Error("Unexpected provider call");
        };
        const j: any = await act({
          action: "create_research",
          title: "Ceiling fixture",
          connection_id: search,
          cost_limit: "0.100000",
          request_limit: 5,
        });
        await assert.rejects(() =>
          researchSearch(ws, project, j.id, "unknown price fixture"),
        );
        assert.equal(calls, 0);
        await price(search);
        await assert.rejects(() =>
          researchSearch(ws, project, j.id, "zero budget fixture"),
        );
        assert.equal(calls, 0);
        assert.equal(
          (await request("suite/apps/check", { id: search }, owner.cookie))
            .status,
          409,
        );
        assert.equal(calls, 0);
        assert.equal(
          (
            await request(
              "studio/action",
              { action: "budget", cost_limit: "1", request_limit: 10 },
              member.cookie + "; kc_workspace=" + ws,
            )
          ).status,
          403,
        );
      },
    );
    await t.test(
      "concurrent distinct searches cannot exceed a one-request project budget; repeated/cross-notebook queries reuse receipts",
      async () => {
        await act({
          action: "budget",
          cost_limit: "0.010000",
          request_limit: 1,
        });
        const j: any = await act({
          action: "create_research",
          title: "Atomic fixture",
          connection_id: search,
          cost_limit: "0.100000",
          request_limit: 5,
        });
        globalThis.fetch = async (url: any, init: any) => {
          calls++;
          assert.equal(String(url), "https://api.tavily.com/search");
          assert.equal(JSON.parse(init.body).search_depth, "basic");
          return new Response(
            JSON.stringify({
              results: [
                {
                  title: "Protocol source",
                  url: "https://source.example.invalid/a",
                  content: "Fixture evidence",
                },
              ],
            }),
          );
        };
        const results = await Promise.allSettled([
          researchSearch(ws, project, j.id, "atomic fixture A"),
          researchSearch(ws, project, j.id, "atomic fixture B"),
        ]);
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
        assert.equal(calls, 1);
        const done = (
          await pool.query(
            "SELECT query FROM research_queries WHERE job_id=$1 AND status='done'",
            [j.id],
          )
        ).rows[0];
        const repeated = await researchSearch(ws, project, j.id, done.query);
        assert.equal(repeated.cached, true);
        assert.equal(calls, 1);
        const other: any = await act({
          action: "create_research",
          title: "Cache reuse fixture",
          connection_id: search,
          cost_limit: "0",
          request_limit: 1,
        });
        const cached = await researchSearch(ws, project, other.id, done.query);
        assert.equal(cached.cached, true);
        assert.equal(calls, 1);
        assert.equal(
          (await researchJob(ws, project, other.id)).queries.length,
          1,
        );
        await assert.rejects(() =>
          researchJob(foreignWorkspace, project, j.id),
        );
        const state = (
          await pool.query(
            "SELECT * FROM project_external_budgets WHERE project_id=$1",
            [project],
          )
        ).rows[0];
        assert.equal(Number(state.cost_used), 10000);
        assert.equal(state.requests_used, 1);
        await act({
          action: "report",
          job_id: j.id,
          expected_revision: 1,
          report: "First report",
        });
        await act({
          action: "report",
          job_id: j.id,
          expected_revision: 2,
          report: "Second report",
        });
        await act({
          action: "restore_report",
          job_id: j.id,
          expected_revision: 3,
          revision: 2,
        });
        assert.equal(
          (await researchJob(ws, project, j.id)).job.report,
          "First report",
        );
      },
    );
    await t.test(
      "publication approval binds previewed price, connection, content and budget and dispatches exactly once",
      async () => {
        await act({ action: "budget", cost_limit: "1", request_limit: 20 });
        await price(social);
        const saved: any = await act({
          action: "save_post",
          post: {
            title: "Post fixture",
            text: "Protocol fixture only",
            platforms: ["bluesky"],
            connection_id: social,
          },
        });
        await act({ action: "review", id: saved.id, expected_revision: 1 });
        const co = (
            await pool.query(
              "SELECT revision FROM work_app_connections WHERE id=$1",
              [social],
            )
          ).rows[0],
          p = (
            await pool.query(
              "SELECT * FROM project_provider_prices WHERE project_id=$1 AND connection_id=$2",
              [project, social],
            )
          ).rows[0],
          b = (
            await pool.query(
              "SELECT revision FROM project_external_budgets WHERE project_id=$1",
              [project],
            )
          ).rows[0];
        const approve = {
          action: "approve",
          id: saved.id,
          expected_revision: 1,
          confirm: true,
          expected_connection_revision: co.revision,
          expected_price_revision: p.revision,
          expected_budget_revision: b.revision,
          expected_price: String(p.price_micro_usd),
        };
        await assert.rejects(() => act({ ...approve, expected_price: "999" }));
        const before = calls;
        globalThis.fetch = async (url: any, init: any) => {
          calls++;
          assert.equal(String(url), "https://api.ayrshare.com/api/post");
          assert.equal(JSON.parse(init.body).post, "Protocol fixture only");
          return new Response(
            JSON.stringify({ status: "success", id: "fixture-post-id" }),
          );
        };
        await dispatchContent();
        assert.equal(calls, before);
        await act(approve);
        await Promise.all([dispatchContent(), dispatchContent()]);
        assert.equal(calls, before + 1);
        assert.equal(
          (
            await pool.query("SELECT status FROM content_posts WHERE id=$1", [
              saved.id,
            ])
          ).rows[0].status,
          "submitted",
        );
        await dispatchContent();
        assert.equal(calls, before + 1);
        await assert.rejects(() => act({ ...approve, action: "review" }));
      },
    );
    await t.test(
      "edited or rotated approvals never publish, and uncertain writes never auto-repeat",
      async () => {
        const make = async (text: string) => {
          const s: any = await act({
            action: "save_post",
            post: {
              title: text,
              text,
              platforms: ["bluesky"],
              connection_id: social,
            },
          });
          await act({ action: "review", id: s.id, expected_revision: 1 });
          const co = (
              await pool.query(
                "SELECT revision FROM work_app_connections WHERE id=$1",
                [social],
              )
            ).rows[0],
            p = (
              await pool.query(
                "SELECT * FROM project_provider_prices WHERE project_id=$1 AND connection_id=$2",
                [project, social],
              )
            ).rows[0],
            b = (
              await pool.query(
                "SELECT revision FROM project_external_budgets WHERE project_id=$1",
                [project],
              )
            ).rows[0];
          await act({
            action: "approve",
            id: s.id,
            expected_revision: 1,
            confirm: true,
            expected_connection_revision: co.revision,
            expected_price_revision: p.revision,
            expected_budget_revision: b.revision,
            expected_price: String(p.price_micro_usd),
          });
          return s;
        };
        const edited = await make("Edit fixture");
        await act({
          action: "save_post",
          post: {
            id: edited.id,
            expected_revision: 1,
            title: "Changed fixture",
            text: "Changed fixture",
            platforms: ["bluesky"],
            connection_id: social,
          },
        });
        const before = calls;
        await dispatchContent();
        assert.equal(calls, before);
        const rotated = await make("Rotate fixture");
        await pool.query(
          "UPDATE work_app_connections SET revision=revision+1 WHERE id=$1",
          [social],
        );
        await dispatchContent();
        assert.equal(calls, before);
        assert.equal(
          (
            await pool.query("SELECT status FROM content_posts WHERE id=$1", [
              rotated.id,
            ])
          ).rows[0].status,
          "blocked",
        );
        const uncertain = await make("Uncertain fixture");
        globalThis.fetch = async () => {
          calls++;
          throw Error("Protocol fixture timeout");
        };
        await dispatchContent();
        assert.equal(calls, before + 1);
        await dispatchContent();
        assert.equal(calls, before + 1);
        assert.equal(
          (
            await pool.query("SELECT status FROM content_posts WHERE id=$1", [
              uncertain.id,
            ])
          ).rows[0].status,
          "uncertain",
        );
      },
    );
  } finally {
    globalThis.fetch = original;
    await pool.query("DELETE FROM content_posts WHERE workspace_id=$1", [ws]);
    await pool.query("DELETE FROM research_jobs WHERE workspace_id=$1", [ws]);
    await pool.query(
      "DELETE FROM project_external_budgets WHERE project_id=$1",
      [project],
    );
    await pool.query(
      "DELETE FROM work_app_connections WHERE id=ANY($1::text[])",
      [[social, search]],
    );
  }
}
