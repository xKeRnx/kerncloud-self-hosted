'use strict';
const fs=require('node:fs/promises'), path=require('node:path'), crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const run=(bin,args,opts={})=>execFileSync(bin,args,{stdio:'inherit',...opts});
async function allFiles(dir,relative=''){let result=[];for(const ent of await fs.readdir(path.join(dir,relative),{withFileTypes:true})){const name=path.join(relative,ent.name);if(ent.isDirectory())result.push(...await allFiles(dir,name));else result.push(name);}return result;}
const nsis=s=>s.replaceAll('$','$$').replaceAll('"','$\\"').replaceAll('/','\\');
async function main(){
 if(require('./signing/common.cjs').releaseMode()==='signed')throw Error('Use release:windows, release:macos or release:linux for verified signed candidates; this command only builds previews.');
 if(process.platform!=='linux')throw Error('Build Windows/Linux installers in the documented Linux container. macOS uses build-macos.sh.');
 await require('./configure-server.cjs').configureServer();
 await require('./prepare-updates.cjs').prepareUpdates();
 const version=JSON.parse(await fs.readFile(path.join(root,'package.json'))).version,releases=path.join(root,'releases');
 const args=process.argv.slice(2),fromIndex=args.indexOf('--from-bundles'),bundles=fromIndex>=0?path.resolve(args[fromIndex+1]):null;
 const reuseIndex=args.indexOf('--reuse-payloads'),reuse=reuseIndex>=0?path.resolve(args[reuseIndex+1]):null;
 const depsIndex=args.indexOf('--packager-root'),packagerRoot=depsIndex>=0?path.resolve(args[depsIndex+1]):path.dirname(require.resolve('@electron/packager'));
 const {resedit}=await import(pathToFileURL(path.join(packagerRoot,'resedit.js')).href);
 await fs.mkdir(releases,{recursive:true});await fs.mkdir(path.join(root,'dist-installers'),{recursive:true});
 const workBase=process.env.BRIDGE_BUILD_WORKDIR?path.resolve(process.env.BRIDGE_BUILD_WORKDIR):path.join(root,'dist-installers');await fs.mkdir(workBase,{recursive:true});const work=await fs.mkdtemp(path.join(workBase,'build-'));
 const oldManifest=JSON.parse(await fs.readFile(path.join(bundles??releases,'manifest.json')));
 const existing=JSON.parse(await fs.readFile(path.join(releases,'manifest.json')));
 const entries=existing.files.filter(f=>f.version!==version&&!f.name.includes('-'+version+'-')&&!/\.(pdf|md)$/.test(f.name));
 async function record(name,meta){const b=await fs.readFile(path.join(releases,name));const f={name,...meta,bytes:b.length,sha256:hash(b)};entries.push(f);return f;}
 const folders={};
 for(const[platform,arch,label]of [['win32','x64','Windows'],['linux','x64','Linux'],['darwin','arm64','macOS Apple Silicon'],['darwin','x64','macOS Intel']]){
  if(reuse){const folder=path.join(reuse,platform+'-'+arch),name='kerncloud-bridge-'+version+'-'+platform+'-'+arch+'.zip';await fs.access(folder);await fs.access(path.join(releases,name));await record(name,{label,arch,platform,format:'zip',kind:'portable',primary:platform==='darwin',version,signed:false,notarized:false,runtime_tested:false});folders[platform+'-'+arch]=folder;continue;}
  let folder;console.log('Preparing '+platform+' '+arch);
  if(bundles){const base=oldManifest.files.find(f=>f.name.includes('0.1.1-'+platform+'-'+arch+'.zip'));if(!base)throw Error('Expected validated Electron 45 base bundle missing');const bytes=await fs.readFile(path.join(bundles,base.name));if(hash(bytes)!==base.sha256)throw Error('Base bundle hash mismatch');const localZip=path.join(work,base.name);await fs.writeFile(localZip,bytes);folder=path.join(work,platform+'-'+arch);await fs.mkdir(folder);run('unzip',['-q',localZip,'-d',folder]);}
  else{const {packager}=await import('@electron/packager');[folder]=await packager({dir:root,out:path.join(work,'packager'),name:'KeRnCloud Bridge',executableName:'KeRnCloud Bridge',platform,arch,electronVersion:'45.0.0',appVersion:version,icon:platform==='win32'?path.join(root,'assets/icon.ico'):undefined,asar:false,prune:true,appBundleId:'de.kerncloud.bridge',ignore:require('./signing/common.cjs').packagerIgnore()});}
  const appRoot=platform==='darwin'?path.join(folder,'KeRnCloud Bridge.app/Contents/Resources/app'):path.join(folder,'resources/app');await fs.mkdir(path.join(appRoot,'assets'),{recursive:true});
  for(const f of ['main.cjs','updater.cjs','update-trust.json','update-native.json','connection.cjs','server.json','core.cjs','startup.cjs','preload.cjs','renderer.js','index.html','style.css','package.json','README.de.md','README.en.md','assets/icon.svg','assets/icon.png','assets/icon.ico'])await fs.copyFile(path.join(root,f),path.join(appRoot,f));
  await fs.cp(path.join(root,'node_modules'),path.join(appRoot,'node_modules'),{recursive:true});
  for(const[src,dest]of [['README.de.md','ANLEITUNG.de.md'],['README.en.md','GUIDE.en.md'],['releases/bridge-anleitung-de.pdf','ANLEITUNG.de.pdf'],['releases/bridge-guide-en.pdf','GUIDE.en.pdf']])await fs.copyFile(path.join(root,src),path.join(folder,dest));
  if(platform==='win32')await resedit(path.join(folder,'KeRnCloud Bridge.exe'),{iconPath:path.join(root,'assets/icon.ico'),fileVersion:version,productVersion:version,productName:'KeRnCloud Bridge',legalCopyright:'KeRn-WS',win32Metadata:{CompanyName:'KeRn-WS',FileDescription:'KeRnCloud Bridge',InternalName:'KeRnCloud Bridge',OriginalFilename:'KeRnCloud Bridge.exe'}});
  if(platform==='darwin'){const p=path.join(folder,'KeRnCloud Bridge.app/Contents/Info.plist');let s=await fs.readFile(p,'utf8');for(const k of ['CFBundleShortVersionString','CFBundleVersion'])s=s.replace(new RegExp('(<key>'+k+'</key>\\s*<string>)[^<]*(</string>)'),(_,a,b)=>a+version+b);await fs.writeFile(p,s);}
  if(platform==='linux'){await fs.writeFile(path.join(folder,'Start-Bridge.sh'),'#!/bin/sh\ncd -- "$(dirname -- "$0")" || exit 1\nexec "./KeRnCloud Bridge" "$@"\n',{mode:0o755});await fs.chmod(path.join(folder,'KeRnCloud Bridge'),0o755);}
  const name='kerncloud-bridge-'+version+'-'+platform+'-'+arch+'.zip',temp=path.join(work,name);run('zip',['-q','-r','-y',temp,'.'],{cwd:folder});await fs.copyFile(temp,path.join(releases,name));
  await record(name,{label,arch,platform,format:'zip',kind:'portable',primary:platform==='darwin',version,signed:false,notarized:false,runtime_tested:false});folders[platform+'-'+arch]=folder;
 }
 const win=folders['win32-x64'],files=await allFiles(win),dirs=new Set();let size=0;
 for(const f of files){size+=(await fs.stat(path.join(win,f))).size;let dir=path.dirname(f);while(dir!=='.'){dirs.add(dir);dir=path.dirname(dir);}}
 const uninstall=path.join(work,'uninstall-files.nsh');await fs.writeFile(uninstall,files.map(f=>'Delete "$INSTDIR\\'+nsis(f)+'"').concat([...dirs].sort((a,b)=>b.length-a.length).map(f=>'RMDir "$INSTDIR\\'+nsis(f)+'"')).join('\n')+'\n');
 const setupName='kerncloud-bridge-'+version+'-windows-x64-setup.exe';
 console.log('Compiling Windows setup');run('makensis',['-V3','-WX','-DAPP_VERSION='+version,'-DAPP_FILES_DIR='+win,'-DAPP_ICON='+path.join(root,'assets/icon.ico'),'-DOUTPUT_FILE='+path.join(work,setupName),'-DUNINSTALL_FILES='+uninstall,'-DAPP_SIZE_KB='+Math.ceil(size/1024),path.join(root,'installer/windows.nsi')]);await fs.copyFile(path.join(work,setupName),path.join(releases,setupName));
 await record(setupName,{label:'Windows',arch:'x64',platform:'win32',format:'exe',kind:'installer',primary:true,version,signed:false,notarized:false,runtime_tested:false});
 const debName='kerncloud-bridge-'+version+'-linux-amd64.deb';
 if(!args.includes('--windows-only')){
 const debRoot=path.join(work,'deb'),opt=path.join(debRoot,'opt/kerncloud-bridge');await fs.mkdir(opt,{recursive:true});await fs.cp(folders['linux-x64'],opt,{recursive:true});
 await fs.chmod(path.join(opt,'chrome-sandbox'),0o4755);
 const desktop='[Desktop Entry]\nType=Application\nName=KeRnCloud Bridge\nComment=Your computer. Your permissions.\nExec="/opt/kerncloud-bridge/KeRnCloud Bridge"\nIcon=kerncloud-bridge\nTerminal=false\nCategories=Utility;Network;\nStartupWMClass=kerncloud-bridge\n';
 for(const f of ['usr/share/applications','usr/share/icons/hicolor/scalable/apps','DEBIAN'])await fs.mkdir(path.join(debRoot,f),{recursive:true});
 await fs.writeFile(path.join(debRoot,'usr/share/applications/kerncloud-bridge.desktop'),desktop);
 await fs.copyFile(path.join(root,'assets/icon.svg'),path.join(debRoot,'usr/share/icons/hicolor/scalable/apps/kerncloud-bridge.svg'));
 await fs.writeFile(path.join(debRoot,'DEBIAN/control'),'Package: kerncloud-bridge\nVersion: '+version+'\nSection: utils\nPriority: optional\nArchitecture: amd64\nMaintainer: KeRn-WS <support@kern-ws.com>\nDepends: libc6, libgtk-3-0 | libgtk-3-0t64, libnss3, libxss1, libasound2 | libasound2t64, libgbm1, libsecret-1-0, libatk1.0-0 | libatk1.0-0t64, libatspi2.0-0 | libatspi2.0-0t64, libdrm2, libxkbcommon0, libxcomposite1, libxdamage1, libxrandr2, libcups2 | libcups2t64, libx11-xcb1\nDescription: KeRnCloud Bridge desktop connector\n Locally controlled file, browser and network access. Starts paused.\n No automatic login startup or network service is installed.\n');
 console.log('Building Debian package');run('dpkg-deb',['--root-owner-group','--build',debRoot,path.join(work,debName)]);await fs.copyFile(path.join(work,debName),path.join(releases,debName));
 }
 await record(debName,{label:'Linux · Debian / Ubuntu',arch:'x64',platform:'linux',format:'deb',kind:'installer',primary:true,version,signed:false,runtime_tested:false});
 for(const[local,name,label,language]of [['README.de.md','bridge-anleitung-de.md','Anleitung Deutsch','de'],['README.en.md','bridge-guide-en.md','English guide','en']]){await fs.copyFile(path.join(root,local),path.join(releases,name));await record(name,{label,language,format:'md',kind:'source',version});}
 for(const[name,label,language]of [['bridge-anleitung-de.pdf','Anleitung Deutsch','de'],['bridge-guide-en.pdf','English guide','en']]){const b=await fs.readFile(path.join(releases,name));if(b.subarray(0,5).toString()!=='%PDF-')throw Error('Generate PDF guides first');await record(name,{label,language,format:'pdf',kind:'guide',primary:true,version});}
 const source_sha256={};for(const f of ['main.cjs','updater.cjs','update-trust.json','update-native.json','connection.cjs','server.json','core.cjs','startup.cjs','preload.cjs','renderer.js','index.html','style.css','assets/icon.svg','assets/icon.png','assets/icon.ico'])source_sha256[f]=hash(await fs.readFile(path.join(root,f)));
 await fs.writeFile(path.join(releases,'manifest.json'),JSON.stringify({version,channel:'local-preview',electron:'45.0.0',files:entries,source_sha256},null,2)+'\n');
 await fs.writeFile(path.join(root,'dist-installers/latest-build.json'),JSON.stringify({work,version,folders,setup:setupName,deb:debName},null,2)+'\n');
 console.log(JSON.stringify({version,windows:setupName,linux:debName,macos:'ZIP packages; native DMG build prepared separately',files:entries.length}));
}
module.exports={main};
if(require.main===module)main().catch(e=>{console.error(e);process.exit(1);});
