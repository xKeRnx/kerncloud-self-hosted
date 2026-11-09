'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {configuredOrigin,connectionSettings,enrollmentOrigin}=require('../connection.cjs');
const {configureServer}=require('../scripts/configure-server.cjs');
test('default connection uses the bundled server, custom server is explicit',()=>{
 const origin=configuredOrigin({schema:1,defaultOrigin:'https://cloud.example.com/'});
 assert.equal(origin,'https://cloud.example.com');
 assert.equal(enrollmentOrigin({origin:'https://other.example.com'},origin),origin);
 assert.equal(enrollmentOrigin({customServer:'true',origin:'https://other.example.com'},origin),origin);
 assert.equal(enrollmentOrigin({customServer:true,origin:' https://other.example.com/ '},origin),'https://other.example.com');
 assert.deepEqual(connectionSettings('',origin),{origin,defaultOrigin:origin,customServer:false});
 assert.deepEqual(connectionSettings('https://saved.example.com',origin),{origin:'https://saved.example.com',defaultOrigin:origin,customServer:true});
});
test('reject invalid destinations before an enrollment request can start',()=>{
 for(const url of ['','http://example.com','https://user:pass@example.com','https://example.com/path','https://example.com/?key=secret','https://example.com/#fragment','file:///tmp','javascript:alert(1)']){
  assert.throws(()=>configuredOrigin({schema:1,defaultOrigin:url}));
  assert.throws(()=>enrollmentOrigin({customServer:true,origin:url},'https://cloud.example.com'));
 }
 assert.throws(()=>configuredOrigin({schema:2,defaultOrigin:'https://example.com'}));
 assert.equal(configuredOrigin({schema:1,defaultOrigin:'http://localhost:3100'}),'http://localhost:3100');
 assert.throws(()=>configuredOrigin({schema:1,defaultOrigin:'http://localhost:3100'},{publicRelease:true}));
});
test('all packaging modes can use deployment configuration without environment secrets',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'bridge-server-'));
 try{
  await fs.writeFile(path.join(root,'server.json'),JSON.stringify({schema:1,defaultOrigin:'http://localhost:3100'}));
  assert.equal(await configureServer({root,env:{PUBLIC_URL:'https://deployment.example.com/'}}),'https://deployment.example.com');
  assert.equal(await configureServer({root,env:{PUBLIC_URL:'https://wrong.example.com',BRIDGE_DEFAULT_ORIGIN:'https://override.example.com',API_KEY:'never-bundle'},publicRelease:true}),'https://override.example.com');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root,'server.json'),'utf8')),{schema:1,defaultOrigin:'https://override.example.com'});
  assert.equal(await configureServer({root,env:{}}),'https://override.example.com');
  await assert.rejects(()=>configureServer({root,env:{PUBLIC_URL:''}}));
  await assert.rejects(()=>configureServer({root,env:{BRIDGE_DEFAULT_ORIGIN:'http://127.0.0.1:3100'},publicRelease:true}));
  assert.equal(JSON.parse(await fs.readFile(path.join(root,'server.json'),'utf8')).defaultOrigin,'https://override.example.com');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
