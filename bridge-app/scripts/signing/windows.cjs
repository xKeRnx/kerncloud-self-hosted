'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {run,validateConfig,loadConfig,releaseMode}=require('./common.cjs');
function assertWindowsProof(proof,c){if(proof.status!=='Valid'||proof.subject!==c.expectedSubject||proof.timestamped!==true)throw Error('Windows signature must be trusted, timestamped and match the configured publisher');if(c.provider==='certificate-store'&&proof.thumbprint?.toLowerCase()!==c.certificateStore.thumbprint.toLowerCase())throw Error('Unexpected signing certificate');return proof;}
async function verifyWindows(file,config,{runner=run,platform=process.platform}={}){
 if(platform!=='win32')throw Error('Windows signature trust verification requires Windows');
 validateConfig(config,'windows');await fs.access(file);
 runner(config.windows.signtool,['verify','/pa','/all','/v',file]);
 const proof=JSON.parse(runner('powershell.exe',['-NoProfile','-NonInteractive','-File',path.join(__dirname,'verify-windows.ps1'),'-File',file]));
 return assertWindowsProof(proof,config.windows);
}
async function signWindows(file,config,{runner=run,platform=process.platform,work=path.dirname(file)}={}){
 if(platform!=='win32')throw Error('Windows signing requires a Windows signing runner');validateConfig(config,'windows');
 const c=config.windows,bytes=await fs.readFile(file);if(bytes.subarray(0,2).toString()!=='MZ')throw Error('Only PE binaries can be Authenticode signed');
 const args=['sign','/fd','SHA256','/tr',c.timestampUrl,'/td','SHA256'];let metadata;
 try{
  if(c.provider==='azure'){
   metadata=path.join(work,'artifact-signing-'+require('node:crypto').randomUUID()+'.json');
   await fs.writeFile(metadata,JSON.stringify({Endpoint:c.azure.endpoint,CodeSigningAccountName:c.azure.account,CertificateProfileName:c.azure.profile}),{flag:'wx',mode:0o600});
   args.push('/dlib',c.azure.dlib,'/dmdf',metadata);
  }else{args.push('/sha1',c.certificateStore.thumbprint,'/s',c.certificateStore.store);if(c.certificateStore.machineStore)args.push('/sm');}
  runner(c.signtool,[...args,file]);return await verifyWindows(file,config,{runner,platform});
 }finally{if(metadata)await fs.unlink(metadata);}
}
async function main(){if(releaseMode()!=='signed')throw Error('Uninstaller signing requires BRIDGE_RELEASE_MODE=signed');const file=process.argv[2];if(!file)throw Error('Expected a PE file');await signWindows(path.resolve(file),await loadConfig());}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={signWindows,verifyWindows,assertWindowsProof};
