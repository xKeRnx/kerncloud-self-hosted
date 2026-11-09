'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'../..');
const PUBLISHER=Object.freeze({name:'KeRn-WS',website:'https://kern-ws.com',email:'support@kern-ws.com',businessType:'sole-proprietor'});
function required(value,label){if(typeof value!=='string'||!value.trim()||/[\r\n\0]/.test(value))throw Error('Missing or invalid '+label);return value;}
function releaseMode(env=process.env){const mode=env.BRIDGE_RELEASE_MODE??'preview';if(!['preview','signed'].includes(mode))throw Error('BRIDGE_RELEASE_MODE must be preview or signed');return mode;}
function assertNoSecrets(value){for(const[k,v]of Object.entries(value??{})){if(/password|passphrase|private.?key|client.?secret|access.?token/i.test(k))throw Error('Secrets belong in the OS key store or CI secret store, not signing configuration');if(v&&typeof v==='object')assertNoSecrets(v);}}
async function loadConfig(env=process.env,root=ROOT){
 const configured=env.BRIDGE_SIGNING_CONFIG,file=configured?path.resolve(configured):path.join(root,'.signing/config.json');
 let config;try{config=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT'||configured||releaseMode(env)==='signed')throw Error('Signing configuration missing or unreadable; copy signing.example.json to .signing/config.json');config=JSON.parse(await fs.readFile(path.join(root,'signing.example.json'),'utf8'));}
 assertNoSecrets(config);config.publisher={...PUBLISHER,...config.publisher};for(const k of ['name','website','email'])required(config.publisher[k],'publisher.'+k);return config;
}
function validateConfig(config,platform){
 if(platform==='windows'){
  const c=config.windows??{};required(c.signtool,'windows.signtool');required(c.expectedSubject,'windows.expectedSubject');
  const timestamp=new URL(required(c.timestampUrl,'windows.timestampUrl'));
  if(timestamp.username||timestamp.password||timestamp.hash||timestamp.search||(timestamp.protocol!=='https:'&&!(timestamp.protocol==='http:'&&['timestamp.acs.microsoft.com','timestamp.digicert.com'].includes(timestamp.hostname))))throw Error('Use an HTTPS timestamp service or the documented Microsoft/DigiCert HTTP timestamp endpoint');
  if(c.provider==='azure'){
   const a=c.azure??{};const u=new URL(required(a.endpoint,'windows.azure.endpoint'));
   if(u.protocol!=='https:'||!/^https:\/\/[a-z0-9-]+\.codesigning\.azure\.net\/?$/.test(a.endpoint))throw Error('Invalid Azure Artifact Signing endpoint');
   for(const k of ['account','profile'])if(!/^[a-zA-Z0-9-]+$/.test(required(a[k],'windows.azure.'+k)))throw Error('Invalid Azure account/profile');required(a.dlib,'windows.azure.dlib');
  }else if(c.provider==='certificate-store'){
   if(!/^[a-fA-F0-9]{40}$/.test(required(c.certificateStore?.thumbprint,'windows.certificateStore.thumbprint')))throw Error('Use the exact certificate SHA-1 thumbprint');
   if(!['My'].includes(c.certificateStore.store)||typeof c.certificateStore.machineStore!=='boolean')throw Error('Invalid Windows certificate store');
  }else throw Error('windows.provider must be azure or certificate-store');
 }else if(platform==='macos'){
  const c=config.macos??{};if(!/^Developer ID Application: .+ \([A-Z0-9]{10}\)$/.test(required(c.identity,'macos.identity')))throw Error('A Developer ID Application identity is required; ad-hoc signing is not accepted');
  if(!/^[A-Z0-9]{10}$/.test(required(c.teamId,'macos.teamId'))||!c.identity.endsWith('('+c.teamId+')'))throw Error('macOS identity and Team ID must match');required(c.notaryProfile,'macos.notaryProfile');
 }else if(platform==='linux'){
  const c=config.linux??{};if(!/^(?:[A-Fa-f0-9]{40}|[A-Fa-f0-9]{64})$/.test(required(c.fingerprint,'linux.fingerprint')))throw Error('Use the complete OpenPGP fingerprint, not a short key ID');
  for(const k of ['gpg','gpgv'])required(c[k],'linux.'+k);
  const u=new URL(required(c.repositoryUrl,'linux.repositoryUrl'));if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw Error('APT repository URL must use HTTPS without credentials');
  for(const k of ['suite','component'])if(!/^[a-z0-9][a-z0-9-]*$/.test(required(c[k],'linux.'+k)))throw Error('Invalid APT suite/component');
  if(!Number.isInteger(c.validDays)||c.validDays<1||c.validDays>90)throw Error('APT validDays must be between 1 and 90');
 }else throw Error('Unknown signing platform');
 return config;
}
function toolEnv(bin,source=process.env){const env={...source};if(path.basename(bin).toLowerCase()==='powershell.exe')for(const k of Object.keys(env))if(k.toLowerCase()==='psmodulepath')delete env[k];return env;}
function run(bin,args,options={}){
 const {returnStderr=false,...rest}=options;
 // PowerShell 7's inherited module path can break Windows PowerShell 5.1's built-in Authenticode/ZIP commands.
 const result=spawnSync(bin,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true,maxBuffer:16*1024*1024,...rest,env:toolEnv(bin,rest.env??process.env)});
 if(result.error||result.status!==0)throw Error('Release tool failed: '+path.basename(bin)+'; no unsigned fallback. Check local tool/account configuration.');
 return returnStderr?result.stderr:result.stdout;
}
async function sha256(file){const hash=crypto.createHash('sha256');const {createReadStream}=require('node:fs');for await(const b of createReadStream(file))hash.update(b);return hash.digest('hex');}
async function filesBelow(folder,relative=''){let files=[];for(const e of await fs.readdir(path.join(folder,relative),{withFileTypes:true})){const p=path.join(relative,e.name);if(e.isSymbolicLink())throw Error('Symbolic links not allowed in Windows/Linux release input');if(e.isDirectory())files.push(...await filesBelow(folder,p));else if(e.isFile())files.push(p);}return files;}
async function assertOutsideSource(file,root=ROOT){const resolved=path.resolve(file),rel=path.relative(root,resolved);if(!rel.startsWith('..')&&!path.isAbsolute(rel))throw Error('Signing credentials must stay outside packaged source');return resolved;}
function packagerIgnore(){return [/^\/(dist[^/]*|releases|tests|scripts|installer|package-lock\.json|signing\.example\.json|SIGNING\.md|BUILD\.md|UPDATES\.md)(\/|$)/,/^\/\./,/\.(pfx|p12|p8|key|pem)$/i];}
async function releaseContext(platform,{root=ROOT,env=process.env}={}){
 if(releaseMode(env)!=='signed')throw Error('Set BRIDGE_RELEASE_MODE=signed explicitly for a signed release');
 const config=validateConfig(await loadConfig(env,root),platform),pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
 for(const value of [config.macos?.keychain,config.macos?.notaryKeychain,config.linux?.gnupgHome].filter(Boolean))await assertOutsideSource(value,root);
 if(!/^\d+\.\d+\.\d+$/.test(pkg.version))throw Error('Release requires a numeric three-part version');
 const out=path.join(root,'dist-signing',platform,pkg.version);await fs.mkdir(out,{recursive:true});const work=await fs.mkdtemp(path.join(out,'build-'));
 return {root,config,version:pkg.version,out,work};
}
async function reportRelease(ctx,platform,artifacts,verification){
 if(!verification?.verified)throw Error('Release verification must succeed before writing a signed manifest');
 const entries=[];for(const a of artifacts){const stat=await fs.stat(a.path);entries.push({...a,path:path.resolve(a.path),bytes:stat.size,sha256:await sha256(a.path)});}
 const report={schema:1,mode:'signed',platform,version:ctx.version,publisher:ctx.config.publisher,verified_at:new Date().toISOString(),verification,artifacts:entries,published:false};
 const file=path.join(ctx.work,'release.json');await fs.writeFile(file,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 console.log('Verified '+platform+' release candidate: '+file+' (not published)');return report;
}
module.exports={ROOT,PUBLISHER,required,releaseMode,loadConfig,validateConfig,toolEnv,run,sha256,filesBelow,assertOutsideSource,packagerIgnore,releaseContext,reportRelease};
