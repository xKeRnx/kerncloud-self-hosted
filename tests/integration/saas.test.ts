import test from "node:test";
import { selfHostedEdition } from "../../src/core/edition.ts";
import assert from "node:assert/strict";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { NextRequest } from "next/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith("_test"))
  throw new Error(
    "TEST_DATABASE_URL muss auf eine gesonderte Datenbank mit Endung _test zeigen.",
  );
process.env.DATABASE_URL = databaseUrl;
process.env.ADMIN_EMAIL = "admin@test.local";
process.env.ADMIN_PASSWORD = "integration-admin-password";
process.env.ENCRYPTION_KEY =
  process.env.TEST_ENCRYPTION_KEY ?? randomBytes(32).toString("hex");
process.env.WORKER_TOKEN = randomBytes(32).toString("hex");
process.env.ALLOW_LOCAL_ENDPOINTS = "true";
const { handle } = await import("../../src/server/api.ts");
const { pool } = await import("../../src/server/db.ts");
type Result = { status: number; data: Record<string, any>; cookie: string };
async function request(
  path: string,
  body?: unknown,
  cookie = "",
  method = "POST",
): Promise<Result> {
  // Historical fixtures explicitly exercise German content; defaults are checked separately below.
  if (["admin/legal", "admin/legal-preview"].includes(path) && body && typeof body === "object" && !("locale" in body)) body = { ...body, locale: "de" };
  const fixtureCookie = /(?:^|;\s*)kc_locale=/.test(cookie) ? cookie : [cookie, "kc_locale=de"].filter(Boolean).join("; ");
  const req = new NextRequest(`http://localhost:3100/api/${path}`, {
    method: body === undefined ? "GET" : method,
    headers: {
      "Content-Type": "application/json",
      cookie: fixtureCookie,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await handle(req, path.split("?")[0]);
  return {
    status: response.status,
    data: await response.json(),
    cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "",
  };
}
async function readBody(req: IncomingMessage) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function listen(server: ReturnType<typeof createServer>) {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  return `http://127.0.0.1:${address.port}`;
}
test(
  selfHostedEdition ? "Self-hosted: isolation, local access, budgets and real workers with local protocol fixtures" : "SaaS: Isolation, Adminrechte, Guthaben und reale Worker-Delegation mit lokaler Protokoll-Fixture",
  { timeout: 420000 },
  async (t) => {
    // This suite uses a dedicated disposable database, never the local user's workspace database.
    const check = new pg.Pool({ connectionString: databaseUrl });
    await check.query("DROP SCHEMA public CASCADE");
    await check.query("CREATE SCHEMA public");
    const { readFileSync } = await import("node:fs");
    const { encrypt, hashPassword } =
      await import("../../src/server/security.ts");
    await check.query(readFileSync("src/server/schema.sql", "utf8"));
    await check.query(
      "INSERT INTO users(id,email,name,password_hash,privacy_version) VALUES('migration-user','migration@test.local','Migration',$1,'fixture')",
      [hashPassword("migration-fixture-password")],
    );
    await check.query(
      "INSERT INTO workspaces(id,owner_id,name,plan_id,credits,subscription_status) VALUES('migration-workspace','migration-user','Legacy workspace','starter',12345,'local_test')",
    );
    await check.query(
      "INSERT INTO providers(workspace_id,name,endpoint,model,secret) VALUES('migration-workspace','Legacy provider','https://example.test/v1','legacy',$1)",
      [encrypt("legacy-fixture-secret")],
    );
    await check.query(
      "INSERT INTO agents(id,workspace_id,name,role,instructions,color) VALUES('migration-agent','migration-workspace','Legacy','Fixture','Fixture','cyan')",
    );
    for (const [id, content] of [
      ["migration-empty", null],
      ["migration-real", "Keine Antwort."],
    ]) {
      await check.query(
        "INSERT INTO runs(id,workspace_id,goal,status,max_steps) VALUES($1,'migration-workspace','Legacy fixture','completed',20)",
        [id],
      );
      await check.query(
        "INSERT INTO tasks(id,run_id,workspace_id,agent_id,title,instructions,status,result,messages) VALUES($1,$1,'migration-workspace','migration-agent','Legacy fixture','Fixture','completed','Keine Antwort.',$2)",
        [id, JSON.stringify([{ role: "assistant", content }])],
      );
    }
    await check.end();
    const processes: ChildProcess[] = [];
    let providerCalls = 0,
      mcpCalls = 0;
    const fixture = createServer(async (req, res) => {
      if (req.method === "GET" && req.url?.endsWith("/models")) {
        res.statusCode = 404;
        res.end();
        return;
      }
      try {
        const body = await readBody(req);
        if (req.url === "/mcp") {
          const server = new McpServer({
            name: "integration-fixture",
            version: "1.0.0",
          });
          server.registerTool(
            "fixture_echo",
            {
              description: "Return a test string",
              inputSchema: { text: z.string() },
            },
            async ({ text }) => {
              mcpCalls++;
              return { content: [{ type: "text", text }] };
            },
          );
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
          });
          await server.connect(transport);
          res.on("close", () => {
            void transport.close();
            void server.close();
          });
          await transport.handleRequest(req, res, body);
          return;
        }
        if (
          req.url !== "/v1/chat/completions" &&
          req.url !== "/v2/chat/completions"
        ) {
          res.writeHead(404).end();
          return;
        }
        if (body.model === "inbox-fixture") {
          const answered = body.messages.some(
            (m: any) =>
              m.role === "user" &&
              String(m.content).includes("Antwort des Nutzers"),
          );
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              choices: [
                {
                  message: answered
                    ? { role: "assistant", content: "Bestätigt: Dunkelblau." }
                    : {
                        role: "assistant",
                        content: null,
                        tool_calls: [
                          {
                            id: "inbox-question",
                            type: "function",
                            function: {
                              name: "request_input",
                              arguments: JSON.stringify({
                                question: "Welche Farbe soll verwendet werden?",
                                kind: "information",
                                action: "Farbwahl für Entwurf",
                                recipient: "Nutzer",
                              }),
                            },
                          },
                        ],
                      },
                },
              ],
              usage: {
                prompt_tokens: 100,
                completion_tokens: 50,
                total_tokens: 150,
              },
            }),
          );
          return;
        }
        providerCalls++;
        // The deterministic fixture must consume the same compact journal index
        // a real model receives, rather than assuming all old calls stay verbatim.
        const compactToolNames: string[] = (body.messages ?? []).flatMap(
          (m: any) => {
            if (
              m.role !== "user" ||
              !m.content?.startsWith("Kompakter Protokollindex")
            )
              return [];
            try {
              return JSON.parse(
                m.content.slice(m.content.indexOf("\n") + 1),
              ).flatMap((entry: any) =>
                (entry.tools ?? []).map((tool: any) => tool.name),
              );
            } catch {
              return [];
            }
          },
        );
        if (body.model.startsWith("recover-")) {
          const seen = (name: string) =>
            compactToolNames.includes(name) ||
            body.messages.some((m: any) =>
              m.tool_calls?.some((c: any) => c.function.name === name),
            );
          const corrections = body.messages.filter(
            (m: any) => m.role === "tool" && m.content?.includes('"ok":false'),
          );
          assert.ok(
            body.messages.every((m: any) => !("recovery_code" in m)),
            "private recovery metadata must not be sent to providers",
          );
          if (
            body.model === "recover-busy" ||
            (body.model === "recover-transient" &&
              !body.messages.some((m: any) =>
                m.content?.includes("Technischer Modellfehler"),
              ))
          ) {
            res.writeHead(503, { "Retry-After": "1" }).end("busy");
            return;
          }
          if (
            body.model === "recover-timeout" &&
            !body.messages.some((m: any) =>
              m.content?.includes("Technischer Modellfehler"),
            )
          ) {
            req.on("close", () => res.destroy());
            return;
          }
          const tool = (name: string, args: unknown) => ({
            role: "assistant",
            tool_calls: [
              {
                id: randomUUID(),
                type: "function",
                function: { name, arguments: JSON.stringify(args) },
              },
            ],
          });
          let message: any;
          if (body.model === "recover-context") {
            assert.ok(Buffer.byteLength(JSON.stringify(body)) < 90000);
            const saves = body.messages
              .flatMap((m: any) => m.tool_calls ?? [])
              .filter((c: any) => c.function.name === "save_artifact");
            for (const saved of saves)
              assert.ok(
                JSON.parse(saved.function.arguments).content.length < 1000,
                "provider history uses file references",
              );
            if (
              saves.length +
                compactToolNames.filter((name) => name === "save_artifact")
                  .length <
              3
            )
              message = tool("save_artifact", {
                name: "large.html",
                content:
                  "<!doctype html><html><body>" +
                  "fixture-payload ".repeat(6500) +
                  saves.length +
                  "</body></html>",
              });
            else if (!seen("read_artifact")) {
              const output = body.messages.find(
                (m: any) => m.tool_call_id === saves.at(-1).id,
              );
              message = tool("read_artifact", {
                artifact_id: JSON.parse(output.content).artifact_id,
                offset: 0,
                length: 20000,
              });
            } else {
              assert.ok(
                body.messages.some(
                  (m: any) =>
                    m.role === "tool" && m.content?.includes("fixture-payload"),
                ),
              );
              message = {
                role: "assistant",
                content:
                  "Large files saved and reviewed without context exhaustion.",
              };
            }
          } else if (
            (body.model === "recover-loop" &&
              !body.messages.some(
                (m: any) =>
                  m.role === "user" &&
                  m.content === "Try a different approach.",
              )) ||
            (body.model === "recover-tool" && !seen("environment_read_file"))
          )
            message = tool("environment_read_file", { path: "missing.html" });
          else if (body.model === "recover-tool" && !seen("save_artifact")) {
            assert.ok(corrections.length);
            assert.match(corrections[0].content, /environment_id/);
            assert.match(corrections[0].content, /"executed":false/);
            message = tool("save_artifact", {
              name: "recovered.html",
              content:
                "<!doctype html><html><body>Recovered result</body></html>",
            });
          } else
            message = {
              role: "assistant",
              content: "Completed after correcting the failed approach.",
            };
          res.writeHead(200, { "Content-Type": "application/json" }).end(
            JSON.stringify({
              choices: [
                {
                  message,
                  finish_reason: message.tool_calls ? "tool_calls" : "stop",
                },
              ],
              ...(body.model === "recover-no-usage"
                ? {}
                : {
                    usage: {
                      prompt_tokens: 100,
                      completion_tokens: 10,
                      total_tokens: 110,
                    },
                  }),
            }),
          );
          return;
        }
        if (body.model.startsWith("deliverable-")) {
          const name = body.model;
          const message: any =
            name === "deliverable-files" || name === "deliverable-high-budget"
              ? {
                  role: "assistant",
                  content:
                    'Created files.\n```html\n<!doctype html><html><head><link rel="stylesheet" href="styles.css"></head><body><h1>Preview fixture</h1><button id="demo">Animate</button><script src="script.js"></script></body></html>\n```\n```css\nbody{background:#f9e4ff}h1{color:purple}\n```\n```js\ndocument.querySelector("#demo").onclick=()=>document.body.dataset.clicked="yes";\n```',
                }
              : name === "deliverable-saved" &&
                  !body.messages.some((m: any) => m.role === "tool")
                ? {
                    role: "assistant",
                    content: null,
                    tool_calls: [
                      {
                        id: randomUUID(),
                        type: "function",
                        function: {
                          name: "save_artifact",
                          arguments: JSON.stringify({
                            name: "saved.html",
                            content:
                              "<html><body>Saved before empty answer</body></html>",
                          }),
                        },
                      },
                    ],
                  }
                : {
                    role: "assistant",
                    content: null,
                    ...(name === "deliverable-truncated"
                      ? {
                          tool_calls: [
                            {
                              id: "incomplete",
                              type: "function",
                              function: {
                                name: "save_artifact",
                                arguments:
                                  '{"name":"partial.html","content":"truncated"',
                              },
                            },
                          ],
                        }
                      : {}),
                  };
          const finish =
            name === "deliverable-truncated"
              ? "length"
              : message.tool_calls?.length
                ? "tool_calls"
                : "stop";
          assert.equal(
            body.max_completion_tokens,
            name === "deliverable-high-budget" ? 524288 : 12288,
          );
          if (name === "deliverable-empty-stream") {
            res
              .writeHead(200, { "Content-Type": "text/event-stream" })
              .end(
                `data: ${JSON.stringify({ choices: [{ delta: { role: "assistant" }, finish_reason: "length" }] })}\n\ndata: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 12288, total_tokens: 12388 } })}\n\ndata: [DONE]\n\n`,
              );
          } else
            res.writeHead(200, { "Content-Type": "application/json" }).end(
              JSON.stringify({
                choices: [{ message, finish_reason: finish }],
                usage: {
                  prompt_tokens: 100,
                  completion_tokens: 10,
                  total_tokens: 110,
                },
              }),
            );
          return;
        }
        if (body.model === "memory-fixture") {
          const messages = body.messages;
          const seen = (name: string) =>
            messages.some((m: any) =>
              m.tool_calls?.some((call: any) => call.function.name === name),
            );
          const reply = (message: unknown) =>
            res.writeHead(200, { "Content-Type": "application/json" }).end(
              JSON.stringify({
                choices: [{ message }],
                usage: {
                  prompt_tokens: 100,
                  completion_tokens: 20,
                  total_tokens: 120,
                },
              }),
            );
          const tool = (name: string, args: unknown) =>
            reply({
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: randomUUID(),
                  type: "function",
                  function: { name, arguments: JSON.stringify(args) },
                },
              ],
            });
          const memoryContext = messages
            .map((m: any) => m.content ?? "")
            .join("\n");
          if (seen("search_memory"))
            assert.match(memoryContext, /existing.login/);
          if (!seen("search_memory")) {
            tool("search_memory", { query: "Anmeldung" });
            return;
          }
          if (!seen("read_memory")) {
            tool("read_memory", { key: "existing.login" });
            return;
          }
          if (
            !memoryContext.includes("review.completed") &&
            !seen("write_memory")
          ) {
            tool("write_memory", {
              key: "review.completed",
              title: "Vorhandene Anmeldung geprüft",
              content:
                "Die Fixture hat den bestehenden Gedächtniseintrag gelesen; keine neue Implementierung angelegt.",
              kind: "work",
              status: "done",
              evidence:
                "Lokale Protokoll-Fixture: read_memory für existing.login.",
              expected_revision: null,
            });
            return;
          }
          reply({
            role: "assistant",
            content:
              "Bestehende Anmeldung aus dem Projektgedächtnis berücksichtigt. Keine doppelte Implementierung erzeugt.",
          });
          return;
        }
        if (body.model === "priced-stream" || body.model === "file-stream") {
          const toolResult = body.messages.find(
            (m: any) =>
              m.role === "tool" && m.content?.includes("FILE_CONTEXT_2026"),
          );
          if (body.model === "file-stream" && !toolResult) {
            const system = body.messages[0].content;
            const files = JSON.parse(
              system
                .split("Zugeordnete Dateien (read_attachment verwenden): ")[1]
                .split("\n")[0],
            );
            res.writeHead(200, { "Content-Type": "application/json" }).end(
              JSON.stringify({
                choices: [
                  {
                    message: {
                      role: "assistant",
                      content: null,
                      tool_calls: [
                        {
                          id: randomUUID(),
                          type: "function",
                          function: {
                            name: "read_attachment",
                            arguments: JSON.stringify({
                              attachment_id: files[0].id,
                            }),
                          },
                        },
                      ],
                    },
                  },
                ],
                usage: {
                  prompt_tokens: 1000,
                  completion_tokens: 100,
                  total_tokens: 1100,
                },
              }),
            );
            return;
          }
          res.writeHead(200, { "Content-Type": "text/event-stream" });
          const frame = (delta: unknown) =>
            `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;
          res.write(frame({ role: "assistant", content: "Live-Antwort: " }));
          await pause(800);
          res.write(
            frame({
              content: toolResult
                ? "Datei gelesen: FILE_CONTEXT_2026"
                : "gestreamte Antwort vom gewählten Modell.",
            }),
          );
          res.end(
            `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100 } })}\n\ndata: [DONE]\n\n`,
          );
          return;
        }
        assert.ok(body.tools.length >= 6);
        assert.equal(body.parallel_tool_calls, false);
        const messages = body.messages as {
          role: string;
          content: string | null;
          tool_calls?: { function: { name: string } }[];
        }[];
        const system = messages[0].content ?? "";
        const team = JSON.parse(system.match(/Team: (\[.*\])\n/)![1]) as {
          id: string;
          name: string;
        }[];
        const called = (name: string) =>
          compactToolNames.includes(name) ||
          messages.some((m) =>
            m.tool_calls?.some((c) => c.function.name === name),
          );
        const tool = (name: string, args: unknown) => ({
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: randomUUID(),
              type: "function",
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        });
        let message: unknown;
        if (system.startsWith("Du bist Atlas")) {
          const delegates =
            messages.filter((m) =>
              m.tool_calls?.some((c) => c.function.name === "delegate_task"),
            ).length +
            compactToolNames.filter((name) => name === "delegate_task").length;
          if (delegates < 2) {
            const target = team.find(
              (a) => a.name === (delegates === 0 ? "Nova" : "Echo"),
            )!;
            message = tool("delegate_task", {
              agent_id: target.id,
              title: `Teilaufgabe ${target.name}`,
              instructions:
                "Bearbeite die lokale Integrationsprüfung und speichere einen kurzen Bericht.",
            });
          } else if (!called("wait_for_team"))
            message = tool("wait_for_team", {});
          else
            message = {
              role: "assistant",
              content: "Geprüftes Ergebnis: beide Teilaufgaben abgeschlossen.",
            };
        } else {
          const mcp = body.tools.find((x: { function: { name: string } }) =>
            x.function.name.startsWith("mcp_"),
          );
          const availableMcp = JSON.parse(
            system.match(/MCP-Werkzeugindex: (\[.*\])\n/)?.[1] ?? "[]",
          )[0];
          if (!mcp && availableMcp && !called(availableMcp.name))
            message = tool("tool_catalog", { names: [availableMcp.name] });
          else if (mcp && !called(mcp.function.name))
            message = tool(mcp.function.name, { text: "MCP fixture reached" });
          else if (!called("save_artifact"))
            message = tool("save_artifact", {
              name: "integration-report.md",
              content: "# Ergebnis\nKontrollierter lokaler Test erfolgreich.",
            });
          else {
            await pause(150);
            message = {
              role: "assistant",
              content: "Teilaufgabe abgeschlossen und Ergebnis gespeichert.",
            };
          }
        }
        res.writeHead(200, { "Content-Type": "application/json" }).end(
          JSON.stringify({
            choices: [{ message }],
            usage: { total_tokens: 120 },
          }),
        );
      } catch (error) {
        res
          .writeHead(500, { "Content-Type": "application/json" })
          .end(JSON.stringify({ error: String(error) }));
      }
    });
    const fixtureUrl = await listen(fixture);
    const gateway = createServer(async (req, res) => {
      try {
        const body = await readBody(req);
        const path = (req.url ?? "").replace("/api/", "");
        const next = new NextRequest(`http://localhost:3100/api/${path}`, {
          method: req.method,
          headers: req.headers as Record<string, string>,
          body: JSON.stringify(body),
        });
        const response = await handle(next, path);
        res
          .writeHead(response.status, Object.fromEntries(response.headers))
          .end(await response.text());
      } catch (error) {
        res.writeHead(500).end(JSON.stringify({ error: String(error) }));
      }
    });
    const platformUrl = await listen(gateway);
    t.after(async () => {
      for (const p of processes) p.kill();
      await pause(1000);
      gateway.closeAllConnections();
      fixture.closeAllConnections();
      await new Promise<void>((r) => gateway.close(() => r()));
      await new Promise<void>((r) => fixture.close(() => r()));
      await pool.end();
    });
    await t.test("New visitors use English despite a German browser; explicit German is preserved", async () => {
      const siteResponse = await handle(new NextRequest("http://localhost:3100/api/site", {headers:{"accept-language":"de-DE,de;q=0.9"}}),"site");
      assert.equal(siteResponse.status,200);
      const site=await siteResponse.json();
      assert.equal(site.languages.defaultLocale,"en");
      assert.deepEqual(site.languages.enabled,["en","de"]);
      for(const [cookie,pattern] of [["",/sign in|sign-in|session|authenticated/i],["kc_locale=de",/melde dich an|anmelden|angemeldet|Anmeldung|Sitzung/i]] as const){
        const denied=await handle(new NextRequest("http://localhost:3100/api/snapshot",{headers:{cookie,"accept-language":"de-DE"}}),"snapshot");
        assert.equal(denied.status,401);
        assert.match((await denied.json()).error,pattern);
      }
    });
    const admin = await request("auth/login", {
      email: "admin@test.local",
      password: "integration-admin-password",
    });
    assert.equal(admin.status, 200);
    const { bridgeTests } = await import("./bridge.ts");
    await bridgeTests(t, { request, pool });
    if (process.env.BRIDGE_FOCUS === "1") return;
    const {appearanceTests} = await import("./appearance.ts");
    await appearanceTests(t,{request,pool,handle});
    const { workspaceRebuildTests } = await import("./workspace-rebuild.ts");
    await workspaceRebuildTests(t, { request, pool });
    if (process.env.WORKSPACE_REBUILD_FOCUS === "1") return;
    const { decisionBudgetTests } = await import("./decision-budgets.ts");
    await decisionBudgetTests(t, { request, pool });
    if (process.env.DECISION_BUDGET_FOCUS === "1") return;
    const { agentInspectorTests } = await import("./agent-inspector.ts");
    await agentInspectorTests(t, { request, pool });
    if (process.env.AGENT_INSPECTOR_FOCUS === "1") return;
    const { waitlistTests } = await import("./self-hosted-waitlist.ts");
    if (!selfHostedEdition) await waitlistTests(t, { request, pool, admin });
    if (process.env.WAITLIST_FOCUS === "1") return;
    const { organisationTests } = await import("./organisation.ts");
    if (process.env.ORGANISATION_FOCUS === "1") {
      await organisationTests(t, { request, pool, fixtureUrl });
      return;
    }
    await organisationTests(t, { request, pool, fixtureUrl });
    const { scalingTests } = await import("./scaling.ts");
    if (process.env.SCALING_FOCUS === "1") {
      await scalingTests(t, { request, pool, admin });
      return;
    }
    const { modelCheckTests } = await import("./model-check.ts");
    await modelCheckTests(t, { request, pool, admin });
    if (!process.env.MODEL_CHECK_FOCUS)
      await scalingTests(t, { request, pool, admin });
    if (process.env.MODEL_CHECK_FOCUS === "1") return;
    if (process.env.COMPETITIVE_FOCUS === "1") {
      const { competitiveTests } = await import("./competitive.ts");
      await competitiveTests(t, { request, pool, admin });
      return;
    }
    if (process.env.MODEL_CAPABILITIES_FOCUS === "1") {
      const foreign = await request("auth/signup", {
        email: "capabilities-foreign@test.local",
        name: "Foreign",
        password: "capabilities-fixture-password",
        privacyAccepted: true,
      });
      const { capabilityTests } = await import("./model-capabilities.ts");
      await capabilityTests(t, { request, pool, admin, foreign });
      return;
    }
    if (process.env.REASONING_PROFILE_FOCUS === "1") {
      const foreign = await request("auth/signup", {
        email: "reasoning-foreign@test.local",
        name: "Foreign fixture",
        password: "reasoning-foreign-fixture-password",
        privacyAccepted: true,
      });
      assert.equal(foreign.status, 200);
      const { reasoningProfileTests } = await import("./reasoning-profiles.ts");
      await reasoningProfileTests(t, {
        request,
        pool,
        admin,
        foreignCookie: foreign.cookie,
      });
      return;
    }
    await t.test(
      "Neue lokale Preisvorlagen begrenzen Hosting, eigene Rechner und Modellaufrufe",
      async () => {
        const rows = (await pool.query("SELECT * FROM plans")).rows;
        const starter = rows.find((p) => p.id === "starter"),
          pro = rows.find((p) => p.id === "pro"),
          business = rows.find((p) => p.id === "business");
        assert.equal(starter.price_cents, 1900);
        assert.equal(starter.credits, 50000);
        assert.equal(starter.max_workspaces, 1);
        assert.equal(starter.max_environments, 0);
        assert.equal(starter.max_customer_hosts, 1);
        assert.equal(starter.monthly_steps, 300);
        assert.equal(pro.price_cents, 4900);
        assert.equal(pro.credits, 150000);
        assert.equal(pro.runtime_minutes, 60);
        assert.equal(pro.max_customer_hosts, 2);
        assert.equal(business.price_cents, 9900);
        assert.equal(business.credits, 400000);
        assert.equal(business.max_parallel_tasks, 4);
      },
    );
    // Broad legacy scenarios deliberately use generous fixture plans; preset limits are asserted above.
    await pool.query(
      "UPDATE plans SET max_workspaces=CASE id WHEN 'free' THEN 2 WHEN 'starter' THEN 5 WHEN 'pro' THEN 20 ELSE max_workspaces END,max_agents=CASE id WHEN 'starter' THEN 6 WHEN 'pro' THEN 15 ELSE max_agents END,max_steps=CASE id WHEN 'starter' THEN 60 WHEN 'pro' THEN 150 ELSE max_steps END,credits=CASE id WHEN 'starter' THEN 100000 WHEN 'pro' THEN 500000 ELSE credits END,max_environments=CASE id WHEN 'starter' THEN 1 WHEN 'pro' THEN 3 ELSE max_environments END,max_running_environments=CASE id WHEN 'starter' THEN 1 WHEN 'pro' THEN 2 ELSE max_running_environments END,runtime_minutes=CASE id WHEN 'starter' THEN 300 WHEN 'pro' THEN 1200 ELSE runtime_minutes END,monthly_steps=10000,max_parallel_tasks=3 WHERE id IN('free','starter','pro')",
    );
    const alice = await request("auth/signup", {
      email: "alice@test.local",
      password: "alice-strong-password",
      name: "Alice",
      privacyAccepted: true,
    });
    assert.equal(alice.status, 200);
    const bob = await request("auth/signup", {
      email: "bob@test.local",
      password: "bob-strong-password",
      name: "Bob",
      privacyAccepted: true,
    });
    assert.equal(bob.status, 200);
    await t.test(
      "Landing session status uses verified sessions, not cookie presence",
      async () => {
        assert.equal((await request("auth/status")).data.authenticated, false);
        assert.equal(
          (await request("auth/status", undefined, "kc_session=made-up")).data
            .authenticated,
          false,
        );
        assert.equal(
          (await request("auth/status", undefined, alice.cookie)).data
            .authenticated,
          true,
        );
        assert.equal(
          (
            await request(
              "auth/status",
              undefined,
              alice.cookie + "; kc_workspace=stale-selection",
            )
          ).data.authenticated,
          true,
        );
        const uid = (await request("state", undefined, alice.cookie)).data.user
          .id;
        try {
          await pool.query("UPDATE users SET suspended=true WHERE id=$1", [
            uid,
          ]);
          assert.equal(
            (await request("auth/status", undefined, alice.cookie)).data
              .authenticated,
            false,
          );
        } finally {
          await pool.query("UPDATE users SET suspended=false WHERE id=$1", [
            uid,
          ]);
        }
        const { landingAccount } =
          await import("../../src/server/landing-account.ts");
        assert.equal(
          await landingAccount(
            new NextRequest("http://localhost/", {
              headers: { cookie: alice.cookie },
            }),
          ),
          true,
        );
      },
    );
    const a = (await request("state", undefined, alice.cookie)).data,
      b = (await request("state", undefined, bob.cookie)).data;
    assert.notEqual(a.workspace.id, b.workspace.id);
    assert.equal(a.agents.length, 3);
    if (process.env.INBOX_FOCUS === "1") {
      const child = spawn(
        process.execPath,
        ["--import", "tsx", "src/worker.ts"],
        {
          env: {
            ...process.env,
            PLATFORM_URL: platformUrl,
            WORKER_CONCURRENCY: "2",
          },
          stdio: ["ignore", "ignore", "pipe"],
        },
      );
      processes.push(child);

      const { decisionTests } = await import("./decisions.ts");
      await decisionTests(t, {
        request,
        pool,
        fixtureUrl,
        alice,
        echoCount: () => mcpCalls,
      });
      return;
    }
    const { agentRuntimeTests } = await import("./agent-runtime.ts");
    await agentRuntimeTests(t, platformUrl);
    const { agentWorkflowTests } = await import("./agent-workflows.ts");
    await agentWorkflowTests(t, platformUrl);
    assert.equal((await request("admin", undefined, alice.cookie)).status, 403);
    assert.equal(
      (
        await request(
          "runs",
          { goal: "No provider should fail", agentId: a.agents[0].id },
          alice.cookie,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await request(
          "provider",
          {
            name: "Local fixture",
            endpoint: `${fixtureUrl}/v1`,
            model: "fixture-tool-model",
            key: "fixture-secret",
          },
          alice.cookie,
        )
      ).status,
      200,
    );
    const safe = (await request("state", undefined, alice.cookie)).data;
    assert.equal(safe.provider.configured, true);
    assert.equal(JSON.stringify(safe).includes("fixture-secret"), false);
    const connection = await request(
      "connections",
      {
        name: "Fixture MCP",
        url: `${fixtureUrl}/mcp`,
        key: "fixture-mcp-token",
        allowed_tools: ["fixture_echo"],
        enabled: true,
      },
      alice.cookie,
    );
    assert.equal(connection.status, 200);
    const discovery = await request(
      `connections/${connection.data.id}/discover`,
      {},
      alice.cookie,
    );
    assert.equal(discovery.status, 200);
    assert.equal(discovery.data.tools[0].name, "fixture_echo");
    const nova = a.agents.find((x: AgentRow) => x.name === "Nova");
    assert.equal(
      (
        await request(
          "agents",
          { ...nova, mcp_ids: [connection.data.id] },
          alice.cookie,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await request(
          "connections",
          {
            id: connection.data.id,
            name: "Cross tenant",
            url: `${fixtureUrl}/mcp`,
            allowed_tools: [],
            enabled: true,
          },
          bob.cookie,
        )
      ).status,
      404,
    );
    const start = await request(
      "runs",
      {
        goal: "Bearbeitet diese Aufgabe als Team und prüft beide Ergebnisse.",
        agentId: a.agents.find((x: AgentRow) => x.name === "Atlas").id,
      },
      alice.cookie,
    );
    assert.equal(start.status, 200);
    assert.equal(
      (
        await request(
          `runs/${start.data.id}`,
          { action: "cancel" },
          bob.cookie,
          "PATCH",
        )
      ).status,
      404,
    );
    const firstClaim = await requestWorker("claim", { workerId: randomUUID() });
    assert.ok(firstClaim.task);
    const duplicate = await requestWorker("claim", { workerId: randomUUID() });
    assert.equal(duplicate.task, null);
    assert.equal(
      (
        await request(
          `runs/${start.data.id}`,
          { action: "pause" },
          alice.cookie,
          "PATCH",
        )
      ).status,
      200,
    );
    await requestWorker(
      "checkpoint",
      {
        taskId: firstClaim.task.id,
        lease: firstClaim.task.lease_token,
        messages: [],
      },
      409,
    );
    assert.equal(
      (
        await request(
          `runs/${start.data.id}`,
          { action: "resume" },
          alice.cookie,
          "PATCH",
        )
      ).status,
      200,
    );
    const reclaimed = await requestWorker("claim", { workerId: randomUUID() });
    assert.notEqual(reclaimed.task.lease_token, firstClaim.task.lease_token);
    await requestWorker(
      "checkpoint",
      {
        taskId: reclaimed.task.id,
        lease: firstClaim.task.lease_token,
        messages: [],
      },
      409,
    );
    await requestWorker("checkpoint", {
      taskId: reclaimed.task.id,
      lease: reclaimed.task.lease_token,
      messages: [],
      error: "Atomic claim and fencing test intentionally finished",
    });
    // A fresh run exercises the actual independent worker process against the HTTP gateway.
    const run = await request(
      "runs",
      {
        goal: "Bearbeitet diese Aufgabe als Team mit Delegation und Prüfung.",
        agentId: a.agents.find((x: AgentRow) => x.name === "Atlas").id,
      },
      alice.cookie,
    );
    assert.equal(run.status, 200);
    for (let i = 0; i < 2; i++) {
      const child = spawn(
        process.execPath,
        ["--import", "tsx", "src/worker.ts"],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            PLATFORM_URL: platformUrl,
            WORKER_CONCURRENCY: "2",
          },
          stdio: "pipe",
        },
      );
      child.stderr?.on("data", (chunk) => process.stderr.write(chunk));
      processes.push(child);
    }
    let final: Record<string, any> = {};
    for (let i = 0; i < 100; i++) {
      await pause(400);
      final = (await request("state", undefined, alice.cookie)).data;
      if (
        final.runs.find((r: RunRow) => r.id === run.data.id)?.status ===
        "completed"
      )
        break;
    }
    const finished = final.runs.find((r: RunRow) => r.id === run.data.id);
    assert.equal(finished.status, "completed", JSON.stringify(final.tasks));
    assert.equal(
      final.tasks.filter((x: TaskRow) => x.run_id === run.data.id).length,
      3,
    );
    assert.ok(
      final.events.some((e: { kind: string }) => e.kind === "delegated"),
    );
    assert.ok(final.artifacts.length >= 2);
    assert.ok(providerCalls >= 6);
    assert.ok(mcpCalls >= 1);
    const foreign = (await request("state", undefined, bob.cookie)).data;
    assert.equal(foreign.tasks.length, 0);
    assert.equal(foreign.artifacts.length, 0);
    assert.equal(
      (
        await request(
          "admin/provider",
          {
            name: "Hosted fixture",
            endpoint: `${fixtureUrl}/v1`,
            model: "fixture-model",
            key: "hosted-fixture-secret",
          },
          admin.cookie,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await request(
          "admin/workspace",
          { id: b.workspace.id, plan_id: "starter", creditAdjustment: 1000000 },
          admin.cookie,
        )
      ).status,
      200,
    );
    assert.equal(
      (await request("ai-mode", { mode: "managed" }, bob.cookie)).status,
      200,
    );
    await request(
      "run-policy",
      { credit_limit: 1000000, token_limit: 1000000, fallback_model_ids: [] },
      bob.cookie,
    );
    const managed = await request(
      "runs",
      {
        goal: "Erstelle einen kurzen überprüfbaren Bericht.",
        agentId: b.agents.find((x: AgentRow) => x.name === "Nova").id,
      },
      bob.cookie,
    );
    assert.equal(managed.status, 200);
    let managedFinal: Record<string, any> = {};
    for (let i = 0; i < 60; i++) {
      await pause(300);
      managedFinal = (await request("state", undefined, bob.cookie)).data;
      if (
        managedFinal.runs.find((r: RunRow) => r.id === managed.data.id)
          ?.status === "completed"
      )
        break;
    }
    assert.equal(
      managedFinal.runs.find((r: RunRow) => r.id === managed.data.id).status,
      "completed",
      JSON.stringify(managedFinal.tasks),
    );
    assert.ok(managedFinal.workspace.credits < 1000000);
    assert.ok(
      managedFinal.ledger.some((l: { amount: number }) => l.amount < 0),
    );
    assert.ok(!JSON.stringify(managedFinal).includes("hosted-fixture-secret"));
    assert.equal(
      managedFinal.workspace.credits,
      1000000 -
        managedFinal.runs.find((r: RunRow) => r.id === managed.data.id)
          .tokens_used,
    );
    assert.equal(
      (
        await request(
          "admin/workspace",
          {
            id: b.workspace.id,
            plan_id: "starter",
            creditAdjustment: -managedFinal.workspace.credits,
          },
          admin.cookie,
        )
      ).status,
      200,
    );
    if (selfHostedEdition) {
      // Public-edition contracts replace paid SaaS subscription fixtures below.
      const { selfHostedEditionTests } = await import("./self-hosted-edition.ts");
      await selfHostedEditionTests(t, { request, pool, admin });
      const { runtimeImprovementTests } = await import("./runtime-improvements.ts");
      await runtimeImprovementTests(t, fixtureUrl, platformUrl);
      const { resultTests } = await import("./artifacts.ts");
      await resultTests(t, { request, pool, handle, alice, bob, a });
      const { capabilityTests } = await import("./model-capabilities.ts");
      await capabilityTests(t, { request, pool, admin, foreign: alice });
      const { reasoningProfileTests } = await import("./reasoning-profiles.ts");
      await reasoningProfileTests(t, { request, pool, admin, foreignCookie: alice.cookie });
      const { modelAvailabilityTests } = await import("./model-availability.ts");
      await modelAvailabilityTests(t, { request, pool, fixtureUrl, foreignCookie: alice.cookie });
      return;
    }
    assert.equal(
      (
        await request(
          "runs",
          {
            goal: "Guthaben muss diesen Auftrag blockieren.",
            agentId: b.agents[0].id,
          },
          bob.cookie,
        )
      ).status,
      402,
    );
    assert.equal(
      (
        await request(
          "agents",
          {
            name: "Over quota",
            role: "Extra",
            instructions: "Quota test",
            skill_ids: [],
            mcp_ids: [],
          },
          alice.cookie,
        )
      ).status,
      402,
    );
    const { runtimeImprovementTests } =
      await import("./runtime-improvements.ts");
    await runtimeImprovementTests(t, fixtureUrl, platformUrl);
    const { extensions } = await import("./extensions.ts");
    await extensions(t, {
      request,
      pool,
      handle,
      alice,
      bob,
      admin,
      a,
      b,
      fixtureUrl,
    });
    const { resultTests } = await import("./artifacts.ts");
    // The preceding Stripe cancellation fixture intentionally expired access.
    // Start the unrelated deliverable regression tests with a valid test access period.
    await pool.query("UPDATE accounts SET access_expires_at=NULL WHERE id=$1", [
      a.workspace.account_id,
    ]);
    await resultTests(t, { request, pool, handle, alice, bob, a });
    const { customerHostTests } = await import("./customer-hosts.ts");
    await customerHostTests(t, { request, pool, handle, bob, admin });
    const { customerManagementTests } =
      await import("./customer-management.ts");
    await customerManagementTests(t, { request, pool, handle, admin });
    const { usageTests } = await import("./usage.ts");
    await usageTests(t, { request, pool, handle, admin });
    const { monthlyAllowanceTests } = await import("./monthly-allowances.ts");
    await monthlyAllowanceTests(t, { request, pool, admin });
    const { companyTests } = await import("./company.ts");
    await companyTests(t, { request, pool, handle, admin });
    const { einvoiceTests } = await import("./einvoices.ts");
    await einvoiceTests(t, { request, pool, handle, admin });
    const { competitiveTests } = await import("./competitive.ts");
    await competitiveTests(t, { request, pool, admin });
    const { capabilityTests } = await import("./model-capabilities.ts");
    const capForeign = await request("auth/signup", {
      email: "capabilities-foreign@test.local",
      name: "Foreign",
      password: "capabilities-fixture-password",
      privacyAccepted: true,
    });
    await capabilityTests(t, { request, pool, admin, foreign: capForeign });
    const { reasoningProfileTests } = await import("./reasoning-profiles.ts");
    await reasoningProfileTests(t, {
      request,
      pool,
      admin,
      foreignCookie: alice.cookie,
    });
    const { modelAvailabilityTests } = await import("./model-availability.ts");
    await modelAvailabilityTests(t, {
      request,
      pool,
      fixtureUrl,
      foreignCookie: alice.cookie,
    });
    await t.test(
      "Model monitor is tenant scoped, throttled, and removal preserves history",
      async () => {
        const u = await request("auth/signup", {
          email: "monitor@test.local",
          password: "monitor-fixture-password",
          name: "Monitor",
          privacyAccepted: true,
        });
        assert.equal(u.status, 200);
        let catalogRequests = 0;
        const catalogServer = createServer((req, res) => {
          catalogRequests++;
          res.end(JSON.stringify({ data: [{ id: "fixture-model" }] }));
        });
        const endpoint = await listen(catalogServer);
        try {
          const created = await request(
            "models",
            {
              name: "Monitor fixture",
              provider_name: "Fixture",
              endpoint,
              model: "fixture-model",
              key: "fixture-secret",
              monitor_enabled: false,
            },
            u.cookie,
          );
          assert.equal(created.status, 200);
          const mid = created.data.id;
          assert.notEqual(
            (
              await request(
                "models/action",
                { id: mid, action: "check" },
                alice.cookie,
              )
            ).status,
            200,
          );
          assert.equal(
            (
              await request(
                "models/action",
                { id: mid, action: "check" },
                u.cookie,
              )
            ).data.status,
            "available",
          );
          const beforeRepeat = catalogRequests;
          const checkedAt = (
            await pool.query(
              "SELECT checked_at FROM model_offerings WHERE id=$1",
              [mid],
            )
          ).rows[0].checked_at.toISOString();
          const cached = await request(
            "models/action",
            { id: mid, action: "check" },
            u.cookie,
          );
          assert.equal(cached.status, 200);
          assert.equal(cached.data.status, "available");
          assert.equal(cached.data.check_performed, false);
          assert.ok(
            cached.data.retry_after_seconds > 0 &&
              cached.data.retry_after_seconds <= 300,
          );
          assert.equal(catalogRequests, beforeRepeat);
          assert.equal(
            (
              await pool.query(
                "SELECT checked_at FROM model_offerings WHERE id=$1",
                [mid],
              )
            ).rows[0].checked_at.toISOString(),
            checkedAt,
          );
          assert.equal(
            (await request("state", undefined, u.cookie)).data.models.find(
              (m: any) => m.id === mid,
            ).check_status,
            "available",
          );
          assert.equal(
            (
              await request(
                "admin/models/action",
                { id: mid, action: "remove" },
                u.cookie,
              )
            ).status,
            403,
          );
          assert.equal(
            (
              await request(
                "models/action",
                { id: mid, action: "remove" },
                alice.cookie,
              )
            ).status,
            404,
          );
          const ws = (await request("state", undefined, u.cookie)).data
            .workspace.id;
          const rid = randomUUID();
          await pool.query(
            "INSERT INTO runs(id,workspace_id,goal,status,max_steps) VALUES($1,$2,'monitor deletion fixture','paused',20)",
            [rid, ws],
          );
          assert.equal(
            (
              await request(
                "models/action",
                { id: mid, action: "remove" },
                u.cookie,
              )
            ).status,
            409,
          );
          await pool.query("UPDATE runs SET status='canceled' WHERE id=$1", [
            rid,
          ]);
          assert.equal(
            (
              await request(
                "models/action",
                { id: mid, action: "remove" },
                u.cookie,
              )
            ).status,
            200,
          );
          const row = (
            await pool.query(
              "SELECT active,secret,deleted_at FROM model_offerings WHERE id=$1",
              [mid],
            )
          ).rows[0];
          assert.equal(row.active, false);
          assert.ok(row.deleted_at);
          const { decrypt } = await import("../../src/server/security.ts");
          assert.equal(decrypt(row.secret), "");
          assert.ok(
            !(await request("state", undefined, u.cookie)).data.models.some(
              (m: any) => m.id === mid,
            ),
          );
          assert.equal(
            (
              await request(
                "models",
                {
                  id: mid,
                  name: "restore",
                  provider_name: "Fixture",
                  endpoint,
                  model: "fixture-model",
                },
                u.cookie,
              )
            ).status,
            404,
          );
        } finally {
          catalogServer.closeAllConnections();
          await new Promise<void>((resolve) =>
            catalogServer.close(() => resolve()),
          );
        }
      },
    );
    const { decisionTests } = await import("./decisions.ts");
    await decisionTests(t, {
      request,
      pool,
      fixtureUrl,
      alice,
      echoCount: () => mcpCalls,
    });
    const unsafe = new NextRequest("http://localhost:3100/api/provider", {
      method: "POST",
      headers: {
        origin: "https://foreign.example",
        host: "localhost:3100",
        "Content-Type": "application/json",
        cookie: alice.cookie,
      },
      body: JSON.stringify({}),
    });
    assert.equal((await handle(unsafe, "provider")).status, 403);
    const exp = await request("privacy/export", undefined, bob.cookie);
    assert.equal(exp.status, 200);
    assert.equal(exp.data.account.email, "bob@test.local");
    assert.ok(!JSON.stringify(exp.data).includes("password_hash"));
    assert.equal(
      (
        await request(
          "privacy/delete",
          { password: "bob-strong-password", confirmation: "KONTO LÖSCHEN" },
          bob.cookie,
        )
      ).status,
      200,
    );
    assert.equal((await request("state", undefined, bob.cookie)).status, 401);
    const erased = (
      await pool.query("SELECT id FROM workspaces WHERE id=$1", [
        b.workspace.id,
      ])
    ).rowCount;
    assert.equal(erased, 0);
    async function requestWorker(
      path: string,
      body: unknown,
      expectedStatus = 200,
    ) {
      const req = new NextRequest(`http://localhost:3100/api/worker/${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.WORKER_TOKEN}`,
        },
        body: JSON.stringify(body),
      });
      const r = await handle(req, `worker/${path}`);
      assert.equal(r.status, expectedStatus, await r.clone().text());
      return r.json();
    }
  },
);
type AgentRow = { id: string; name: string };
type RunRow = { id: string; status: string };
type TaskRow = { run_id: string };
