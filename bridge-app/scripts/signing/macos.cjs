'use strict';
const {run,validateConfig}=require('./common.cjs');
function assertMacProof(display,teamId,identity){const lines=display.split(/\r?\n/);if(!lines.includes('TeamIdentifier='+teamId)||!lines.some(s=>s.startsWith('Authority=Developer ID Application:'))||!lines.some(s=>/^Timestamp=.+/.test(s))||!/\bflags=0x[0-9a-f]+\([^)]*\bruntime\b[^)]*\)/i.test(display)||(identity&&!lines.includes('Authority='+identity)))throw Error('macOS bundle must have Developer ID, expected Team ID, timestamp and hardened runtime');return true;}
function verifyMacApp(app,config,{runner=run,platform=process.platform}={}){
 if(platform!=='darwin')throw Error('macOS trust checks require a Mac');validateConfig(config,'macos');
 runner('codesign',['--verify','--deep','--strict','--verbose=2',app]);
 // codesign writes signature metadata to stderr, even on success.
 const display=runner('codesign',['--display','--verbose=4',app],{stdio:['ignore','pipe','pipe'],returnStderr:true});
 assertMacProof(display,config.macos.teamId,config.macos.identity);
}
function notaryArgs(config){const c=config.macos;return ['--keychain-profile',c.notaryProfile,...(c.notaryKeychain?['--keychain',c.notaryKeychain]:[])];}
function notarizeAndStaple(upload,target,config,{runner=run,platform=process.platform}={}){
 if(platform!=='darwin')throw Error('Apple notarization requires a Mac');validateConfig(config,'macos');
 const result=JSON.parse(runner('xcrun',['notarytool','submit',upload,...notaryArgs(config),'--wait','--output-format','json']));
 if(result.status!=='Accepted'||!result.id)throw Error('Apple notarization was not accepted; no release produced');
 runner('xcrun',['stapler','staple',target]);runner('xcrun',['stapler','validate',target]);return {id:result.id,status:result.status};
}
module.exports={assertMacProof,verifyMacApp,notarizeAndStaple,notaryArgs};
