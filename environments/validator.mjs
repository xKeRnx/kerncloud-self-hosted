// Dedicated preview sandbox. No customer credentials, arbitrary URLs or shell commands.
import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { chromium } from "/opt/kerncloud/node_modules/playwright-core/index.mjs";
const token = process.env.VALIDATOR_TOKEN ?? "";
if (token.length < 40 || process.getuid?.() === 0)
  throw new Error("Non-root validator credentials required");
let busy = false;
const authorize = (header) => {
  const got = Buffer.from(header ?? ""),
    expected = Buffer.from("Bearer " + token);
  return got.length === expected.length && timingSafeEqual(got, expected);
};
export async function validate(payload) {
  if (
    typeof payload.html !== "string" ||
    Buffer.byteLength(payload.html) > 1500000 ||
    typeof payload.csp !== "string" ||
    !Array.isArray(payload.checks) ||
    payload.checks.length > 20
  )
    throw new Error("Invalid bounded input");
  const browser = await chromium.launch({
    headless: true,
    executablePath: "/usr/bin/chromium",
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-background-networking",
    ],
    env: { PATH: "/usr/bin:/bin", HOME: "/tmp", LANG: "C.UTF-8" },
  });
  const results = [];
  try {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      const context = await browser.newContext({
        viewport,
        serviceWorkers: "block",
        acceptDownloads: false,
        reducedMotion: "reduce",
      });
      const page = await context.newPage(),
        errors = [],
        checks = [];
      page.setDefaultTimeout(1200);
      page.on("pageerror", (e) => errors.push(e.message.slice(0, 500)));
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text().slice(0, 500));
      });
      page.on("dialog", (d) => d.dismiss().catch(() => {}));
      await context.route("**/*", async (route) => {
        if (
          route.request().url() === "http://artifact.invalid/" &&
          route.request().isNavigationRequest()
        )
          await route.fulfill({
            status: 200,
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Content-Security-Policy": payload.csp,
            },
            body: payload.html,
          });
        else await route.abort();
      });
      try {
        await page.goto("http://artifact.invalid/", {
          waitUntil: "domcontentloaded",
          timeout: 5000,
        });
        for (const [index, c] of payload.checks.entries()) {
          if (typeof c.selector !== "string" || c.selector.length > 500)
            throw new Error("Invalid selector");
          try {
            const loc = page.locator(c.selector);
            switch (c.action) {
              case "click":
                await loc.click();
                break;
              case "fill":
                await loc.fill(c.value);
                break;
              case "press":
                await loc.press(c.value);
                break;
              case "assert_text":
                if (!(await loc.innerText()).includes(c.value))
                  throw new Error("Expected text missing: " + c.value);
                break;
              case "assert_attribute":
                if ((await loc.getAttribute(c.attribute)) !== c.value)
                  throw new Error(
                    "Attribute " + c.attribute + " does not equal " + c.value,
                  );
                break;
              case "assert_value":
                if ((await loc.inputValue()) !== c.value)
                  throw new Error("Expected input value: " + c.value);
                break;
              case "assert_count":
                if (String(await loc.count()) !== c.value)
                  throw new Error("Unexpected element count");
                break;
              case "assert_visible":
                if ((await loc.isVisible()) !== (c.value !== "false"))
                  throw new Error("Unexpected visibility");
                break;
              default:
                throw new Error("Unsupported check action");
            }
            checks.push({
              index,
              action: c.action,
              selector: c.selector,
              passed: true,
            });
          } catch (e) {
            checks.push({
              index,
              action: c.action,
              selector: c.selector,
              passed: false,
              error: String(e.message).slice(0, 700),
            });
            break;
          }
        }
        const layout = await page.evaluate(() => ({
          client: document.documentElement.clientWidth,
          scroll: document.documentElement.scrollWidth,
          bodyText: document.body?.innerText?.trim().length ?? 0,
        }));
        results.push({
          viewport,
          checks,
          errors,
          layout,
          passed:
            checks.length === payload.checks.length &&
            checks.every((c) => c.passed) &&
            errors.length === 0 &&
            layout.bodyText > 0 &&
            layout.scroll <= layout.client + 1,
        });
      } catch (e) {
        results.push({
          viewport,
          checks,
          errors,
          passed: false,
          error: String(e.message).slice(0, 700),
        });
      } finally {
        await context.close();
      }
    }
    return {
      ok: true,
      passed: results.every((r) => r.passed),
      engine: "Chromium",
      network: "blocked",
      results,
    };
  } finally {
    await browser.close();
  }
}
http
  .createServer(async (req, res) => {
    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200);
      res.end("ok");
      return;
    }
    if (
      req.url !== "/validate" ||
      req.method !== "POST" ||
      !authorize(req.headers.authorization)
    ) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (busy) {
      res.writeHead(429);
      res.end();
      return;
    }
    busy = true;
    const deadline = setTimeout(() => process.exit(1), 30000); // compose restarts stuck JS, no accepted result is forged
    try {
      let body = "",
        bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 1600000) throw new Error("Too large");
        body += chunk;
      }
      const result = await validate(JSON.parse(body));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch {
      res.writeHead(400);
      res.end(
        JSON.stringify({
          ok: false,
          error: "Browser validation could not finish",
        }),
      );
    } finally {
      clearTimeout(deadline);
      busy = false;
    }
  })
  .listen(3210, "0.0.0.0");
