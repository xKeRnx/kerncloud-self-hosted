# KeRnCloud local SaaS

Independent TypeScript/Next.js application with PostgreSQL and HTTP-connected workers. Keep all work local unless the user explicitly authorizes external deployment. The previous prototype lives elsewhere and is not a runtime dependency.

- Customer reads and writes must be scoped to the authenticated workspace on the server. Enforce admin permissions on every administrative endpoint.
- Never expose or log .env values, plaintext API keys, password hashes or session tokens. Preserve existing secrets and database volumes.
- Provider and MCP credentials are encrypted with AES-256-GCM. Remote workers are trusted operator services; customer code must never receive Docker daemon access.
- Real runtime execution requires a configured model. Protocol fixtures belong exclusively in tests and must be clearly identified.
- Maintain atomic task claiming, worker lease fencing, idempotent internal operations and explicit handling of uncertain external side effects.
- Local plan assignments and credit grants are tests, not payments. Do not claim production readiness, legal compliance, working Stripe billing, code execution, voice or advertising integrations until actually implemented and verified.
- Commands: npm run typecheck; npm test; npm run test:integration; npm run build. Integration tests require a dedicated database ending in _test and must not use the customer database.
- Local Docker services: docker compose up --build -d --scale worker=2. Preserve volumes when stopping. Never use down -v during routine work.
- Before public SaaS deployment, complete docs/OPERATIONS.md and verify the customer data lifecycle against the actual deployment and providers.
