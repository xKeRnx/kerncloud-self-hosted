#!/bin/sh
set -eu
test "${CI:-}" = true
test "${RUNNER_ENVIRONMENT:-}" = github-hosted
test -n "${RUNNER_TEMP:-}"
test -n "${GITHUB_WORKSPACE:-}"
sudo apt-get update -qq
sudo apt-get install -y xvfb dbus-x11 "$GITHUB_WORKSPACE/desktop-app/dist/KeRnCloud-0.38.2-linux-amd64.deb"
export KERNCLOUD_DESKTOP_DATA_DIR="$RUNNER_TEMP/native-update-runtime"
xvfb-run -a /opt/KeRnCloud/kerncloud-desktop --diagnostics-report "$RUNNER_TEMP/native-upgrade-before.json"
printf '%s' '{"fixture":"project:read","device":"synthetic"}' > "$KERNCLOUD_DESKTOP_DATA_DIR/grants.fixture.json"
before=$(sha256sum "$KERNCLOUD_DESKTOP_DATA_DIR/.env" "$KERNCLOUD_DESKTOP_DATA_DIR/grants.fixture.json")
client="$RUNNER_TEMP/native-updater-client"
mkdir -p "$client"
CLIENT="$client" node -e "const fs=require('fs');fs.writeFileSync(process.env.CLIENT+'/package.json',JSON.stringify({name:'kerncloud-updater-fixture',version:'0.38.2',main:process.env.GITHUB_WORKSPACE+'/desktop-app/tests/native-update.cjs'}));"
cp "$GITHUB_WORKSPACE/desktop-app/update-native.json" "$client/"
export CHROME_DEVEL_SANDBOX=/opt/KeRnCloud/chrome-sandbox
xvfb-run -a "$GITHUB_WORKSPACE/desktop-app/node_modules/electron/dist/electron" "$client"
unset CHROME_DEVEL_SANDBOX
test "$(dpkg-query -W -f='${Version}' kerncloud)" = "${RELEASE_TAG#v}"
xvfb-run -a /opt/KeRnCloud/kerncloud-desktop --diagnostics-report "$RUNNER_TEMP/native-upgrade-after.json"
test "$before" = "$(sha256sum "$KERNCLOUD_DESKTOP_DATA_DIR/.env" "$KERNCLOUD_DESKTOP_DATA_DIR/grants.fixture.json")"
REPORT="$RUNNER_TEMP/native-upgrade-after.json" node -e "const r=require(process.env.REPORT);if(!r.ok||!r.rendererLoaded||r.version!==process.env.RELEASE_TAG.slice(1))throw Error('Updated app verification failed');"
sudo dpkg --remove kerncloud
test "$before" = "$(sha256sum "$KERNCLOUD_DESKTOP_DATA_DIR/.env" "$KERNCLOUD_DESKTOP_DATA_DIR/grants.fixture.json")"
echo 'Real Linux native download, dpkg upgrade, first launch and retained fixture configuration/grants verified.'
