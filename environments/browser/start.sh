#!/bin/sh
set -eu
: "${KERNCLOUD_ACCESS_PASSWORD:?Environment access password is required}"
: "${KERNCLOUD_CONTROL_TOKEN:?Agent controller token is required}"
umask 077
mkdir -p "$XDG_RUNTIME_DIR" "$HOME/.config" "$HOME/.local/share" "$HOME/browser-profile" "$HOME/project"
hash=$(caddy hash-password --plaintext "$KERNCLOUD_ACCESS_PASSWORD")
cat > /tmp/Caddyfile <<EOF
{
  admin off
  auto_https off
}
:8080 {
  basicauth {
    kerncloud $hash
  }
  redir / /vnc.html?autoconnect=true&resize=remote 302
  reverse_proxy 127.0.0.1:6080
}
EOF
Xvfb :99 -screen 0 1440x900x24 -nolisten tcp -ac &
xvfb_pid=$!
trap 'kill $(jobs -p) 2>/dev/null || true' EXIT INT TERM
i=0
while [ ! -S /tmp/.X11-unix/X99 ]; do
  kill -0 "$xvfb_pid"
  i=$((i+1)); [ "$i" -lt 100 ]; sleep 0.1
done
openbox > /tmp/openbox.log 2>&1 &
x11vnc -display :99 -listen 127.0.0.1 -rfbport 5900 -nopw -forever -shared > /tmp/x11vnc.log 2>&1 &
websockify --web=/usr/share/novnc 127.0.0.1:6080 127.0.0.1:5900 > /tmp/websockify.log 2>&1 &
chromium --no-sandbox --disable-dev-shm-usage --no-first-run --no-default-browser-check --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 --user-data-dir="$HOME/browser-profile" about:blank > /tmp/chromium.log 2>&1 &
browser_pid=$!
node /opt/kerncloud/controller.mjs > /tmp/controller.log 2>&1 &
controller_pid=$!
caddy run --config /tmp/Caddyfile --adapter caddyfile > /tmp/caddy.log 2>&1 &
caddy_pid=$!
while kill -0 "$browser_pid" && kill -0 "$caddy_pid" && kill -0 "$controller_pid"; do sleep 2; done
exit 1
