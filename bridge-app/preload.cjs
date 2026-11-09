'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('bridge',{call:(op,body)=>{if(!['state','connect','pause','resume','folder','program','policy','disconnect','startup_set','desktop_shortcut','update_check','update_automatic','update_install'].includes(op))throw Error('Not allowed');return ipcRenderer.invoke('bridge',op,body);},onStatus:callback=>ipcRenderer.on('status',(_event,value)=>callback(value))});
