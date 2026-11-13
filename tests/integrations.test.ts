import { test } from "node:test";
import assert from "node:assert/strict";
import {
  integrations,
  integrationById,
} from "../src/core/integration-catalog.ts";
import {
  integrationPlan,
  integrationHeaders,
} from "../src/core/integration-plans.ts";
import { appWrites } from "../src/core/work-apps.ts";

test("integration contracts reject writes through read operations and unknown fields", () => {
  assert.equal(appWrites("service_write"), true);
  assert.equal(appWrites("service_read"), false);
  assert.throws(() =>
    integrationPlan("discord", "service_read", {
      action: "send",
      channel_id: "123",
      text: "test",
    }),
  );
  assert.throws(() =>
    integrationPlan("slack", "service_write", {
      action: "messages",
      channel_id: "C123",
    }),
  );
  assert.throws(() =>
    integrationPlan("discord", "service_read", {
      action: "messages",
      channel_id: "123",
      url: "https://evil.invalid",
    }),
  );
  assert.throws(() =>
    integrationPlan("discord", "service_read", {
      action: "messages",
      channel_id: "../users/@me",
    }),
  );
  assert.throws(() =>
    integrationPlan("discord", "service_write", {
      action: "send",
      channel_id: "123",
      text: "x".repeat(2001),
    }),
  );
});
test("credentials stay on exact approved HTTPS origins with provider-specific auth", () => {
  for (const url of [
    "http://discord.com/api/v10/users/@me",
    "https://discord.com.evil.invalid/api",
    "https://user@discord.com/api",
    "https://discord.com:4430/api",
    "https://127.0.0.1/",
  ])
    assert.throws(() => integrationHeaders("discord", "fixture-secret", url));
  assert.throws(() =>
    integrationHeaders(
      "slack",
      "fixture-secret",
      "https://discord.com/api/v10/users/@me",
    ),
  );
  assert.throws(() =>
    integrationHeaders(
      "slack",
      "secret\r\nInjected: value",
      "https://slack.com/api/auth.test",
    ),
  );
  assert.equal(
    integrationHeaders(
      "discord",
      "fixture-secret",
      "https://discord.com/api/v10/users/@me",
    ).Authorization,
    "Bot fixture-secret",
  );
  assert.equal(
    integrationHeaders(
      "figma",
      "fixture-secret",
      "https://api.figma.com/v1/me",
    )["X-Figma-Token"],
    "fixture-secret",
  );
  assert.equal(
    integrationHeaders(
      "linear",
      "fixture-secret",
      "https://api.linear.app/graphql",
    ).Authorization,
    "fixture-secret",
  );
});
test("separate OAuth services request relevant scopes rather than bundled mail, files and calendar", () => {
  const gmail = integrationById("gmail")!;
  assert.deepEqual(gmail.scopes?.read, [
    "https://www.googleapis.com/auth/gmail.readonly",
  ]);
  assert.ok(!gmail.operations?.includes("files_list"));
  assert.deepEqual(integrationById("outlook")!.scopes?.read, [
    "offline_access",
    "Mail.Read",
  ]);
  assert.ok(
    integrationById("google-sheets")!.scopes?.read.includes(
      "https://www.googleapis.com/auth/spreadsheets.readonly",
    ),
  );
});
test("cell reads are bounded and social posts disable mass mentions and unknown networks", () => {
  assert.throws(() =>
    integrationPlan("google-sheets", "service_read", {
      action: "values",
      spreadsheet_id: "abc",
      range: "A1:ZZ9999",
    }),
  );
  assert.throws(() =>
    integrationPlan("google-sheets", "service_read", {
      action: "values",
      spreadsheet_id: "abc",
      range: "A:A",
    }),
  );
  const range = integrationPlan("google-sheets", "service_read", {
    action: "values",
    spreadsheet_id: "abc",
    range: "Sheet1!A1:D30",
  });
  assert.ok(range.url.endsWith("Sheet1!A1%3AD30"));
  const message = integrationPlan("discord", "service_write", {
    action: "send",
    channel_id: "123",
    text: "@everyone hello",
  });
  assert.deepEqual((message.body as any).allowed_mentions, { parse: [] });
  assert.throws(() =>
    integrationPlan("ayrshare", "service_write", {
      action: "publish",
      platforms: "instagram,unknown",
      text: "hello",
    }),
  );
});
test("every listed adapter has executable read tests and a fixed-origin bounded contract for each action", () => {
  assert.equal(
    new Set(integrations.map((i) => i.id)).size,
    integrations.length,
  );
  for (const service of integrations) {
    if (service.test.operation === "service_read") {
      const plan = integrationPlan(
        service.id,
        service.test.operation,
        service.test.input,
      );
      integrationHeaders(service.provider, "protocol-fixture-token", plan.url);
    }
    for (const action of service.actions) {
      const input: Record<string, string> = { action: action.id };
      for (const f of action.fields)
        input[f.name] =
          f.name === "fields_json"
            ? '{"Name":"Fixture"}'
            : f.name === "range"
              ? "A1:D30"
              : f.name === "email"
                ? "fixture@example.invalid"
                : f.name === "platforms"
                  ? "bluesky"
                  : f.name === "path"
                    ? ""
                    : f.name.endsWith("_id")
                      ? "fixture123"
                      : "Protocol fixture";
      const plan = integrationPlan(
        service.id,
        action.write ? "service_write" : "service_read",
        input,
      );
      integrationHeaders(service.provider, "protocol-fixture-token", plan.url);
      assert.ok(!plan.url.includes("protocol-fixture-token"));
    }
  }
});
