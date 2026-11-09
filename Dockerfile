FROM node:22-bookworm AS build
RUN apt-get update && apt-get install -y --no-install-recommends default-jre-headless poppler-utils && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run typecheck && npm test && npm run test:local && NODE_OPTIONS=--max-old-space-size=1536 npm run build -- --webpack
FROM node:22-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends default-jre-headless && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /data /app/test-results && chown node:node /data /app/test-results
USER node
EXPOSE 3100
CMD ["npm", "run", "start:container"]
