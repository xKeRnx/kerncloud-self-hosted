# Scaling and multi-server operation

Implemented locally in 0.24. This is a measured engineering baseline, not a guarantee of 100,000 simultaneously active users or containers.

## Data flow

- Browser state uses /api/state?view=<view>. Unneeded runs, messages, files, memory and ledger data are not selected. Artifact lists contain metadata; /api/artifacts/<id>/source loads source on demand after workspace authorization. Detail links select their run directly, including older runs.
- Tasks have keyset pagination using the timestamp plus ID; the UI can load older tasks. Every query remains workspace scoped. The legacy state response is retained for integrations and the existing data export.
- A shared direct PostgreSQL LISTEN connection per app process receives small committed invalidations containing IDs and table names, never secrets or content. Subscriptions are indexed by workspace/account/user. Browser reconciliation is event driven, with a 60-second fallback and refresh when returning to a visible tab.
- Live chat shares its database result per workspace, debounces committed changes and does not poll every 700 ms. Slow consumers are disconnected instead of consuming unbounded memory. Streams revalidate access; security changes prompt immediate revalidation. Reconnection reads authoritative state again: NOTIFY is not a durable message queue.

## Binary object storage

Generated binary artifacts (Office documents) are encrypted with AES-256-GCM before leaving the app. The private HTTP object service stores opaque immutable objects. It is not published on a host port and accepts only an operator token. Customer download and preview permissions stay in the app; object keys are never public download credentials.

Metadata includes plaintext byte count and SHA-256. Each read verifies both after authenticated decryption. Text/source projections remain in PostgreSQL for code operations and full-text search; statutory invoice records also remain in their existing archive. Raw uploaded documents were previously extracted into text rather than retained as binary originals; that behavior is unchanged.

Old binary_data rows remain readable. The scheduler copies batches, reads the encrypted copy back and compares bytes before atomically clearing the database binary. Storage failures preserve the original. Enable OBJECT_STORAGE_URL and OBJECT_STORAGE_TOKEN consistently on every app/scheduler instance. After migration, starting an old app image without object-storage support cannot read migrated binary objects: use a compatible image or restore the matching backup set in a separate environment.

Object data is in the object_data volume, separate from postgres_data. Multiple storage frontends require the SAME durable shared filesystem; independent local volumes are not replicas. The included filesystem service does not provide cross-region replication, S3 semantics or automatic storage failover. A public deployment must provide redundant storage and test failures/restores.

Database deletion queues object deletion transactionally. The scheduler removes referenced deletions after 30 days, preserving a restore grace period. An upload key is registered independently before writing the object, so a rolled-back application transaction also leaves a collectible record. Unreferenced upload records are reconciled against live artifact metadata after 30 days and then removed, with a bounded batch of 100 per hourly job. A queued deletion retains its separate 30-day restore grace period. Include the grace period in privacy/retention procedures. Object registration uses one additional short-lived database connection per app process to avoid deadlocking a saturated transaction pool.

## Backup and restore

npm run backup preserves the database dump and, once object-storage is running, a streamed .objects.tar.gz archive and a manifest beside it. Immutable objects are copied after the database snapshot. Store ENCRYPTION_KEY separately. Backups on the same machine are not disaster recovery. Copy the matching set to another protected system and restore-test BOTH the database and object volume. The 30-day object grace period must be at least as long as the supported database restore window, or older backups need their own full object archive.

## Gateways

Each gateway owns local sockets, but database leases identify the gateway currently owning each environment relay. Any gateway can authenticate a customer and forward HTTP or WebSocket traffic to the owning peer. Requests can travel at most one internal hop. Only configured peer addresses are accepted; no destination comes from a customer URL. Initial handshakes and forwarded requests use the same session, origin, generation and plan checks.

Lease refreshes and active-session checks are batched. Stale gateway ownership is fenced by a random token. A reconnect can claim a new owner. Active browser sockets may disconnect on failure; they are not magically moved between processes. Unconfirmed agent side effects retain the existing review rules and are not automatically repeated.

Set a private GATEWAY_ADVERTISE_URL, a unique operator GATEWAY_ID label and GATEWAY_PEERS (comma-separated host:port allowlist) on each node. The local compose enables one gateway. The reference cluster has two. Bound memory using GATEWAY_MAX_RELAYS (default 1,000) and GATEWAY_MAX_PENDING (default 2,000); clients receive a refusal when the limit is reached.

## Background work and connection budgets

The local compose starts a dedicated scheduler; workers set WORKER_MAINTENANCE=false and the app uses MAINTENANCE_MODE=external. Shared scheduler leases prevent every worker/replica from independently running the same background job. Leases have heartbeats and fenced completion; individual mail/payment/action handlers keep their existing idempotency and uncertain-outcome rules.

DB_POOL_MAX is bounded per process. Account for the sum across ALL app, gateway and scheduler replicas plus direct LISTEN connections, migration/administration and spare capacity before adding replicas. DATABASE_POOL_URL may point to a session-compatible pooler. DATABASE_URL remains the direct connection for LISTEN. Existing session advisory locks mean transaction pooling is NOT currently supported without further adaptation.

Admin /admin/infrastructure includes app-pool pressure, event subscriptions, gateway leases, object migration progress and scheduled jobs. Values for the app pool describe the responding instance, not an aggregate of the fleet. Use operator monitoring for per-instance CPU/RAM, event-loop lag, disk capacity, PostgreSQL latency/WAL/replication and provider limits.

## Deployment

Local: docker compose --profile infrastructure up -d --scale worker=2 app gateway worker scheduler object-storage infrastructure. Preserve volumes. Build the regular Dockerfile for portable images; it must include a writable /data directory owned by the node user for a fresh storage volume.

The reference deploy/compose.cluster.yaml runs two app replicas, two gateways, a scheduler, scalable workers and a Caddy edge against explicitly configured private PostgreSQL, storage and validator services. It is a topology example, not a public deployment performed by this task. Multi-machine operators deploy the same images on their hosts, replace advertised private addresses/upstreams and keep shared credentials/data services consistent. Docker Compose on one host is not a multi-host scheduler.

The edge provides streaming reverse proxying and healthy-upstream selection. There are no automatic retries for ambiguous model, payment or container actions. For worker requests use the private edge listener in the reference topology; remote workers use the configured HTTPS platform URL. Keep gateway peers, storage, database, worker credentials and validators on private networks. Configure PUBLIC_URL, PUBLIC_ENVIRONMENT_URL, wildcard environment DNS, TLS and external backups before publishing. Review OPERATIONS.md in addition to this document.

An optional autoscale Compose profile adjusts WORKER CONTAINERS on an existing Docker host; no VM or cloud purchase is made. It counts eligible demand capped by each account's plan and subtracts capacity supplied by other workers. Limits are AUTOSCALE_MIN/MAX (0/4 by default, hard maximum 16), fixed CPU/RAM/concurrency and an idle grace period. Only containers carrying its own group label are managed. Before scale-down, a shared row lock marks the worker draining and checks there are no running leased tasks; task claiming takes the same worker lock. The controller coordinates through a shared lease and stops after losing it. A registered host must have the selected image/network available. There is no automatic image pull. One step adds or removes at most one worker. Enable only after setting a suitable host resource budget: docker compose --profile autoscale up -d autoscaler. This profile is not enabled by the local update. Use a unique AUTOSCALER_ID per host and the reachable private platform URL/network on remote hosts.

Automatic creation of cloud VMs, a managed database failover system and a replicated storage backend remain deployment responsibilities. Add capacity based on measured queue age, request latency and memory pressure; provider API quotas can remain the bottleneck even when more servers are available.

## Reproducible local load test

Set TEST_DATABASE_URL to a dedicated name ending _test. npm run test:load creates clearly marked synthetic accounts and runs TWO real app processes sharing that database. Defaults: 1,000 synthetic registered accounts, 25 concurrent HTTP clients, 500 state reads, then 100 idle SSE subscriptions for five seconds. LOAD_USERS, LOAD_CONCURRENCY and LOAD_REQUESTS are bounded configurable inputs. No real model/provider/payment calls are made. The test never accepts the customer database name.

The JSON report is test-results/scaling-load.json: HTTP throughput, p50/p95, failures, response bytes, idle-stream database transaction growth and model-call count. Idle database commit counts are not SQL statement counts and may include delayed PostgreSQL statistics. A test-only preload counts app database calls without recording statements or parameters; app_sql_queries_during_idle reports the two app processes directly. The benchmark is not a measurement of 1,000 simultaneously running agents or 100,000 browsers. Repeat with production-like datasets, write workloads, provider stubs, long-running tasks, restarts and the intended hardware before selling a capacity guarantee.

## Sources used for protocol configuration

[PostgreSQL NOTIFY](https://www.postgresql.org/docs/17/sql-notify.html) describes commit-time notification delivery and payload limits. [Caddy reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) documents health checking, load balancing and streaming. The implementation relies on persisted database state rather than treating notifications as task storage.
