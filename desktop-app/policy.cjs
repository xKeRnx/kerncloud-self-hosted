'use strict';
const allowedCommands=new Set(['doctor','start','stop','status','backup','update']);
function allowedNavigation(target,origin){try{return new URL(target).origin===origin;}catch{return false;}}
function redact(text,env){for(const [key,value]of Object.entries(env))if(/PASSWORD|TOKEN|KEY|SECRET/.test(key)&&value)text=text.split(value).join('[redacted]');return text;}
function loginAutostart(app,platform){return platform==='win32'||platform==='darwin'?app.getLoginItemSettings().openAtLogin:false;}
module.exports={allowedCommands,allowedNavigation,redact,loginAutostart};
