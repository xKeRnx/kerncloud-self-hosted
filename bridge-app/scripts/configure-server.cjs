'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {configuredOrigin}=require('../connection.cjs');
async function configureServer({root=path.resolve(__dirname,'..'),env=process.env,publicRelease=false}={}){
 const file=path.join(root,'server.json');
 const explicit=env.BRIDGE_DEFAULT_ORIGIN??env.PUBLIC_URL;
 const config=explicit===undefined?JSON.parse(await fs.readFile(file,'utf8')):{schema:1,defaultOrigin:explicit};
 const origin=configuredOrigin(config,{publicRelease});
 await fs.writeFile(file,JSON.stringify({schema:1,defaultOrigin:origin},null,2)+'\n');
 return origin;
}
module.exports={configureServer};
if(require.main===module)configureServer({publicRelease:process.env.BRIDGE_RELEASE_MODE==='signed'}).then(origin=>console.log('Bridge server: '+origin)).catch(e=>{console.error(e.message);process.exitCode=1;});
