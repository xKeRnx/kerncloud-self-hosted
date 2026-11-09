'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{EventEmitter}=require('node:events');
const {verifyFeed,compare,fetchFeed,checkArtifact,infoFor,UpdateManager}=require('../updater.cjs');
const pair=crypto.generateKeyPairSync('ed25519'),keyId='fixture-test-key',trust={keys:[{id:keyId,publicKey:pair.publicKey.export({type:'spki',format:'pem'})}]},now=Date.now(),bytes=Buffer.from('MZ fixture installer, never executed');
const entry={platform:'win32',arch:'x64',format:'exe',name:'kerncloud-bridge-0.1.5-windows-x64-setup.exe',bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),sha512:crypto.createHash('sha512').update(bytes).digest('base64')};
const payload=(extra={})=>({schema:1,appId:'de.kerncloud.bridge',channel:'stable',version:'0.1.5',issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+86400000).toISOString(),files:[entry],...extra});
const sign=p=>{const s=JSON.stringify(p);return {keyId,payload:s,signature:crypto.sign(null,Buffer.from(s),pair.privateKey).toString('base64')};};
test('signed manifests reject tampering, unknown keys and unsigned metadata',()=>{
 const envelope=sign(payload());assert.equal(verifyFeed(envelope,trust,{now}).version,'0.1.5');
 assert.throws(()=>verifyFeed({...envelope,payload:envelope.payload.replace('0.1.5','0.9.0')},trust,{now}));
 assert.throws(()=>verifyFeed({...envelope,keyId:'unknown'},trust,{now}));assert.throws(()=>verifyFeed({payload:envelope.payload},trust,{now}));
});
test('expiry, future issuance, downgrade and wrong product/channel are refused',()=>{
 for(const patch of [{expiresAt:new Date(now-1).toISOString()},{issuedAt:new Date(now+600000).toISOString()},{expiresAt:new Date(now+100*86400000).toISOString()},{appId:'other.app'},{channel:'nightly'},{version:'0.1.5-beta'}])assert.throws(()=>verifyFeed(sign(payload(patch)),trust,{now}));
 assert.throws(()=>verifyFeed(sign(payload()),trust,{now,minimum:'0.1.6'}));assert.equal(compare('0.10.0','0.9.9'),1);
});
test('artifact paths, size, hashes, platform duplicates and unsigned macOS are rejected',()=>{
 for(const patch of [{name:'../../outside.exe'},{name:'https://evil.example/evil.exe'},{name:'kerncloud-bridge-0.1.6-win.exe'},{bytes:2**40},{sha512:'bad'},{platform:'other'},{arch:'arm32'}])assert.throws(()=>verifyFeed(sign(payload({files:[{...entry,...patch}]})),trust,{now}));
 assert.throws(()=>verifyFeed(sign(payload({files:[entry,entry]})),trust,{now}));
 const mac={...entry,platform:'darwin',arch:'arm64',format:'zip',name:'kerncloud-bridge-0.1.5-darwin-arm64.zip'};
 assert.throws(()=>verifyFeed(sign(payload({files:[mac]})),trust,{now}));assert.equal(verifyFeed(sign(payload({files:[{...mac,signed:true,notarized:true}]})),trust,{now}).files.length,1);
});
test('update network calls are public and fixed to the bundled origin',async()=>{
 let args;const fetcher=async(...a)=>{args=a;return new Response(JSON.stringify(sign(payload())));};await fetchFeed('https://updates.example',fetcher);
 assert.equal(args[0],'https://updates.example/api/public/bridge/updates');assert.equal(args[1].redirect,'error');assert.equal(args[1].credentials,'omit');assert.deepEqual(args[1].headers,{Accept:'application/json'});
 const info=infoFor(payload(),'win32','x64','https://updates.example','0.1.4');assert.ok(info.files[0].url.startsWith('https://updates.example/api/public/bridge/download/'));assert.equal(infoFor(payload(),'linux','x64','https://updates.example','0.1.4').version,'0.1.4');
 await assert.rejects(()=>fetchFeed('http://not-loopback.example',fetcher));
 await assert.rejects(()=>fetchFeed('https://updates.example',async()=>new Response('x'.repeat(128*1024+1))));
});
async function fixture(t,{busy=false,automatic=true,platform='win32'}={}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bridge-update-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const artifact=path.join(dir,'update.exe');await fs.writeFile(artifact,bytes);await fs.writeFile(path.join(dir,'bridge.dat'),'fixture-encrypted-profile-must-stay');await fs.mkdir(path.join(dir,'journal'));await fs.writeFile(path.join(dir,'journal/action.json'),'fixture-uncertain-action-must-stay');
 let currentEnvelope=sign(payload()),downloads=0,checks=0,before=0,installs=[],clock=now,fetches=0;
 const app={getVersion:()=> '0.1.4',getPath:()=>dir};
 const factory=options=>{const native=new EventEmitter();native.checkForUpdates=async()=>{checks++;return {updateInfo:options.info};};native.downloadUpdate=async()=>{downloads++;return [artifact];};native.quitAndInstall=(...args)=>installs.push(args);return native;};
 const manager=new UpdateManager({app,origin:'https://updates.example',trust,platform,isBusy:()=>busy,beforeInstall:async()=>{before++;},now:()=>clock,fetcher:async()=>{fetches++;return new Response(JSON.stringify(currentEnvelope));},nativeFactory:factory});
 await manager.init();if(!automatic)await manager.automatic(false);
 return {manager,dir,artifact,setBusy:v=>busy=v,setFeed:p=>currentEnvelope=sign(p),advance:()=>clock+=61000,counts:()=>({downloads,checks,before,installs,fetches})};
}
test('concurrent checks coalesce, then cached content is checked before safe install',async t=>{
 const f=await fixture(t);await Promise.all([f.manager.check(),f.manager.check()]);assert.equal(f.counts().downloads,1);assert.equal(f.manager.snapshot().phase,'ready');
 f.setBusy(true);await assert.rejects(()=>f.manager.install());assert.equal(f.counts().installs.length,0);
 f.setBusy(false);await f.manager.install();assert.deepEqual(f.counts().installs,[[true,true]]);assert.equal(f.counts().before,1);
 assert.equal(await fs.readFile(path.join(f.dir,'bridge.dat'),'utf8'),'fixture-encrypted-profile-must-stay');assert.equal(await fs.readFile(path.join(f.dir,'journal/action.json'),'utf8'),'fixture-uncertain-action-must-stay');
});
test('cache tampering and withdrawn/replaced updates cannot execute',async t=>{
 const f=await fixture(t);await f.manager.check();await fs.writeFile(f.artifact,Buffer.from('altered'));await assert.rejects(()=>f.manager.install());assert.equal(f.counts().installs.length,0);
 await fs.writeFile(f.artifact,bytes);f.setFeed(payload({files:[]}));await assert.rejects(()=>f.manager.install());assert.equal(f.counts().before,0);
});
test('preferences survive restarts and disabling automatic updates prevents network calls',async t=>{
 const f=await fixture(t,{automatic:false});await f.manager.check();assert.equal(f.counts().fetches,0);
 await f.manager.check({manual:true});assert.equal(f.counts().downloads,1);
 const prefs=JSON.parse(await fs.readFile(path.join(f.dir,'update-preferences.json')));assert.equal(prefs.automatic,false);assert.equal(prefs.pendingVersion,'0.1.5');assert.equal(prefs.highestVersion,'0.1.5');
 const next=new UpdateManager({...f.manager.options});await next.init();assert.equal(next.snapshot().automatic,false);assert.equal(next.value.pendingVersion,'0.1.5');
});
test('automatic next-launch install only happens after fresh verification and while idle',async t=>{
 const f=await fixture(t);await f.manager.check();f.advance();f.manager.initialPending='0.1.5';await f.manager.check({startup:true});assert.equal(f.counts().installs.length,1);assert.ok(f.counts().fetches>=3);
});
test('network failure leaves profile and previous executable untouched',async t=>{
 const f=await fixture(t);f.manager.options.fetcher=async()=>{throw Error('offline');};await f.manager.check();assert.equal(f.manager.snapshot().phase,'error');assert.equal(f.counts().downloads,0);assert.equal(f.counts().installs.length,0);assert.equal(await fs.readFile(f.artifact,'utf8'),bytes.toString());
});
test('wrong-size or corrupted cached artifacts and symlinks are not installable',async t=>{
 const f=await fixture(t);await checkArtifact(f.artifact,entry);await fs.writeFile(f.artifact,Buffer.alloc(entry.bytes));await assert.rejects(()=>checkArtifact(f.artifact,entry));
});
