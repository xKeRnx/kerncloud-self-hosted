import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { main, prepare, dockerArgs, projectRoot } from "./self-host.mjs";
import { runProcess } from "./local-process.mjs";

// This test must never initialize or mutate a customer installation.
assert.equal(process.env.CI, "true");
assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
assert.equal(path.resolve(process.env.GITHUB_WORKSPACE), projectRoot);
assert.equal(fs.existsSync(path.join(projectRoot, ".env")), false);
const { config } = prepare(projectRoot, {
  database: "kerncloud_image_lifecycle_test",
  project: "kerncloud-image-lifecycle",
  port: 46100,
  gatewayPort: 46200,
});
const fingerprint = () =>
  createHash("sha256")
    .update(fs.readFileSync(path.join(projectRoot, ".env")))
    .digest("hex");
const before = fingerprint();
const fixture = async (seed) => {
  const script = `
    import pg from 'pg';import {randomUUID,createHash} from 'node:crypto';import {encrypt} from './src/server/security.ts';
    if(!new URL(process.env.DATABASE_URL).pathname.endsWith('_test'))throw Error('Disposable database required');
    const p=new pg.Pool({connectionString:process.env.DATABASE_URL});
    try {
      const w=(await p.query('SELECT id FROM workspaces w WHERE EXISTS(SELECT 1 FROM agents a WHERE a.workspace_id=w.id) ORDER BY created_at LIMIT 1')).rows[0].id;
      if(${JSON.stringify(seed)}){
        const project=(await p.query('SELECT id FROM workspace_projects WHERE workspace_id=$1 LIMIT 1',[w])).rows[0].id;
        const agent=(await p.query('SELECT id FROM agents WHERE workspace_id=$1 LIMIT 1',[w])).rows[0].id;
        const model=randomUUID(),host=randomUUID(),env=randomUUID(),run=randomUUID(),task=randomUUID();
        await p.query("INSERT INTO model_offerings(id,workspace_id,name,provider_name,endpoint,model,secret,input_rate,output_rate,active,monitor_enabled) VALUES($1,$2,'image-lifecycle-fixture','Fixture','https://fixture.invalid/v1','fixture',$3,0,0,false,false)",[model,w,encrypt('isolated-image-fixture-secret')]);
        await p.query("INSERT INTO infrastructure_hosts(id,name,kind,token_hash,enabled) VALUES($1,'image-lifecycle-fixture','docker','fixture-only',false)",[host]);
        await p.query("INSERT INTO customer_environments(id,workspace_id,project_id,host_id,template_id,name,status,self_service,agent_permissions,agent_ids) VALUES($1,$2,$3,$4,'development','image-lifecycle-fixture','stopped',false,$5,$6)",[env,w,project,host,JSON.stringify(['files','exec']),JSON.stringify([agent])]);
        await p.query("INSERT INTO runs(id,workspace_id,project_id,goal,status,max_steps) VALUES($1,$2,$3,'Image lifecycle fixture','completed',10)",[run,w,project]);
        await p.query("INSERT INTO tasks(id,run_id,workspace_id,agent_id,title,instructions,status) VALUES($1,$2,$3,$4,'Fixture','Fixture','completed')",[task,run,w,agent]);
        await p.query("INSERT INTO artifacts(id,workspace_id,run_id,task_id,name,content) VALUES($1,$2,$3,$4,'image-lifecycle-fixture.txt','Persistent project result')",[randomUUID(),w,run,task]);
      }
      const value=(await p.query("SELECT json_build_object('model',(SELECT secret FROM model_offerings WHERE name='image-lifecycle-fixture'),'grants',(SELECT json_build_object('permissions',agent_permissions,'agents',agent_ids) FROM customer_environments WHERE name='image-lifecycle-fixture'),'file',(SELECT content FROM artifacts WHERE name='image-lifecycle-fixture.txt')) AS value")).rows[0].value;
      if(!value.model||!value.grants||!value.file)throw Error('Missing fixture state');
      console.log(createHash('sha256').update(JSON.stringify(value)).digest('hex'));
    }finally{await p.end();}`;
  const result = await runProcess(
    "docker",
    dockerArgs(
      config,
      "exec",
      "-T",
      "app",
      "node",
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      script,
    ),
    { cwd: projectRoot, capture: true },
  );
  assert.equal(
    result.status,
    0,
    "Isolated fixture execution failed: " +
      result.stderr
        .replace(/postgresql:\/\/[^\s]+/g, "[redacted]")
        .slice(-3000),
  );
  assert.match(result.stdout.trim(), /^[a-f0-9]{64}$/);
  return result.stdout.trim();
};
try {
  await main(["start"]);
  const health = await (
    await fetch("http://localhost:46100/api/health")
  ).json();
  assert.equal(health.service, "kerncloud");
  const original = await fixture(true);
  await main(["update"]);
  assert.equal(await fixture(false), original);
  assert.equal(fingerprint(), before);
  await main(["rollback"]);
  assert.equal(await fixture(false), original);
  assert.equal(fingerprint(), before);
  fs.mkdirSync(".release", { recursive: true });
  fs.writeFileSync(
    ".release/container-lifecycle-proof.json",
    JSON.stringify(
      {
        ok: true,
        version: health.version,
        installation: true,
        update: true,
        sameSchemaRollback: true,
        encryptedCredentialsPreserved: true,
        environmentGrantsPreserved: true,
        artifactPreserved: true,
        configurationPreserved: true,
      },
      null,
      2,
    ),
  );
} finally {
  await main(["stop"]);
}
