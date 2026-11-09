import test from "node:test";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import { createOffice } from "../src/core/office.ts";
import { workspacePermission } from "../src/core/workspace-permissions.ts";
import { quietHour, localClock } from "../src/core/briefing.ts";
import { appPlan } from "../src/core/work-apps.ts";
import {
  githubRepository,
  projectCommand,
  publishInput,
} from "../src/core/projects.ts";
test("Shared workspace roles separate editing, approvals and owner billing", () => {
  for (const p of ["chat", "runs", "suite/quality/start"])
    assert.equal(workspacePermission("viewer", p, "POST"), false);
  assert.equal(workspacePermission("viewer", "knowledge/search", "POST"), true);
  assert.equal(
    workspacePermission("viewer", "preferences/project", "POST"),
    true,
  );
  assert.equal(
    workspacePermission("editor", "decisions/respond", "POST", {
      choice: "approve",
    }),
    false,
  );
  assert.equal(
    workspacePermission("editor", "decisions/respond", "POST", {
      choice: "answer",
    }),
    true,
  );
  for (const role of ["admin", "editor", "viewer"] as const)
    assert.equal(workspacePermission(role, "billing/portal", "POST"), false);
});
test("Quiet hours cross midnight and timezone conversion handles DST", () => {
  assert.equal(quietHour(23, 20, 8), true);
  assert.equal(quietHour(7, 20, 8), true);
  assert.equal(quietHour(8, 20, 8), false);
  assert.equal(quietHour(14, 20, 8), false);
  assert.equal(quietHour(2, 8, 8), false);
  assert.equal(
    localClock(new Date("2026-10-24T06:00:00Z"), "Europe/Berlin").hour,
    8,
  );
  assert.throws(() => localClock(new Date(), "not/a/timezone"));
});
test("Office ZIP roundtrip, escaping and literal spreadsheet cells", () => {
  for (const ext of ["docx", "xlsx", "pptx"]) {
    const r = createOffice({
      name: "result." + ext,
      title: "A & <B>",
      paragraphs: ["Editable content"],
      sheets: [
        {
          name: "Sheet 1",
          rows: [['=HYPERLINK("https://evil")', 12, true, "<script>"]],
        },
      ],
      slides: [{ title: "Presentation", bullets: ["Editable & text"] }],
    });
    const zip = unzipSync(r.data);
    assert.ok(zip["[Content_Types].xml"]);
    assert.ok(
      r.preview.includes("&lt;") ||
        r.preview.includes("&amp;") ||
        r.preview.includes("Presentation"),
    );
    assert.ok(!r.preview.includes("<script>"));
    if (ext === "xlsx") {
      const xml = strFromU8(zip["xl/worksheets/sheet1.xml"]);
      assert.ok(xml.includes("inlineStr"));
      assert.ok(!xml.includes("<f>"));
    }
  }
  assert.throws(() => createOffice({ name: "../secret.docx", title: "x" }));
  assert.throws(() => createOffice({ name: "empty.pptx", title: "x" }));
});
test("Work app plans use fixed endpoints and validate mail headers and event ranges", () => {
  assert.match(
    appPlan("google", "mail_read", { id: "abc" }).url,
    /^https:\/\/gmail.googleapis.com\//,
  );
  assert.throws(() => appPlan("google", "mail_read", { id: "../tokens" }));
  assert.throws(() =>
    appPlan("google", "mail_send", {
      to: "a@example.com",
      subject: "x\r\nBcc: z@example.com",
      text: "x",
    }),
  );
  assert.throws(() =>
    appPlan("microsoft", "calendar_create", {
      title: "x",
      start: "2026-10-24T12:00:00Z",
      end: "2026-10-24T11:00:00Z",
    }),
  );
});
test("Git recipes reject injected repositories, refs and traversal in PR payloads", () => {
  assert.equal(
    githubRepository("https://github.com/example/repo.git"),
    "example/repo",
  );
  assert.throws(() => githubRepository("https://example.com/repo"));
  assert.throws(() =>
    githubRepository("https://token@github.com/example/repo"),
  );
  assert.throws(() =>
    projectCommand(
      {
        id: "bca8d752-4144-4ca1-b88d-f253f02c6631",
        repo_url: "https://github.com/example/repo",
        branch: "main; rm -rf /",
      },
      "clone",
    ),
  );
  assert.throws(() =>
    publishInput.parse({
      repository: "example/repo",
      base: "main",
      branch: "new",
      title: "x",
      files: [{ path: "../secret", content: "x" }],
    }),
  );
});

test(
  "Linux project storage guard measures real bytes and rejects writes over budget",
  { skip: process.platform === "win32" },
  async (t) => {
    const fs = await import("node:fs/promises"),
      os = await import("node:os"),
      path = await import("node:path");
    const { storageGuard } = await import("../environments/storage-budget.mjs");
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "kerncloud-storage-test-"),
    );
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const guard = storageGuard(root);
    guard.configure(64 * 1024 * 1024);
    await fs.writeFile(path.join(root, "fixture.txt"), "a".repeat(4096));
    assert.ok((await guard.measure(true)) >= 4096);
    await guard.check(10);
    await assert.rejects(() => guard.check(64 * 1024 * 1024));
    assert.equal(await guard.over(), false);
  },
);
