'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
async function prepareUpdates({root=path.resolve(__dirname,'..'),env=process.env}={}){
 const trust=JSON.parse(await fs.readFile(path.join(root,'update-trust.json'),'utf8'));
 if(trust.schema!==1||!Array.isArray(trust.keys)||!trust.keys.length)throw Error('Update trust keys missing');
 for(const key of trust.keys){const pub=crypto.createPublicKey(key.publicKey);if(pub.asymmetricKeyType!=='ed25519'||key.id!==crypto.createHash('sha256').update(pub.export({type:'spki',format:'der'})).digest('hex').slice(0,32))throw Error('Invalid update trust key');}
 let publisherName;
 if(env.BRIDGE_RELEASE_MODE==='signed'&&process.platform==='win32'){
  const {loadConfig,validateConfig}=require('./signing/common.cjs');const c=validateConfig(await loadConfig(env,root),'windows');
  publisherName=c.windows.expectedSubject;
 }
 await fs.writeFile(path.join(root,'update-native.json'),JSON.stringify({updaterCacheDirName:'kerncloud-bridge-updates',...(publisherName?{publisherName:[publisherName]}:{})},null,2)+'\n');
}
module.exports={prepareUpdates};
if(require.main===module)prepareUpdates().catch(e=>{console.error(e.message);process.exitCode=1;});
