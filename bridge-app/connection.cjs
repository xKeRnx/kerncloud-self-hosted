'use strict';
const {platformUrl}=require('./core.cjs');
function configuredOrigin(config,{publicRelease=false}={}){
 if(config?.schema!==1||typeof config.defaultOrigin!=='string'||!config.defaultOrigin.trim())throw Error('KeRnCloud-Serveradresse ist nicht konfiguriert.');
 const origin=platformUrl(config.defaultOrigin.trim());
 if(publicRelease&&new URL(origin).protocol!=='https:')throw Error('Public Bridge releases require an HTTPS server address.');
 return origin;
}
function connectionSettings(savedOrigin,defaultOrigin){
 const origin=savedOrigin?platformUrl(savedOrigin):defaultOrigin;
 return {origin,defaultOrigin,customServer:origin!==defaultOrigin};
}
function enrollmentOrigin(request,defaultOrigin){
 // The normal connection never accepts an incidental origin from the renderer.
 return request?.customServer===true?platformUrl(String(request.origin??'').trim()):defaultOrigin;
}
module.exports={configuredOrigin,connectionSettings,enrollmentOrigin};
