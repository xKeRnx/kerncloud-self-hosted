import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { projectCheckpoints } from "../environments/checkpoints.mjs";

test(
  "Automatische Dateisicherung ist je Auftrag idempotent; symbolische Links verlassen das Projekt nicht",
  {
    skip:
      process.platform === "win32"
        ? "Linux container filesystem required"
        : false,
  },
  async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kc-checkpoint-"));
    try {
      const root = path.join(dir, "project");
      await fs.mkdir(root);
      await fs.writeFile(path.join(root, "source.txt"), "v1");
      await fs.writeFile(path.join(dir, "outside.txt"), "private");
      await fs.symlink(
        path.join(dir, "outside.txt"),
        path.join(root, "link.txt"),
      );
      const execute: (...args: any[]) => Promise<any> = projectCheckpoints(
          root,
          path.join(dir, "snapshots"),
        ),
        scope = randomUUID();
      const first = await execute({ action: "ensure", scope });
      await fs.writeFile(path.join(root, "source.txt"), "v2");
      const second = await execute({ action: "ensure", scope });
      assert.equal(second.id, first.id);
      const list = await execute({ action: "list" });
      assert.equal(list.checkpoints.length, 1);
      assert.equal(list.checkpoints[0].files, 1);
      assert.ok(list.checkpoints[0].skipped.includes("link.txt"));
      await assert.rejects(
        execute({ action: "ensure", scope: "../outside" }),
        /Invalid checkpoint scope/,
      );
      assert.equal(
        await fs.readFile(path.join(dir, "outside.txt"), "utf8"),
        "private",
      );
    } finally {
      assert.ok(
        path
          .resolve(dir)
          .startsWith(path.join(path.resolve(os.tmpdir()), "kc-checkpoint-")),
      );
      await fs.rm(dir, { recursive: true, force: true });
    }
  },
);

test(
  "Projekt-Sicherung stellt Dateien wieder her, erhält einen Undo-Punkt und lässt Geheimnisse aus",
  {
    skip:
      process.platform === "win32"
        ? "Controller runs in Linux containers; verify atomic rename there"
        : false,
  },
  async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kc-checkpoint-"));
    try {
      const root = path.join(dir, "project");
      await fs.mkdir(root);
      await fs.writeFile(path.join(root, "index.html"), "original");
      await fs.writeFile(path.join(root, ".env"), "private-fixture");
      const execute: (...args: any[]) => Promise<any> = projectCheckpoints(
        root,
        path.join(dir, "snapshots"),
      );
      const s = await execute(
        { action: "create", name: "Original" },
        undefined,
      );
      assert.equal(s.files, 1);
      assert.ok(s.skipped.includes(".env"));
      await fs.writeFile(path.join(root, "index.html"), "broken");
      await fs.writeFile(path.join(root, "new.txt"), "new");
      const p = await execute(
        { action: "preview", checkpoint_id: s.id },
        undefined,
      );
      assert.deepEqual(p.changes.map((c: any) => c.action).sort(), [
        "remove",
        "replace",
      ]);
      const r = await execute(
        { action: "restore", checkpoint_id: s.id, preview_token: p.token },
        undefined,
      );
      assert.equal(
        await fs.readFile(path.join(root, "index.html"), "utf8"),
        "original",
      );
      assert.equal(
        await fs.readFile(path.join(root, ".env"), "utf8"),
        "private-fixture",
      );
      await assert.rejects(fs.stat(path.join(root, "new.txt")));
      const undo = await execute(
        { action: "preview", checkpoint_id: r.undo_checkpoint },
        undefined,
      );
      await execute(
        {
          action: "restore",
          checkpoint_id: r.undo_checkpoint,
          preview_token: undo.token,
        },
        undefined,
      );
      assert.equal(
        await fs.readFile(path.join(root, "new.txt"), "utf8"),
        "new",
      );
      await assert.rejects(
        execute(
          { action: "restore", checkpoint_id: s.id, preview_token: p.token },
          undefined,
        ),
        /changed|expired/,
      );
    } finally {
      assert.ok(
        path
          .resolve(dir)
          .startsWith(path.join(path.resolve(os.tmpdir()), "kc-checkpoint-")),
      );
      await fs.rm(dir, { recursive: true, force: true });
    }
  },
);
test("Neuere Nutzeränderungen blockieren eine zuvor geprüfte Wiederherstellung", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kc-checkpoint-"));
  try {
    const root = path.join(dir, "project");
    await fs.mkdir(root);
    await fs.writeFile(path.join(root, "a.txt"), "v1");
    const execute: (...args: any[]) => Promise<any> = projectCheckpoints(
      root,
      path.join(dir, "snapshots"),
    );
    const s = await execute({ action: "create", name: "v1" }, undefined);
    await fs.writeFile(path.join(root, "a.txt"), "v2");
    const p = await execute(
      { action: "preview", checkpoint_id: s.id },
      undefined,
    );
    await fs.writeFile(path.join(root, "a.txt"), "human edit");
    await assert.rejects(
      execute(
        { action: "restore", checkpoint_id: s.id, preview_token: p.token },
        undefined,
      ),
      /changed/,
    );
    assert.equal(
      await fs.readFile(path.join(root, "a.txt"), "utf8"),
      "human edit",
    );
  } finally {
    assert.ok(
      path
        .resolve(dir)
        .startsWith(path.join(path.resolve(os.tmpdir()), "kc-checkpoint-")),
    );
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("Große Dateien, manipulierte Manifeste und Pfadüberschreitungen werden abgewiesen", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kc-checkpoint-"));
  try {
    const root = path.join(dir, "project");
    await fs.mkdir(root);
    await fs.writeFile(path.join(root, "huge.bin"), Buffer.alloc(1048577));
    const execute: (...args: any[]) => Promise<any> = projectCheckpoints(
      root,
      path.join(dir, "snapshots"),
    );
    await assert.rejects(
      execute({ action: "create" }, undefined),
      /safely checkpointed/,
    );
    await assert.rejects(
      execute({ action: "preview", checkpoint_id: "../../outside" }, undefined),
      /Invalid checkpoint/,
    );
  } finally {
    assert.ok(
      path
        .resolve(dir)
        .startsWith(path.join(path.resolve(os.tmpdir()), "kc-checkpoint-")),
    );
    await fs.rm(dir, { recursive: true, force: true });
  }
});
