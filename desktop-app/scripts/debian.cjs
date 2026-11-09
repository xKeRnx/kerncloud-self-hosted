'use strict';
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
function buildDeb(arch){
 if(process.platform!=='linux')throw Error('Debian packages require a Linux builder');
 const pkg=require('../package.json'),root=fs.mkdtempSync(path.resolve('dist/.deb-stage-')),debArch=arch==='arm64'?'arm64':'amd64';
 const install=path.join(root,'opt/KeRnCloud');fs.mkdirSync(path.dirname(install),{recursive:true});
 const unpacked=path.resolve(arch==='arm64'?'dist/linux-arm64-unpacked':'dist/linux-unpacked');
 fs.cpSync(unpacked,install,{recursive:true});
 const sandbox=path.join(install,'chrome-sandbox');
 if(!fs.lstatSync(sandbox).isFile()||fs.lstatSync(sandbox).isSymbolicLink())throw Error('Missing bundled Chromium sandbox helper');
 // Debian installs this vetted Electron helper as root; retain Chromium sandboxing.
 fs.chmodSync(sandbox,0o4755);
 const executable=pkg.build.executableName??pkg.name;
 if(!/^[\w.-]+$/.test(executable)||!fs.existsSync(path.join(install,executable)))throw Error('Linux launcher executable missing');
 fs.mkdirSync(path.join(root,'DEBIAN'),{recursive:true});
 fs.writeFileSync(path.join(root,'DEBIAN/control'),`Package: kerncloud\nVersion: ${pkg.version}\nArchitecture: ${debArch}\nMaintainer: KeRn-WS <support@kern-ws.com>\nHomepage: https://kern-ws.com\nSection: utils\nPriority: optional\nDepends: libgtk-3-0 | libgtk-3-0t64, libnss3, libxss1, libxtst6, libatk-bridge2.0-0 | libatk-bridge2.0-0t64, libdrm2, libgbm1, libasound2 | libasound2t64\nDescription: KeRnCloud local AI agent workspace\n Desktop launcher for the local Docker-based KeRnCloud platform.\n Docker Engine and Compose must be installed separately.\n`);
 const applications=path.join(root,'usr/share/applications'),icons=path.join(root,'usr/share/icons/hicolor/1024x1024/apps'),docs=path.join(root,'usr/share/doc/kerncloud');
 for(const dir of [applications,icons,docs])fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(applications,'kerncloud.desktop'),'[Desktop Entry]\nType=Application\nName=KeRnCloud\nComment=Your local AI agent workspace\nExec=/opt/KeRnCloud/'+executable+' %U\nIcon=kerncloud\nTerminal=false\nCategories=Office;\nStartupWMClass=kerncloud.desktop\n');
 fs.copyFileSync('assets/icon.png',path.join(icons,'kerncloud.png'));fs.copyFileSync('../LICENSE',path.join(docs,'copyright'));
 const output=path.resolve(`dist/KeRnCloud-${pkg.version}-linux-${debArch}.deb`);
 execFileSync('dpkg-deb',['--root-owner-group','--uniform-compression','-Zgzip','-z3','--build',root,output],{stdio:'inherit'});
 execFileSync('dpkg-deb',['--info',output],{stdio:'inherit'});
 return output;
}
module.exports={buildDeb};
