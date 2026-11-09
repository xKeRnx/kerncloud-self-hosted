import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  DockerEngine,
  executeDockerJob,
} from "../src/infrastructure/docker.ts";
const engine = new DockerEngine(),
  host = randomUUID();
const password = "local-fixture-password-not-a-user-account";
async function exec(container: string, command: string[]) {
  const { Id } = await engine.request("POST", `/containers/${container}/exec`, {
    Cmd: command,
    User: "1000:1000",
    AttachStderr: true,
  });
  await engine.request("POST", `/exec/${Id}/start`, {
    Detach: false,
    Tty: false,
  });
  return (await engine.request("GET", `/exec/${Id}/json`)).ExitCode;
}
for (const kind of ["development", "browser"]) {
  const id = randomUUID();
  const job = {
    id: randomUUID(),
    environmentId: id,
    action: "deploy" as const,
    generation: 1,
    lease: randomUUID(),
    spec: {
      id: kind,
      image: `kerncloud-${kind}:0.2`,
      command: [],
      cpu: 2,
      memory_mb: 2048,
      container_port: 8080,
      network: true,
      user_id: "1000:1000",
      read_only: true,
      accessPassword: password,
    },
  };
  try {
    const result = await executeDockerJob(engine, host, job);
    if (!result.endpoint) {
      const d = await engine.request(
        "GET",
        `/containers/${result.resourceId}/json`,
      );
      console.log({ kind, state: d.State, ports: d.NetworkSettings?.Ports });
    }
    assert.match(result.endpoint!, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    const check =
      kind === "browser"
        ? [
            "python3",
            "-c",
            `import urllib.request,urllib.error,base64,subprocess
url='http://127.0.0.1:8080/vnc.html'
try:
 urllib.request.urlopen(url,timeout=3)
 raise Exception('Missing authentication')
except urllib.error.HTTPError as e:
 assert e.code==401
req=urllib.request.Request(url,headers={'Authorization':'Basic '+base64.b64encode(b'kerncloud:${password}').decode()})
assert urllib.request.urlopen(req,timeout=5).status==200
subprocess.run(['pgrep','-x','firefox-esr'],stdout=subprocess.DEVNULL,check=True)
`,
          ]
        : [
            "/usr/lib/code-server/lib/node",
            "-e",
            `(async()=>{const origin='http://127.0.0.1:8080';const first=await fetch(origin,{redirect:'manual'});if(first.status!==302||!first.headers.get('location')?.includes('/login'))process.exit(2);const signed=await fetch(origin+'/login',{method:'POST',body:new URLSearchParams({password:'${password}'}),redirect:'manual'});const cookie=signed.headers.get('set-cookie');if(!cookie||signed.status!==302)process.exit(3);const page=await fetch(origin,{headers:{cookie},redirect:'follow',signal:AbortSignal.timeout(10000)});if(page.status!==200||page.url.includes('/login'))process.exit(4);})().catch(()=>process.exit(5))`,
          ];
    let code: number | null = null;
    for (let i = 0; i < 45; i++) {
      const state = (
        await engine.request("GET", `/containers/${result.resourceId}/json`)
      ).State;
      assert.equal(
        state.Running,
        true,
        `${kind}: container exited with ${state.ExitCode}`,
      );
      code = await exec(result.resourceId, check);
      if (code === 0) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    assert.equal(
      code,
      0,
      `${kind}: password-protected web service or application did not become ready (exit ${code}).`,
    );
    console.log(
      `${kind}: non-root, read-only, private volume, loopback port and password-protected web application verified.`,
    );
  } finally {
    await executeDockerJob(engine, host, {
      ...job,
      id: randomUUID(),
      action: "delete",
    });
  }
}
console.log(
  "Browser/dev test resources removed; no customer environments or accounts modified.",
);
