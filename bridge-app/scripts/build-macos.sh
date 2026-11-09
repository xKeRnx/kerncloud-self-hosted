#!/bin/sh
set -eu
if [ "$(uname -s)" != Darwin ]; then
  echo 'DMG creation and validation require macOS. This script never substitutes an untested file.' >&2
  exit 1
fi
cd -- "$(dirname -- "$0")/.."
if [ "${BRIDGE_RELEASE_MODE:-preview}" = signed ]; then
  exec node scripts/build-macos.cjs
fi
# Validate unknown modes rather than silently producing an unsigned build.
node -e "require('./scripts/signing/common.cjs').releaseMode()"
node scripts/configure-server.cjs
node scripts/prepare-updates.cjs
node --input-type=module -e '
import fs from "node:fs/promises";import path from "node:path";import crypto from "node:crypto";import{execFileSync}from"node:child_process";import{packager}from"@electron/packager";
const root=process.cwd(),version=JSON.parse(await fs.readFile("package.json")).version;
await fs.mkdir("dist-macos",{recursive:true});const work=await fs.mkdtemp(path.join(root,"dist-macos/build-"));await fs.mkdir("releases",{recursive:true});
const manifest=JSON.parse(await fs.readFile("releases/manifest.json"));
for(const arch of ["arm64","x64"]){const[folder]=await packager({dir:root,out:path.join(work,"app"),name:"KeRnCloud Bridge",executableName:"KeRnCloud Bridge",platform:"darwin",arch,electronVersion:"45.0.0",appVersion:version,appBundleId:"de.kerncloud.bridge",asar:false,prune:true,ignore:(await import("./scripts/signing/common.cjs")).default.packagerIgnore()});const dmgRoot=path.join(work,arch);await fs.mkdir(dmgRoot);await fs.cp(path.join(folder,"KeRnCloud Bridge.app"),path.join(dmgRoot,"KeRnCloud Bridge.app"),{recursive:true});await fs.symlink("/Applications",path.join(dmgRoot,"Applications"));for(const[local,name]of [["bridge-anleitung-de.pdf","Anleitung Deutsch.pdf"],["bridge-guide-en.pdf","English guide.pdf"]])await fs.copyFile(path.join(root,"releases",local),path.join(dmgRoot,name));const name=`kerncloud-bridge-${version}-macos-${arch}.dmg`,file=path.join(root,"releases",name);execFileSync("hdiutil",["create","-volname","KeRnCloud Bridge","-srcfolder",dmgRoot,"-format","UDZO",file],{stdio:"inherit"});execFileSync("hdiutil",["verify",file],{stdio:"inherit"});const bytes=await fs.readFile(file);for(const f of manifest.files)if(f.platform==="darwin"&&f.arch===arch)f.primary=false;manifest.files=manifest.files.filter(f=>f.name!==name);manifest.files.push({name,label:arch==="arm64"?"macOS Apple Silicon":"macOS Intel",arch,platform:"darwin",format:"dmg",kind:"installer",primary:true,version,bytes:bytes.length,sha256:crypto.createHash("sha256").update(bytes).digest("hex"),signed:false,notarized:false,runtime_tested:false});}
await fs.writeFile("releases/manifest.json",JSON.stringify(manifest,null,2)+"\n");
'
