'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {platformUrl}=require('./core.cjs');
const APP_ID='de.kerncloud.bridge',MAX_FEED=128*1024;
function version(value){if(typeof value!=='string'||!/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(value))throw Error('Invalid update version');return value.split('.').map(Number);}
function compare(a,b){const x=version(a),y=version(b);for(let i=0;i<3;i++)if(x[i]!==y[i])return Math.sign(x[i]-y[i]);return 0;}
function verifyFeed(envelope,trust,{now=Date.now(),minimum='0.0.0'}={}){
 if(!envelope||typeof envelope.payload!=='string'||Buffer.byteLength(envelope.payload)>MAX_FEED||typeof envelope.signature!=='string'||!/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature))throw Error('Invalid update envelope');
 const key=trust.keys?.find(k=>k.id===envelope.keyId);if(!key||!crypto.verify(null,Buffer.from(envelope.payload),key.publicKey,Buffer.from(envelope.signature,'base64')))throw Error('Update signature rejected');
 const p=JSON.parse(envelope.payload);version(p.version);
 if(p.schema!==1||p.appId!==APP_ID||p.channel!=='stable'||!Array.isArray(p.files)||p.files.length>12||!Number.isFinite(Date.parse(p.issuedAt))||!Number.isFinite(Date.parse(p.expiresAt))||Date.parse(p.issuedAt)>now+300000||Date.parse(p.expiresAt)<=now||Date.parse(p.expiresAt)-Date.parse(p.issuedAt)>93*86400000||compare(p.version,minimum)<0)throw Error('Invalid or expired update manifest');
 const seen=new Set();for(const f of p.files){
  const formats={win32:['exe'],linux:['deb'],darwin:['zip']};
  if(!formats[f.platform]?.includes(f.format)||!['x64','arm64'].includes(f.arch)||typeof f.name!=='string'||!/^kerncloud-bridge-[a-zA-Z0-9.-]+$/.test(f.name)||!f.name.startsWith('kerncloud-bridge-'+p.version+'-')||!f.name.endsWith('.'+f.format)||!Number.isSafeInteger(f.bytes)||f.bytes<1||f.bytes>1024*1024*1024||!/^[a-f0-9]{64}$/.test(f.sha256)||!/^[A-Za-z0-9+/]{86}==$/.test(f.sha512)||seen.has(f.platform+'/'+f.arch))throw Error('Invalid update artifact');
  if(f.platform==='darwin'&&(f.signed!==true||f.notarized!==true))throw Error('macOS update must be signed and notarized');
  seen.add(f.platform+'/'+f.arch);
 }
 return p;
}
async function fetchFeed(origin,fetcher=fetch){
 const response=await fetcher(platformUrl(origin)+'/api/public/bridge/updates',{redirect:'error',credentials:'omit',headers:{Accept:'application/json'},signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('Update service unavailable');
 const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>MAX_FEED){await response.body.cancel?.().catch(()=>{});throw Error('Update feed too large');}chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function fileHash(file,algorithm){const hash=crypto.createHash(algorithm);for await(const b of require('node:fs').createReadStream(file))hash.update(b);return hash.digest(algorithm==='sha512'?'base64':'hex');}
async function checkArtifact(file,entry){const s=await fs.lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.size!==entry.bytes||await fileHash(file,'sha512')!==entry.sha512||await fileHash(file,'sha256')!==entry.sha256)throw Error('Cached update failed verification');}
function infoFor(payload,platform,arch,origin,current){
 const f=payload.files.find(f=>f.platform===platform&&f.arch===arch);
 if(!f)return {version:current,files:[]};
 return {version:payload.version,releaseDate:payload.issuedAt,files:[{url:platformUrl(origin)+'/api/public/bridge/download/'+f.name,size:f.bytes,sha512:f.sha512}],isAdminRightsRequired:false};
}
function createNativeUpdater({app,platform,origin,info}){
 const lib=require('electron-updater');const {Provider}=require('electron-updater/out/providers/Provider');
 class VerifiedProvider extends Provider{
  constructor(_config,_updater,runtime){super({...runtime,isUseMultipleRangeRequest:false});}
  async getLatestVersion(){return structuredClone(info);}
  resolveFiles(update){if(JSON.stringify(update.files)!==JSON.stringify(info.files))throw Error('Update metadata changed');return update.files.map(f=>({url:new URL(f.url),info:f}));}
 }
 const Type=platform==='win32'?lib.NsisUpdater:platform==='darwin'?lib.MacUpdater:lib.DebUpdater;
 // Keep the real Electron adapter/executor. Passing an adapter argument to the
 // pinned library disables its HTTP executor (that constructor path is for tests).
 const u=new Type();u.updateConfigPath=path.join(app.getAppPath(),'update-native.json');
 u.setFeedURL({provider:'custom',updateProvider:VerifiedProvider});
 u.autoDownload=false;u.autoInstallOnAppQuit=false;u.autoRunAppAfterInstall=true;u.allowDowngrade=false;u.allowPrerelease=false;u.disableWebInstaller=true;u.disableDifferentialDownload=true;
 u.logger={info(){},warn(){},error(){},debug(){}};
 if(platform==='linux'){
  // The stable library's apt fallback adds trust/downgrade bypass flags. Use only
  // the existing package manager, with the OS authentication dialog and no shell.
  u.doInstall=function(options){const file=this.installerPath;if(!file)throw Error('No verified package');const {spawnSync}=require('node:child_process');const root=process.getuid?.()===0;const result=spawnSync(root?'/usr/bin/dpkg':'/usr/bin/pkexec',root?['-i',file]:['/usr/bin/dpkg','-i',file],{shell:false,windowsHide:true,stdio:'ignore',timeout:120000});if(result.error||result.status!==0)throw Error('System package installation did not complete');if(options.isForceRunAfter)this.app.relaunch();return true;};
 }
 return u;
}
class UpdateManager{
 constructor({app,origin,trust,platform=process.platform,arch=process.arch,supported=true,onChange=()=>{},isBusy=()=>false,beforeInstall=async()=>{},onInstallError=()=>{},fetcher=fetch,nativeFactory=createNativeUpdater,now=Date.now}){
  this.options={app,origin:platformUrl(origin),trust,platform,arch,supported,onChange,isBusy,beforeInstall,onInstallError,fetcher,nativeFactory,now};this.file=path.join(app.getPath('userData'),'update-preferences.json');this.value={automatic:true,pendingVersion:null,highestVersion:app.getVersion()};this.state={phase:'idle',message:'Updates werden automatisch geprüft.',automatic:true,supported,version:app.getVersion(),availableVersion:null,progress:0};this.operation=null;this.native=null;this.lastCheck=0;this.installing=false;
 }
 async init(){try{const p=JSON.parse(await fs.readFile(this.file,'utf8'));version(p.highestVersion);if(p.pendingVersion)version(p.pendingVersion);this.value={automatic:p.automatic!==false,pendingVersion:p.pendingVersion??null,highestVersion:compare(p.highestVersion,this.value.highestVersion)>0?p.highestVersion:this.value.highestVersion};}catch(e){if(e.code!=='ENOENT'){this.value.automatic=false;this.state.message='Update-Einstellungen prüfen und automatische Updates erneut einschalten.';}}this.state.automatic=this.value.automatic;return this.snapshot();}
 snapshot(){return {...this.state,canInstall:this.state.phase==='ready'&&!this.options.isBusy()&&!this.installing};}
 emit(phase,message,extra={}){Object.assign(this.state,{phase,message},extra);this.options.onChange(this.snapshot());}
 async save(){await fs.mkdir(path.dirname(this.file),{recursive:true,mode:0o700});const tmp=this.file+'.tmp';await fs.writeFile(tmp,JSON.stringify(this.value),{mode:0o600});await fs.rename(tmp,this.file);}
 async automatic(enabled){if(typeof enabled!=='boolean')throw Error('Ungültige Update-Einstellung.');this.value.automatic=enabled;this.state.automatic=enabled;if(!enabled)this.token?.cancel();await this.save();this.options.onChange(this.snapshot());return this.snapshot();}
 check({manual=false,startup=false}={}){
  if(this.operation)return this.operation;
  if(!manual&&!this.value.automatic)return Promise.resolve(this.snapshot());
  if(this.options.now()-this.lastCheck<60000)return Promise.resolve(this.snapshot());
  this.lastCheck=this.options.now();this.operation=this.perform({manual,startup}).finally(()=>{this.operation=null;});return this.operation;
 }
 async perform({manual,startup}){
  try{
   this.emit('checking','Suche nach Aktualisierungen …');
   const envelope=await fetchFeed(this.options.origin,this.options.fetcher),payload=verifyFeed(envelope,this.options.trust,{now:this.options.now(),minimum:this.value.highestVersion});
   if(!manual&&!this.value.automatic){this.emit('idle','Automatische Updates sind ausgeschaltet.');return this.snapshot();}
   const current=this.options.app.getVersion(),entry=payload.files.find(f=>f.platform===this.options.platform&&f.arch===this.options.arch);
   this.value.highestVersion=payload.version;await this.save();
   if(compare(payload.version,current)<=0||!entry){this.emit('current','Die Bridge ist aktuell.',{availableVersion:null});return this.snapshot();}
   if(!this.options.supported){this.emit('manual','Eine neue Version ist verfügbar. Verwende das Installationspaket.',{availableVersion:payload.version});return this.snapshot();}
   this.entry=entry;this.envelope=envelope;
   const native=this.options.nativeFactory({...this.options,info:infoFor(payload,this.options.platform,this.options.arch,this.options.origin,current)});this.native=native;
   native.on('error',()=>{this.installing=false;this.options.onInstallError();this.emit('error','Aktualisierung nicht abgeschlossen. Bitte erneut versuchen.');});
   native.on('download-progress',p=>{if(p.transferred>entry.bytes)this.token?.cancel();this.emit('downloading','Aktualisierung wird geladen …',{progress:Math.max(0,Math.min(100,Number(p.percent)||0))});});
   const checked=await native.checkForUpdates();
   if(!checked||compare(checked.updateInfo.version,payload.version)!==0)throw Error('Native metadata mismatch');
   const {CancellationToken}=require('builder-util-runtime');this.token=new CancellationToken();
   this.emit('downloading','Aktualisierung wird geladen …',{availableVersion:payload.version});
   const timeout=setTimeout(()=>this.token.cancel(),15*60*1000);let files;try{files=await native.downloadUpdate(this.token);}finally{clearTimeout(timeout);}if(!files?.length)throw Error('No update downloaded');
   await checkArtifact(files[0],entry);this.download=files[0];this.value.pendingVersion=payload.version;await this.save();
   this.emit('ready','Aktualisierung bereit. Installation beim nächsten Start oder über „Jetzt neu starten“. Verbindungen und Freigaben bleiben erhalten.',{progress:100});
   // Privileged Linux package installation always needs an explicit local action.
   if(startup&&this.options.platform!=='linux'&&this.initialPending===payload.version&&this.value.automatic&&!this.options.isBusy())await this.install();
   return this.snapshot();
  }catch(e){this.emit('error','Aktualisierung derzeit nicht möglich. Bitte später erneut prüfen.');this.lastError=String(e.message);return this.snapshot();}
 }
 async install({restart=true}={}){
  if(this.installing||this.state.phase!=='ready'||this.options.isBusy())throw Error('Aktualisierung wartet, bis keine Geräteaktion mehr läuft.');
  const fresh=verifyFeed(await fetchFeed(this.options.origin,this.options.fetcher),this.options.trust,{now:this.options.now(),minimum:this.value.highestVersion});
  if(fresh.version!==this.value.pendingVersion||!fresh.files.some(f=>f.name===this.entry.name&&f.sha512===this.entry.sha512&&f.sha256===this.entry.sha256&&f.bytes===this.entry.bytes))throw Error('Aktualisierung wurde geändert. Bitte erneut prüfen.');
  await checkArtifact(this.download,this.entry);
  if(this.options.isBusy())throw Error('Es läuft eine Geräteaktion. Bitte anschließend aktualisieren.');
  this.installing=true;this.emit('installing','Die Bridge wird aktualisiert …');
  try{await this.options.beforeInstall();this.native.quitAndInstall(true,restart);}catch(e){this.installing=false;this.emit('error','Installation nicht abgeschlossen. Die gespeicherte Verbindung bleibt erhalten.');throw e;}
 }
 start(){this.initialPending=this.value.pendingVersion;this.startTimer=setTimeout(()=>void this.check({startup:true}),15000);this.timer=setInterval(()=>void this.check(),6*60*60*1000);this.startTimer.unref?.();this.timer.unref?.();}
 stop(){clearTimeout(this.startTimer);clearInterval(this.timer);this.token?.cancel();}
}
module.exports={APP_ID,version,compare,verifyFeed,fetchFeed,fileHash,checkArtifact,infoFor,createNativeUpdater,UpdateManager};
