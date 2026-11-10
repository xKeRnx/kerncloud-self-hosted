const {build,Platform,Arch}=require('electron-builder');
process.chdir(require('node:path').resolve(__dirname,'..'));
const [target,arch='x64']=process.argv.slice(2),signed=process.env.KERNCLOUD_REQUIRE_SIGNING==='true';
if(!['win','mac','linux'].includes(target)||!['x64','arm64'].includes(arch))throw Error('Specify win/mac/linux and x64/arm64');
if(signed&&target!=='linux'&&(!process.env.CSC_LINK||!process.env.CSC_KEY_PASSWORD))throw Error('Signing credentials are required.');
if(signed&&target==='mac'&&(!process.env.APPLE_ID||!process.env.APPLE_APP_SPECIFIC_PASSWORD||!process.env.APPLE_TEAM_ID))throw Error('Apple notarization credentials are required.');
if(signed&&target==='win'&&!process.env.KERNCLOUD_WINDOWS_PUBLISHER)throw Error('Set KERNCLOUD_WINDOWS_PUBLISHER to the exact Authenticode certificate publisher name.');
require('node:fs').writeFileSync('update-native.json',JSON.stringify({updaterCacheDirName:'kerncloud-desktop-updates',...(signed&&target==='win'?{publisherName:process.env.KERNCLOUD_WINDOWS_PUBLISHER}:{})},null,2)+'\n');
if(!signed){delete process.env.CSC_LINK;delete process.env.CSC_KEY_PASSWORD;process.env.CSC_IDENTITY_AUTO_DISCOVERY='false';}
const platform={win:Platform.WINDOWS,mac:Platform.MAC,linux:Platform.LINUX}[target];
build({targets:platform.createTarget(target==='linux'?['AppImage']:undefined,Arch[arch]),publish:'never',config:{forceCodeSigning:signed&&target!=='linux',...(target==='mac'?{mac:{notarize:signed}}:{})}}).then(()=>{
 if(target==='linux')require('./debian.cjs').buildDeb(arch);
 const fs=require('node:fs'),files=fs.readdirSync('dist'),extensions={win:['.exe'],mac:['.dmg','.zip'],linux:['.AppImage','.deb']}[target];
 for(const extension of extensions)if(!files.some(f=>f.endsWith(extension)&&fs.statSync(require('node:path').join('dist',f)).size>1000000))throw Error('Missing required desktop artifact '+extension);
}).catch(e=>{console.error(e.message);process.exit(1);});
