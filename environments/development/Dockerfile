FROM node:22-bookworm-slim AS node
FROM ghcr.io/coder/code-server:4.140.0
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3 git curl ca-certificates bash && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && ln -sf ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
COPY environments/development/start.sh /usr/local/bin/kerncloud-start
COPY environments/controller.mjs environments/checkpoints.mjs environments/storage-budget.mjs environments/processes.mjs /opt/kerncloud/
RUN chmod 755 /usr/local/bin/kerncloud-start
ENV HOME=/home/runner
USER 1000:1000
WORKDIR /home/runner
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/kerncloud-start"]
