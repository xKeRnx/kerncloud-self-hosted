#!/bin/sh
set -eu
: "${PASSWORD:?Environment access password is required}"
: "${KERNCLOUD_CONTROL_TOKEN:?Agent controller token is required}"
mkdir -p "$HOME/project" "$HOME/.config" "$HOME/.local/share"
trap 'kill $(jobs -p) 2>/dev/null || true' EXIT INT TERM
node /opt/kerncloud/controller.mjs > /tmp/controller.log 2>&1 &
controller_pid=$!
/usr/bin/code-server --bind-addr 0.0.0.0:8080 --auth password --disable-telemetry --disable-update-check "$HOME/project" &
editor_pid=$!
while kill -0 "$editor_pid" && kill -0 "$controller_pid"; do sleep 2; done
exit 1
