import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  socialAction,
  socialSnapshot,
  socialReviews,
  dispatchSocialReply,
  syncSocial,
} from "../../src/server/social.ts";
import { studioAction } from "../../src/server/content-research.ts";
export async function socialTests(
  t: any,
  { request, pool, owner, member, ws, agent, foreignWorkspace }: any,
) {
  const project = (
      await pool.query(
        "SELECT id FROM workspace_projects WHERE workspace_id=$1 ORDER BY created_at LIMIT 1",
        [ws],
      )
    ).rows[0].id,
    actor = (
      await pool.query("SELECT owner_id FROM workspaces WHERE id=$1", [ws])
    ).rows[0].owner_id;
  const token = await request(
    "suite/apps/token",
    {
      service_id: "ayrshare",
      name: "Social protocol fixture",
      token: "social-protocol-fixture-secret",
      project_ids: [project],
    },
    owner.cookie,
  );
  assert.equal(token.status, 200, JSON.stringify(token.data));
  const co = token.data.id;
  await request(
    "suite/apps",
    {
      id: co,
      action: "configure",
      project_ids: [project],
      agent_ids: [agent],
      write_enabled: true,
    },
    owner.cookie,
  );
  const act = (b: any): Promise<any> => socialAction(actor, ws, project, b),
    budget = (cost: string, requests: number) =>
      studioAction(actor, ws, project, {
        action: "budget",
        cost_limit: cost,
        request_limit: requests,
      });
  const price = (operation: string, value = "0.010000") =>
    act({
      action: "price",
      connection_id: co,
      operation,
      price: value,
      valid_until: new Date(Date.now() + 86400000).toISOString(),
      confirm: true,
    });
  const source = async (
    kind = "messages",
    platform = "facebook",
    target?: string,
  ) =>
    (await act({
      action: "source",
      source: {
        connection_id: co,
        kind,
        platform,
        label: "Social " + kind + " fixture",
        ...(target ? { target } : {}),
      },
    })) as any;
  const sync = (id: string, extra = {}) =>
    act({ action: "sync", id, request_id: randomUUID(), ...extra });
  const oldFetch = globalThis.fetch;
  let calls = 0;
  let first: any;
  const message = (text = "Inbound fixture", id = "m1") => ({
    id,
    senderId: "customer-1",
    recipientId: "our-page",
    conversationId: "conversation-1",
    senderDetails: { name: "Fixture customer" },
    action: "received",
    created: id === "m1" ? "2026-11-12T10:00:00Z" : "2026-11-12T11:00:00Z",
    message: text,
  });
  const getItem = async (id: string) =>
    (await socialSnapshot(actor, ws, project)).items.find(
      (i: any) => i.source_id === id,
    );
  const makeReply = async (item: any, text: string) =>
    (await act({
      action: "reply",
      item_id: item.id,
      expected_item_revision: item.revision,
      text,
    })) as any;
  const approve = async (id: string) => {
    const r = (await socialReviews(actor, ws)).replies.find(
      (r: any) => r.id === id,
    );
    assert.ok(r);
    return {
      action: "approve",
      id: r.id,
      expected_revision: r.revision,
      confirm: true,
      expected_item_revision: r.item_revision,
      expected_connection_revision: r.connection_revision,
      expected_price_revision: r.price_revision,
      expected_budget_revision: r.budget_revision,
      expected_price: String(r.price_micro_usd),
    };
  };
  try {
    await t.test(
      "Social calls require separate prices and shared fixed budgets; viewers cannot write or approve",
      async () => {
        first = await source();
        globalThis.fetch = async () => {
          calls++;
          throw Error("No provider request expected");
        };
        await assert.rejects(() => sync(first.id));
        assert.equal(calls, 0);
        await price("read");
        await assert.rejects(() => sync(first.id));
        assert.equal(calls, 0);
        assert.equal(
          (
            await request(
              "social/action",
              { action: "archive", id: randomUUID(), archived: true },
              member.cookie + "; kc_workspace=" + ws,
            )
          ).status,
          403,
        );
        await assert.rejects(() =>
          socialSnapshot(actor, foreignWorkspace, project),
        );
      },
    );
    await t.test(
      "Concurrent sources cannot exceed one shared request; fresh cache and repeated request IDs do not call again",
      async () => {
        await budget("0.010000", 1);
        const second = await source("messages", "instagram");
        globalThis.fetch = async (url: any) => {
          calls++;
          assert.match(
            String(url),
            /^https:\/\/api\.ayrshare\.com\/api\/messages\/(facebook|instagram)\?/,
          );
          assert.equal(new URL(String(url)).searchParams.get("limit"), "20");
          return new Response(
            JSON.stringify({ status: "success", messages: [message()] }),
          );
        };
        const r = await Promise.allSettled([sync(first.id), sync(second.id)]);
        assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
        assert.equal(calls, 1);
        const done = (
          await pool.query(
            "SELECT source_id,id FROM social_fetches WHERE status='done' AND source_id=ANY($1::text[])",
            [[first.id, second.id]],
          )
        ).rows[0];
        first = { id: done.source_id };
        assert.equal((await sync(first.id)).cached, true);
        assert.equal(calls, 1);
        assert.equal(
          (
            await syncSocial(ws, project, {
              id: first.id,
              request_id: done.id,
              next: false,
              retry_uncertain: false,
            })
          ).cached,
          true,
        );
        assert.equal(calls, 1);
      },
    );
    await t.test(
      "Exact target and price approval fences replies; concurrent senders dispatch only once",
      async () => {
        await budget("1", 20);
        const item = await getItem(first.id),
          r = await makeReply(item, "Reviewed fixture reply");
        await dispatchSocialReply();
        assert.equal(calls, 1);
        await assert.rejects(() =>
          act({
            action: "approve",
            id: r.id,
            expected_revision: r.revision,
            confirm: true,
          }),
        );
        await price("reply");
        const b = await approve(r.id);
        await assert.rejects(() => act({ ...b, confirm: false }));
        await assert.rejects(() => act({ ...b, expected_price: "999" }));
        assert.equal(
          (
            await request(
              "social/review-action",
              { project_id: project, ...b },
              member.cookie + "; kc_workspace=" + ws,
            )
          ).status,
          403,
        );
        await act(b);
        globalThis.fetch = async (url: any, init: any) => {
          calls++;
          assert.match(
            String(url),
            /^https:\/\/api\.ayrshare\.com\/api\/(messages\/facebook|messages\/instagram)$/,
          );
          assert.deepEqual(JSON.parse(init.body), {
            recipientId: "customer-1",
            message: "Reviewed fixture reply",
          });
          return new Response(
            JSON.stringify({
              status: "success",
              messageId: "fixture-response-id",
            }),
          );
        };
        await Promise.all([dispatchSocialReply(), dispatchSocialReply()]);
        assert.equal(calls, 2);
        await dispatchSocialReply();
        assert.equal(calls, 2);
        const sent = (
          await pool.query("SELECT * FROM social_replies WHERE id=$1", [r.id])
        ).rows[0];
        assert.equal(sent.status, "submitted");
        assert.equal(sent.receipt.id, "fixture-response-id");
        await assert.rejects(() => makeReply(item, "Duplicate"));
      },
    );
    await t.test(
      "Changed incoming context blocks queued replies; uncertain sends retain costs and never repeat",
      async () => {
        const s = await source("comments", "facebook", "ayrshare-post-fixture");
        globalThis.fetch = async () => {
          calls++;
          return new Response(
            JSON.stringify({
              facebook: [
                {
                  commentId: "comment-1",
                  comment: "Question fixture",
                  from: { name: "Comment author" },
                  created: "2026-11-12T12:00:00Z",
                },
              ],
            }),
          );
        };
        await sync(s.id);
        let item = await getItem(s.id);
        const r = await makeReply(item, "Comment reply");
        await act(await approve(r.id));
        await pool.query(
          "UPDATE social_sources SET last_fetch=now()-interval '20 minutes' WHERE id=$1",
          [s.id],
        );
        globalThis.fetch = async () => {
          calls++;
          return new Response(
            JSON.stringify({
              facebook: [
                {
                  commentId: "comment-1",
                  comment: "Changed question",
                  from: { name: "Comment author" },
                },
              ],
            }),
          );
        };
        await sync(s.id);
        const before = calls;
        await dispatchSocialReply();
        assert.equal(calls, before);
        assert.equal(
          (
            await pool.query("SELECT status FROM social_replies WHERE id=$1", [
              r.id,
            ])
          ).rows[0].status,
          "blocked",
        );
        item = await getItem(s.id);
        await act({
          action: "reply",
          item_id: item.id,
          expected_item_revision: item.revision,
          text: "Updated reply",
          id: r.id,
          expected_revision: r.revision,
        });
        await act(await approve(r.id));
        globalThis.fetch = async () => {
          calls++;
          throw Error("Fixture lost reply response");
        };
        await dispatchSocialReply();
        assert.equal(calls, before + 1);
        await dispatchSocialReply();
        assert.equal(calls, before + 1);
        assert.equal(
          (
            await pool.query("SELECT status FROM social_replies WHERE id=$1", [
              r.id,
            ])
          ).rows[0].status,
          "uncertain",
        );
        await assert.rejects(() => makeReply(item, "Must not duplicate"));
        const receipt = (
          await pool.query(
            "SELECT status FROM external_cost_receipts WHERE project_id=$1 AND subject LIKE 'Social reply%' ORDER BY created_at DESC LIMIT 1",
            [project],
          )
        ).rows[0];
        assert.equal(receipt.status, "uncertain");
      },
    );
    await t.test(
      "Analytics snapshots preserve zero and omit unknown metrics; read outcomes never automatically retry",
      async () => {
        const s = await source(
          "analytics",
          "linkedin",
          "analytics-post-fixture",
        );
        globalThis.fetch = async (url: any, init: any) => {
          calls++;
          assert.equal(
            String(url),
            "https://api.ayrshare.com/api/analytics/post",
          );
          assert.deepEqual(JSON.parse(init.body), {
            id: "analytics-post-fixture",
            platforms: ["linkedin"],
          });
          return new Response(
            JSON.stringify({
              linkedin: {
                analytics: {
                  likeCount: 0,
                  impressionCount: 100,
                  commentCount: null,
                },
                lastUpdated: "2026-11-13T00:00:00Z",
              },
            }),
          );
        };
        await sync(s.id);
        const snapshot = await socialSnapshot(actor, ws, project);
        assert.deepEqual(snapshot.analytics[0].metrics, {
          likeCount: 0,
          impressionCount: 100,
        });
        const before = calls;
        await sync(s.id);
        assert.equal(calls, before);
        const q = await source(
          "comments",
          "instagram",
          "uncertain-read-fixture",
        );
        globalThis.fetch = async () => {
          calls++;
          throw Error("Fixture network failure");
        };
        await assert.rejects(() => sync(q.id));
        const after = calls;
        await assert.rejects(() => sync(q.id));
        assert.equal(calls, after);
      },
    );
  } finally {
    globalThis.fetch = oldFetch;
    await pool.query("DELETE FROM social_sources WHERE connection_id=$1", [co]);
    await pool.query("DELETE FROM social_prices WHERE connection_id=$1", [co]);
    await pool.query("DELETE FROM work_app_connections WHERE id=$1", [co]);
    await pool.query(
      "DELETE FROM project_external_budgets WHERE project_id=$1",
      [project],
    );
  }
}
