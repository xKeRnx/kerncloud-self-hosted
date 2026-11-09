'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {releaseContext,filesBelow,run,packagerIgnore,reportRelease}=require('./signing/common.cjs');
const {signWindows}=require('./signing/windows.cjs');
function nsisLiteral(value){if(/[\r\n$"'`%!&|<>^]/.test(value))throw Error('Unsafe characters in NSIS build path');return value.replaceAll('/','\\');}
async function main(){
 if(process.platform!=='win32')throw Error('Signed Windows builds require a Windows runner');
 const ctx=await releaseContext('windows'),{root,work,version,config}=ctx;
 await require('./configure-server.cjs').configureServer({root,publicRelease:true});
 await require('./prepare-updates.cjs').prepareUpdates({root});
 const {packager}=await import('@electron/packager');
 const [folder]=await packager({dir:root,out:path.join(work,'payload'),name:'KeRnCloud Bridge',executableName:'KeRnCloud Bridge',platform:'win32',arch:'x64',electronVersion:'45.0.0',appVersion:version,appCopyright:config.publisher.name,icon:path.join(root,'assets/icon.ico'),asar:false,prune:true,appBundleId:'de.kerncloud.bridge',win32metadata:{CompanyName:config.publisher.name,FileDescription:'KeRnCloud Bridge'},ignore:packagerIgnore()});
 for(const[src,dest]of [['README.de.md','ANLEITUNG.de.md'],['README.en.md','GUIDE.en.md'],['releases/bridge-anleitung-de.pdf','ANLEITUNG.de.pdf'],['releases/bridge-guide-en.pdf','GUIDE.en.pdf']])await fs.copyFile(path.join(root,src),path.join(folder,dest));
 const files=await filesBelow(folder);let size=0;const dirs=new Set(),proofs=[];
 for(const file of files){
  if(/\.(pfx|p12|p8|key|pem)$/i.test(file)||/(^|[\\/])\.signing([\\/]|$)/.test(file))throw Error('Credential material detected in payload');
  const target=path.join(folder,file);if(/\.(exe|dll|node)$/i.test(file))proofs.push(await signWindows(target,config,{work}));
  size+=(await fs.stat(target)).size;let dir=path.dirname(file);while(dir!=='.'){dirs.add(dir);dir=path.dirname(dir);}
 }
 if(!proofs.length)throw Error('No application binaries signed');
 const uninstall=path.join(work,'uninstall-files.nsh');
 await fs.writeFile(uninstall,files.map(f=>'Delete "$INSTDIR\\'+nsisLiteral(f)+'"').concat([...dirs].sort((a,b)=>b.length-a.length).map(f=>'RMDir "$INSTDIR\\'+nsisLiteral(f)+'"')).join('\n')+'\n');
 const setup=path.join(work,'kerncloud-bridge-'+version+'-windows-x64-setup.exe');
 for(const p of [process.execPath,path.join(root,'scripts/signing/windows.cjs')])nsisLiteral(p);
 const mk=process.env.BRIDGE_MAKENSIS||'makensis.exe';
 run(mk,['/V3','/WX','/DAPP_VERSION='+version,'/DAPP_FILES_DIR='+folder,'/DAPP_ICON='+path.join(root,'assets/icon.ico'),'/DOUTPUT_FILE='+setup,'/DUNINSTALL_FILES='+uninstall,'/DAPP_SIZE_KB='+Math.ceil(size/1024),'/DBRIDGE_SIGN_NODE='+process.execPath,'/DBRIDGE_SIGN_SCRIPT='+path.join(root,'scripts/signing/windows.cjs'),path.join(root,'installer/windows.nsi')]);
 const setupProof=await signWindows(setup,config,{work});
 const portable=path.join(work,'kerncloud-bridge-'+version+'-win32-x64.zip');
 run('powershell.exe',['-NoProfile','-NonInteractive','-File',path.join(root,'scripts/signing/zip-windows.ps1'),'-Source',folder,'-Destination',portable]);
 await reportRelease(ctx,'windows',[{path:setup,format:'exe',kind:'installer',platform:'win32',arch:'x64',label:'Windows',primary:true,signed:true,notarized:false},{path:portable,format:'zip',kind:'portable',platform:'win32',arch:'x64',label:'Windows',primary:false,signed:true,notarized:false}],{verified:true,authenticode:'trusted publisher, timestamp and SignTool /pa /all',signed_payload_binaries:proofs.length,uninstaller:'NSIS uninstfinalize, failure aborts compilation',publisher_subject:setupProof.subject});
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={main,nsisLiteral};
