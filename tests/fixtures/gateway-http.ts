import http from "node:http";
// Node's fetch ignores Host overrides. These tests connect to loopback/Docker DNS
// while exercising the same environment Host header a real browser sends.
export async function gatewayHttp(
  url: string,
  headers: Record<string, string>,
) {
  const target = new URL(url);
  if (
    target.protocol !== "http:" ||
    !["127.0.0.1", "test-gateway"].includes(target.hostname)
  )
    throw new Error("Local gateway fixture only");
  return new Promise<Response>((resolve, reject) => {
    const req = http.request(target, { headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(Buffer.from(c)));
      res.on("end", () => {
        const values = new Headers();
        for (const [name, value] of Object.entries(res.headers)) {
          if (Array.isArray(value))
            for (const item of value) values.append(name, item);
          else if (value !== undefined) values.set(name, value);
        }
        resolve(
          new Response(new Uint8Array(Buffer.concat(chunks)), {
            status: res.statusCode,
            headers: values,
          }),
        );
      });
      res.on("error", reject);
    });
    req.setTimeout(15000, () =>
      req.destroy(new Error("Gateway fixture timeout")),
    );
    req.on("error", reject);
    req.end();
  });
}
