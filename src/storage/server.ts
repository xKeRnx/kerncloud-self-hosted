import http from "node:http";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { resolve, dirname, sep } from "node:path";
import { timingSafeEqual } from "node:crypto";
export async function startObjectStorage(
  root = process.env.OBJECT_STORAGE_ROOT ?? "/data",
  token = process.env.OBJECT_STORAGE_TOKEN ?? "",
  port = Number(process.env.OBJECT_STORAGE_PORT ?? 3220),
  host = "0.0.0.0",
) {
  if (token.length < 32)
    throw new Error("Object storage requires an operator credential.");
  const base = resolve(root);
  await mkdir(base, { recursive: true, mode: 0o700 });
  let active = 0;
  const server = http.createServer(async (req, res) => {
    let counted = false;
    const release = () => {
      if (counted) {
        counted = false;
        active--;
      }
    };
    res.once("finish", release);
    res.once("close", release);
    try {
      const url = new URL(req.url ?? "/", "http://objects");
      if (url.pathname === "/health" && req.method === "GET") {
        res.writeHead(200).end("ok");
        return;
      }
      const auth = req.headers.authorization ?? "",
        expected = "Bearer " + token;
      if (
        Buffer.byteLength(auth) !== Buffer.byteLength(expected) ||
        !timingSafeEqual(Buffer.from(auth), Buffer.from(expected))
      ) {
        res.writeHead(401).end();
        return;
      }
      if (active >= 4) {
        res.writeHead(429, { "Retry-After": "1" }).end();
        return;
      }
      active++;
      counted = true;
      const key = url.pathname.slice(9);
      if (
        !url.pathname.startsWith("/objects/") ||
        !/^[a-zA-Z0-9_-]{1,100}\/[a-f0-9-]{36}$/.test(key) ||
        url.search
      ) {
        res.writeHead(400).end();
        return;
      }
      const file = resolve(base, key);
      if (!file.startsWith(base + sep)) {
        res.writeHead(400).end();
        return;
      }
      if (req.method === "PUT") {
        const chunks: Buffer[] = [];
        let bytes = 0;
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 16000000) {
            res.writeHead(413).end();
            return;
          }
          chunks.push(Buffer.from(chunk));
        }
        await mkdir(dirname(file), { recursive: true, mode: 0o700 });
        let handle;
        try {
          handle = await open(file, "wx", 0o600);
          await handle.writeFile(Buffer.concat(chunks));
          await handle.sync();
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === "EEXIST") {
            res.writeHead(409).end();
            return;
          }
          throw e;
        } finally {
          await handle?.close();
        }
        // Windows cannot open directories for fsync; the file itself was flushed above.
        if (process.platform !== "win32") {
          const directory = await open(dirname(file), "r");
          try {
            await directory.sync();
          } finally {
            await directory.close();
          }
        }
        res.writeHead(201).end();
        return;
      }
      if (req.method === "GET") {
        const data = await readFile(file);
        res
          .writeHead(200, {
            "Content-Type": "application/octet-stream",
            "Content-Length": data.length,
            "Cache-Control": "no-store",
          })
          .end(data);
        return;
      }
      if (req.method === "DELETE") {
        await unlink(file).catch((e) => {
          if (e.code !== "ENOENT") throw e;
        });
        res.writeHead(204).end();
        return;
      }
      res.writeHead(405).end();
    } catch (e) {
      if (!res.headersSent)
        res.writeHead(
          (e as NodeJS.ErrnoException).code === "ENOENT" ? 404 : 503,
        );
      res.end();
    }
  });
  server.maxConnections = 256;
  server.requestTimeout = 20000;
  server.headersTimeout = 10000;
  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  return server;
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("/storage/server.ts"))
  void startObjectStorage().then(() =>
    console.log("[Storage] Private encrypted object service ready."),
  );
