FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates chromium xvfb x11vnc novnc websockify openbox caddy fonts-dejavu-core dbus-x11 procps git python3 curl bash && rm -rf /var/lib/apt/lists/* \
    && groupmod -n runner node && usermod -l runner -d /home/runner -m node \
    && npm install --prefix /opt/kerncloud --omit=dev --ignore-scripts --no-audit --no-fund playwright-core@1.64.1
COPY environments/browser/start.sh /usr/local/bin/kerncloud-start
COPY environments/controller.mjs environments/checkpoints.mjs environments/storage-budget.mjs environments/processes.mjs /opt/kerncloud/
RUN chmod 755 /usr/local/bin/kerncloud-start
ENV HOME=/home/runner DISPLAY=:99 XDG_RUNTIME_DIR=/tmp/runtime-runner XDG_CONFIG_HOME=/home/runner/.config XDG_DATA_HOME=/home/runner/.local/share KERNCLOUD_BROWSER=true
USER 1000:1000
WORKDIR /home/runner
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/kerncloud-start"]
