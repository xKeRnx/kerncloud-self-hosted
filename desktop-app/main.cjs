'use strict';
const {app,BrowserWindow,ipcMain,shell,dialog,utilityProcess}=require('electron');
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),{pathToFileURL}=require('node:url');
const dockerSetup=require('./docker-setup.cjs');
const {allowedCommands,allowedNavigation,redact,loginAutostart}=require('./policy.cjs');
let launcher,workspace,busy=false,runtime,config={};
const diagnosticIndex=process.argv.indexOf('--diagnostics-report');
const diagnosticReport=diagnosticIndex>=0?path.resolve(process.argv[diagnosticIndex+1]??'installation-diagnostics.json'):null;
const commandIndex=process.argv.indexOf('--local-command');
const diagnosticCommand=commandIndex>=0?process.argv[commandIndex+1]:null;
if(diagnosticReport){fs.mkdirSync(path.dirname(diagnosticReport),{recursive:true});app.setPath('userData',path.join(path.dirname(diagnosticReport),'profile'));}

if(!app.requestSingleInstanceLock())app.quit();
else{
 app.on('second-instance',()=>{launcher?.show();launcher?.focus();});
 app.whenReady().then(async()=>{
  dockerSetup.configureDockerPath();
  runtime=process.env.KERNCLOUD_DESKTOP_DATA_DIR?path.resolve(process.env.KERNCLOUD_DESKTOP_DATA_DIR):path.join(app.getPath('userData'),'runtime');fs.mkdirSync(runtime,{recursive:true,mode:0o700});
  const payload=app.isPackaged?path.join(process.resourcesPath,'server'):path.join(__dirname,'payload');
  if(!fs.existsSync(payload+'/scripts/self-host.mjs'))throw Error('Server payload missing. Run npm run desktop:prepare first.');
  fs.cpSync(payload,runtime,{recursive:true,filter:source=>!['.local-networks.yaml','.env','backups','node_modules','.git','.next'].includes(path.basename(source))});
  const local=await import(pathToFileURL(path.join(runtime,'scripts/self-host.mjs')).href);config=local.prepare(runtime,{port:43100,gatewayPort:43200}).config;
  launcher=new BrowserWindow({show:!diagnosticReport,width:1100,height:820,minWidth:740,minHeight:650,backgroundColor:'#f5f7fc',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
  launcher.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  const launcherURL=pathToFileURL(path.join(__dirname,'index.html')).href;
  launcher.webContents.on('will-navigate',(event,url)=>{if(url!==launcherURL)event.preventDefault();});
  launcher.webContents.session.setPermissionRequestHandler((_w,_p,callback)=>callback(false));
  const action=async(command,input)=>{
   if(command==='info')return {network:{port:config.KERNCLOUD_PORT,gatewayPort:config.KERNCLOUD_GATEWAY_PORT,exposure:config.KERNCLOUD_BIND_ADDRESS==='0.0.0.0'?'lan':'local',hostname:new URL(config.PUBLIC_URL).hostname},docker:dockerSetup.detectDocker(),language:'en',url:config.PUBLIC_URL,version:app.getVersion(),platform:process.platform,autostart:loginAutostart(app,process.platform)};
   if(command==='autostart:on'||command==='autostart:off'){if(process.platform==='linux')throw Error('Configure startup in your Linux desktop settings.');app.setLoginItemSettings({openAtLogin:command.endsWith(':on')});return {message:'Startup preference saved.'};}
   if(command==='credentials'){await shell.openPath(path.join(runtime,'.env'));return {message:'Opened the private local configuration file.'};}
   if(command==='docker:setup'){return dockerSetup.installDocker({shell,directory:path.join(app.getPath('userData'),'installers'),resources:__dirname,log:text=>launcher.webContents.send('local:log',text)});}
   if(command==='network:save'){if(busy)throw Error('Wait for the current operation to finish.');config=local.configureNetwork(runtime,input);return {message:'Network settings saved. Stop and start local services to apply them.'};}
   if(command==='folder'){await shell.openPath(runtime);return {message:'Opened the data folder.'};}
   if(command==='open'||command==='users'){
    const r=await fetch(config.PUBLIC_URL+'/api/health',{signal:AbortSignal.timeout(3000)}).catch(()=>null);if(!r?.ok)throw Error('Start local services first.');
    if(workspace&&!workspace.isDestroyed()){workspace.show();if(command==='users')await workspace.loadURL(config.PUBLIC_URL+'/admin/customers?lang='+(input?.locale==='de'?'de':'en'));return {message:'Opened the workspace.'};}
    workspace=new BrowserWindow({width:1440,height:1000,backgroundColor:'#f5f7fc',autoHideMenuBar:true,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
    // Dashboard receives neither preload nor privileged IPC; all actions still use server auth.
    workspace.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    workspace.webContents.on('will-navigate',(e,url)=>{if(!allowedNavigation(url,config.PUBLIC_URL))e.preventDefault();});
    await workspace.loadURL(config.PUBLIC_URL+(command==='users'?'/admin/customers':'/overview')+'?lang='+(input?.locale==='de'?'de':'en'));return {message:'Opened the workspace.'};
   }
   if(command==='start'&&!dockerSetup.detectDocker().running)await dockerSetup.startDocker(shell);
   if(!allowedCommands.has(command))throw Error('Action not allowed.');if(busy)throw Error('A local operation is already running.');busy=true;
   try{return await new Promise((resolve,reject)=>{
    const child=utilityProcess.fork(path.join(__dirname,'backend-runner.cjs'),[command],{cwd:runtime,env:{...process.env},stdio:'pipe'});let output='';
    const log=chunk=>{const value=redact(chunk.toString(),config);output=(output+value).slice(-30000);if(!launcher.isDestroyed())launcher.webContents.send('local:log',value);};
    child.stdout.on('data',log);child.stderr.on('data',log);child.on('error',()=>reject(Error('Could not start local services. Check the Docker installation.')));child.on('exit',code=>code===0?resolve({message:output||'Done.'}):reject(Error('Action failed. Check the local log. Existing data has been preserved.')));
   });}finally{busy=false;}
  };
  ipcMain.handle('local:action',(event,command,input)=>{
   if(event.sender!==launcher.webContents||event.senderFrame?.url!==launcherURL)throw Error('Untrusted sender');
   return action(command,input);
  });
  await launcher.loadURL(launcherURL);
  if(diagnosticReport){
   if(diagnosticCommand&&!allowedCommands.has(diagnosticCommand))throw Error('Unsupported diagnostic command');
   if(diagnosticCommand)await action(diagnosticCommand,{locale:'en'});
   const preferences=launcher.webContents.getLastWebPreferences();
   fs.writeFileSync(diagnosticReport,JSON.stringify({ok:true,version:app.getVersion(),platform:process.platform,rendererLoaded:true,sandbox:preferences.sandbox,contextIsolation:preferences.contextIsolation,nodeIntegration:preferences.nodeIntegration,docker:dockerSetup.detectDocker(),command:diagnosticCommand??null},null,2),{mode:0o600});
   app.exit(0);return;
  }

  launcher.webContents.on('did-finish-load',()=>{});

 }).catch(error=>{if(diagnosticReport){fs.writeFileSync(diagnosticReport,JSON.stringify({ok:false,error:redact(error.message,config)}),{mode:0o600});app.exit(1);}else{dialog.showErrorBox('KeRnCloud',redact(error.message,config));app.quit();}});
 app.on('window-all-closed',()=>app.quit());
}
