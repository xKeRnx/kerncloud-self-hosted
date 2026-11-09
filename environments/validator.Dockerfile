FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium ca-certificates fonts-dejavu-core && rm -rf /var/lib/apt/lists/* && npm install --prefix /opt/kerncloud --omit=dev --ignore-scripts --no-audit --no-fund playwright-core@1.64.1
COPY --chown=1000:1000 environments/validator.mjs /opt/kerncloud/validator.mjs
ENV HOME=/tmp
USER 1000:1000
ENTRYPOINT ["node", "/opt/kerncloud/validator.mjs"]
