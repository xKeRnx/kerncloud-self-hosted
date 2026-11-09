'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {verifyFeed,fileHash,APP_ID,compare}=require('../updater.cjs');
async function adoptReports(root,manifest,reports){
 for(const reportFile of reports){
  const report=JSON.parse(await fs.readFile(reportFile,'utf8'));
  if(report.mode!=='signed'||report.verification?.verified!==true||report.publisher?.name!=='KeRn-WS'||compare(report.version,manifest.version)<0||!Array.isArray(report.artifacts))throw Error('Unverified release report');
  const candidates=report.artifacts.filter(a=>['exe','zip','dmg','deb'].includes(a.format));
  for(const a of candidates){const name=path.basename(a.path);if(!/^kerncloud-bridge-[a-zA-Z0-9.-]+$/.test(name)||!name.startsWith('kerncloud-bridge-'+report.version+'-')||!name.endsWith('.'+a.format)||!['win32','darwin','linux'].includes(a.platform)||!['x64','arm64'].includes(a.arch)||await fileHash(a.path,'sha256')!==a.sha256||(await fs.stat(a.path)).size!==a.bytes)throw Error('Invalid release artifact report');
   const dest=path.join(root,'releases',name);try{await fs.copyFile(a.path,dest,require('node:fs').constants.COPYFILE_EXCL);}catch(e){if(e.code!=='EEXIST'||await fileHash(dest,'sha256')!==a.sha256)throw Error('Never overwrite a distributed artifact; increment the version');}
   manifest.files=manifest.files.filter(f=>f.name!==name);const {path:privatePath,...entry}=a;manifest.files.push({...entry,name,version:report.version});
  }
  manifest.version=report.version;
 }
 return manifest;
}
async function publishUpdates({root=path.resolve(__dirname,'..'),keyFile=process.env.BRIDGE_UPDATE_PRIVATE_KEY,now=Date.now(),reports=[]}={}){
 if(!keyFile||!path.isAbsolute(keyFile))throw Error('BRIDGE_UPDATE_PRIVATE_KEY must reference an operator key outside Bridge source');
 const relative=path.relative(root,path.resolve(keyFile));if(!relative.startsWith('..')&&!path.isAbsolute(relative))throw Error('Private update keys must stay outside packaged source');
 const key=crypto.createPrivateKey(await fs.readFile(keyFile));if(key.asymmetricKeyType!=='ed25519')throw Error('Expected Ed25519 private key');
 const publicKey=crypto.createPublicKey(key),keyId=crypto.createHash('sha256').update(publicKey.export({type:'spki',format:'der'})).digest('hex').slice(0,32);
 const trust=JSON.parse(await fs.readFile(path.join(root,'update-trust.json'),'utf8'));
 if(!trust.keys.some(k=>k.id===keyId))throw Error('Signing key is not trusted by this release');
 const manifest=await adoptReports(root,JSON.parse(await fs.readFile(path.join(root,'releases/manifest.json'),'utf8')),reports),files=[];
 for(const entry of manifest.files.filter(f=>f.version===manifest.version&&((f.platform==='win32'&&f.format==='exe')||(f.platform==='linux'&&f.format==='deb')||(f.platform==='darwin'&&f.format==='zip'&&f.signed===true&&f.notarized===true)))){
  if(!/^kerncloud-bridge-[a-zA-Z0-9.-]+$/.test(entry.name))throw Error('Invalid artifact name');
  const file=path.join(root,'releases',entry.name),stat=await fs.stat(file);
  if(stat.size!==entry.bytes||await fileHash(file,'sha256')!==entry.sha256)throw Error('Unverified release artifact');
  files.push({name:entry.name,platform:entry.platform,arch:entry.arch,format:entry.format,bytes:entry.bytes,sha256:entry.sha256,sha512:await fileHash(file,'sha512'),signed:entry.signed===true,notarized:entry.notarized===true});
 }
 if(!files.length)throw Error('No update-compatible artifacts');
 const payload=JSON.stringify({schema:1,appId:APP_ID,channel:'stable',version:manifest.version,issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+90*86400000).toISOString(),files});
 const envelope={keyId,payload,signature:crypto.sign(null,Buffer.from(payload),key).toString('base64')};verifyFeed(envelope,trust,{now});
 if(reports.length){const file=path.join(root,'releases/manifest.json');await fs.writeFile(file+'.tmp',JSON.stringify(manifest,null,2)+'\n');await fs.rename(file+'.tmp',file);}
 const dest=path.join(root,'releases/updates.json');await fs.writeFile(dest+'.tmp',JSON.stringify(envelope,null,2)+'\n');await fs.rename(dest+'.tmp',dest);
 console.log(JSON.stringify({ok:true,version:manifest.version,updateTargets:files.map(f=>f.platform+'/'+f.arch)}));return envelope;
}
module.exports={publishUpdates,adoptReports};
if(require.main===module){const reports=[];for(let i=2;i<process.argv.length;i++){if(process.argv[i]!=='--release-report'||!process.argv[i+1])throw Error('Use --release-report PATH');reports.push(process.argv[++i]);}publishUpdates({reports}).catch(e=>{console.error(e.message);process.exitCode=1;});}
