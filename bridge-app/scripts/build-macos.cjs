'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {run,releaseContext,packagerIgnore,reportRelease}=require('./signing/common.cjs');
const {verifyMacApp,notarizeAndStaple}=require('./signing/macos.cjs');
async function main(){
 if(process.platform!=='darwin')throw Error('Signed macOS builds require macOS and Xcode');
 const ctx=await releaseContext('macos'),{root,work,config,version}=ctx,c=config.macos;
 await require('./configure-server.cjs').configureServer({root,publicRelease:true});
 await require('./prepare-updates.cjs').prepareUpdates({root});
 const {packager}=await import('@electron/packager');const artifacts=[],notarizations=[];
 for(const arch of ['arm64','x64']){
  const [folder]=await packager({dir:root,out:path.join(work,'apps'),name:'KeRnCloud Bridge',executableName:'KeRnCloud Bridge',platform:'darwin',arch,electronVersion:'45.0.0',appVersion:version,appBundleId:'de.kerncloud.bridge',asar:false,prune:true,ignore:packagerIgnore(),extendInfo:{NSHumanReadableCopyright:config.publisher.name},osxSign:{identity:c.identity,keychain:c.keychain||undefined,type:'distribution',continueOnError:false,strictVerify:true,optionsForFile:()=>({hardenedRuntime:true})}});
  const app=path.join(folder,'KeRnCloud Bridge.app');verifyMacApp(app,config);
  const upload=path.join(work,'notary-'+arch+'.zip');run('ditto',['-c','-k','--keepParent',app,upload]);notarizations.push(notarizeAndStaple(upload,app,config));
  run('spctl',['--assess','--type','execute','--verbose=2',app]);
  const content=path.join(work,'dmg-'+arch);await fs.mkdir(content);run('ditto',[app,path.join(content,'KeRnCloud Bridge.app')]);await fs.symlink('/Applications',path.join(content,'Applications'));
  for(const[src,dest]of [['bridge-anleitung-de.pdf','Anleitung Deutsch.pdf'],['bridge-guide-en.pdf','English guide.pdf']])await fs.copyFile(path.join(root,'releases',src),path.join(content,dest));
  const dmg=path.join(work,'kerncloud-bridge-'+version+'-macos-'+arch+'.dmg');run('hdiutil',['create','-volname','KeRnCloud Bridge','-srcfolder',content,'-format','UDZO',dmg]);run('hdiutil',['verify',dmg]);
  run('codesign',['--force','--sign',c.identity,'--timestamp',...(c.keychain?['--keychain',c.keychain]:[]),dmg]);run('codesign',['--verify','--strict',dmg]);
  notarizations.push(notarizeAndStaple(dmg,dmg,config));run('spctl',['--assess','--type','open','--context','context:primary-signature','--verbose=2',dmg]);
  const updateZip=path.join(work,'kerncloud-bridge-'+version+'-darwin-'+arch+'.zip');run('ditto',['-c','-k','--keepParent',app,updateZip]);run('unzip',['-tq',updateZip]);artifacts.push({path:updateZip,format:'zip',kind:'portable',platform:'darwin',arch,label:arch==='arm64'?'macOS Apple Silicon':'macOS Intel',primary:false,signed:true,notarized:true});
  artifacts.push({path:dmg,format:'dmg',kind:'installer',platform:'darwin',arch,label:arch==='arm64'?'macOS Apple Silicon':'macOS Intel',primary:true,signed:true,notarized:true});
 }
 await reportRelease(ctx,'macos',artifacts,{verified:true,developer_id:true,hardened_runtime:true,gatekeeper:true,team_id:c.teamId,notarizations});
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={main};
