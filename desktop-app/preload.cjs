const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('kernLocal',{action:(command,input)=>ipcRenderer.invoke('local:action',command,input),onLog:callback=>ipcRenderer.on('local:log',(_event,text)=>callback(text))});
