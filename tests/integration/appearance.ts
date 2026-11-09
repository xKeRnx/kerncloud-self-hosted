import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
export async function appearanceTests(t: any, { request, pool, handle }: any) {
  const input = {
    name: "Appearance fixture",
    email: "appearance@fixture.invalid",
    password: "appearance-fixture-password",
    privacyAccepted: true,
  };
  const owner = await request("auth/signup", input),
    s = (await request("state", undefined, owner.cookie)).data;
  const foreign = await request("auth/signup", {
    ...input,
    email: "appearance-foreign@fixture.invalid",
  });
  const f = (await request("state", undefined, foreign.cookie)).data;
  const req = (p: string, b?: unknown) => request(p, b, owner.cookie);
  await t.test(
    "appearance persists per account across fresh sessions and workspaces, not for other users",
    async () => {
      assert.deepEqual((await req("preferences/appearance")).data, {
        theme: "light",
      });
      assert.equal(
        (await req("preferences/appearance", { theme: "dark" })).status,
        200,
      );
      const device = await request("auth/login", input);
      assert.equal(device.status, 200);
      assert.equal(
        (await request("state", undefined, device.cookie)).data.appearance
          .theme,
        "dark",
      );
      assert.equal(
        (await request("preferences/appearance", undefined, foreign.cookie))
          .data.theme,
        "light",
      );
      const second = randomUUID();
      await pool.query(
        "INSERT INTO workspaces(id,owner_id,name) VALUES($1,$2,'Second appearance workspace')",
        [second, s.user.id],
      );
      assert.equal(
        (await req("preferences/appearance?workspaceId=" + second)).data.theme,
        "dark",
      );
      for (const theme of ["system", "light", "dark"]) {
        assert.equal(
          (await req("preferences/appearance", { theme })).status,
          200,
        );
        assert.equal((await req("preferences/appearance")).data.theme, theme);
      }
    },
  );
  await t.test(
    "appearance rejects anonymous, invalid, cross-origin and impersonated writes",
    async () => {
      assert.equal(
        (await request("preferences/appearance", { theme: "dark" })).status,
        401,
      );
      for (const body of [
        { theme: "invalid" },
        { theme: null },
        {},
        { theme: "light", userId: f.user.id },
      ])
        assert.equal((await req("preferences/appearance", body)).status, 400);
      assert.equal(
        (
          await request(
            "preferences/appearance?workspaceId=" + s.workspace.id,
            { theme: "light" },
            foreign.cookie,
          )
        ).status,
        403,
      );
      const response = await handle(
        new NextRequest("http://localhost:3100/api/preferences/appearance", {
          method: "POST",
          headers: {
            cookie: owner.cookie,
            origin: "https://foreign.invalid",
            "content-type": "application/json",
          },
          body: JSON.stringify({ theme: "light" }),
        }),
        "preferences/appearance",
      );
      assert.equal(response.status, 403);
      assert.equal((await req("preferences/appearance")).data.theme, "dark");
    },
  );
  await t.test(
    "a workspace viewer can set their own appearance without changing the owner's",
    async () => {
      await pool.query(
        "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'viewer')",
        [s.workspace.id, f.user.id],
      );
      const r = await request(
        "preferences/appearance?workspaceId=" + s.workspace.id,
        { theme: "system" },
        foreign.cookie,
      );
      assert.equal(r.status, 200);
      assert.equal(
        (
          await request(
            "state?workspaceId=" + s.workspace.id,
            undefined,
            foreign.cookie,
          )
        ).data.appearance.theme,
        "system",
      );
      assert.equal((await req("preferences/appearance")).data.theme, "dark");
      await pool.query("DELETE FROM users WHERE id=$1", [f.user.id]);
      assert.equal(
        (
          await pool.query(
            "SELECT count(*) FROM user_appearance_preferences WHERE user_id=$1",
            [f.user.id],
          )
        ).rows[0].count,
        "0",
      );
    },
  );
}
