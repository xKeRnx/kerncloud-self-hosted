#!/bin/sh
set -eu
# This harness installs system packages only on a disposable GitHub-hosted VM.
test "${CI:-}" = true
test "${RUNNER_ENVIRONMENT:-}" = github-hosted
test -n "${GITHUB_WORKSPACE:-}"
test -n "${RUNNER_TEMP:-}"
export KERNCLOUD_DESKTOP_DATA_DIR="$RUNNER_TEMP/kerncloud-installer-linux-test/runtime"
proof="$GITHUB_WORKSPACE/test-results/linux-installed"
mkdir -p "$proof" "$KERNCLOUD_DESKTOP_DATA_DIR"
package=$(find "$GITHUB_WORKSPACE/desktop-app/dist" -maxdepth 1 -name '*.deb' -print -quit)
test -n "$package"
sudo apt-get update -qq
sudo apt-get install -y xvfb dbus-x11 "$package"
node --input-type=module -e "import {prepare} from '/opt/KeRnCloud/resources/server/scripts/self-host.mjs';prepare(process.env.KERNCLOUD_DESKTOP_DATA_DIR,{port:44100,gatewayPort:44200,database:'kerncloud_installer_linux_test',project:'kerncloud-installer-linux-test',email:'installer-linux@example.invalid'});"
native() {
  name=$1
  command=$2
  xvfb-run -a /opt/KeRnCloud/kerncloud-desktop --diagnostics-report "$proof/$name.json" --local-command "$command"
}
stop_fixture() {
  if test -f "$KERNCLOUD_DESKTOP_DATA_DIR/scripts/self-host.mjs"; then
    (cd "$KERNCLOUD_DESKTOP_DATA_DIR" && node scripts/self-host.mjs stop) || true
  fi
}
trap stop_fixture EXIT
native first-start doctor
native server-start start
native warm-start start
PROOF_DIR="$proof" node --input-type=module -e "import fs from 'node:fs';const p=process.env.PROOF_DIR;const cold=JSON.parse(fs.readFileSync(p+'/server-start.json')),warm=JSON.parse(fs.readFileSync(p+'/warm-start.json'));for(const phase of ['prepare','build','services','health','ready'])if(!cold.progressPhases.includes(phase))throw Error('Missing actual startup progress: '+phase);if(!warm.imagesReused)throw Error('Warm start unexpectedly rebuilt the server');"
node scripts/test-installed-preservation.mjs "$KERNCLOUD_DESKTOP_DATA_DIR" seed "$proof/preservation.json"
native server-update update
node scripts/test-installed-preservation.mjs "$KERNCLOUD_DESKTOP_DATA_DIR" verify "$proof/preservation.json"
test -n "$(find "$KERNCLOUD_DESKTOP_DATA_DIR/backups" -name '*.dump' -print -quit)"
sudo dpkg --remove kerncloud
test ! -e /opt/KeRnCloud/kerncloud-desktop
test -f "$KERNCLOUD_DESKTOP_DATA_DIR/.env"
node scripts/test-installed-preservation.mjs "$KERNCLOUD_DESKTOP_DATA_DIR" verify "$proof/preservation.json"
sudo apt-get install -y "$package"
native reinstall status
node scripts/test-installed-preservation.mjs "$KERNCLOUD_DESKTOP_DATA_DIR" verify "$proof/preservation.json"
native server-stop stop
sudo dpkg --remove kerncloud
test -f "$KERNCLOUD_DESKTOP_DATA_DIR/.env"
PROOF_DIR="$proof" node --input-type=module -e "import fs from 'node:fs';const root=process.env.PROOF_DIR;for(const name of ['first-start','server-start','server-update','reinstall','server-stop']){const r=JSON.parse(fs.readFileSync(root+'/'+name+'.json'));if(!r.ok||r.platform!=='linux'||!r.rendererLoaded||!r.sandbox||!r.contextIsolation||r.nodeIntegration)throw Error('Native verification failed: '+name);}const report={ok:true,fixture:true,platform:'Ubuntu 22.04 / disposable GitHub VM',install:true,firstNativeStart:true,firstServerStart:true,nativeUpdateAndBackup:true,uninstall:true,reinstall:true,sandboxEnabled:true,configurationAndDeviceGrantsPreserved:true,objectFilePreserved:true,modelCalls:0};fs.writeFileSync(root+'/lifecycle.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));"
