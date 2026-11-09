'use strict';
const {ROOT,loadConfig,validateConfig,releaseMode}=require('./common.cjs');
async function main(){const platform=process.argv[2]??'windows';const config=await loadConfig();validateConfig(config,platform);console.log(JSON.stringify({ok:true,platform,mode:releaseMode(),publisher:config.publisher,credentials:'OS store / external build identity',root:ROOT,signature_created:false}));}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={main};
