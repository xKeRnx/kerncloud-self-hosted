# Agent activity inspector

Open `/agents/<id>` using an agent name or **Inspect** on a team card. Task cards link directly to `/agents/<id>?task=<id>`. URLs survive reload. The page covers the authenticated workspace; its project filter never changes the account's preferred project.

The read-only API verifies workspace membership and binds every task to both its workspace and agent. Viewers can inspect, but gain no write permissions. Support sessions retain their existing endpoint allowlist; this feature does not expand support access.

The page shows task state and blockers, model assignments and recent actual model calls, agent-scoped usage totals, and the full run's shared budget. Measured usage is separate from unknown/reserved usage. BYOK is labelled separately from platform credits. Model-call history shows the latest 20 calls, explicitly labelled; usage totals cover all matching calls.

The transcript loads the latest 20 saved user/assistant/tool messages, with older pages by immutable message index. Original system instructions, provider response objects and reasoning fields are not exposed. Structured credential fields and common credential patterns are redacted. Every display string is React-escaped; no generated HTML is executed. Long messages are truncated with a notice. The stored original messages remain untouched.

Delegations show parent/child task instructions and saved results; agent links open the corresponding inspector. Communication events include other participants in the same run, with sender and timestamp. Planned steps come from saved project plan entries for that agent and current run or unassigned work in the same project. They are labelled as estimates and may include other work; missing plans are not invented.

Visible tabs poll every five seconds. Hidden tabs stop polling. Responses from obsolete effects are ignored. Inspection starts no model call or environment action and does not change task status, budgets, agent permissions or the preferred project.

Verification includes unit tests for route parsing and bounded credential/reasoning projections, and integration tests for tenant/agent isolation, project filtering, viewer reads, transcript pagination, shared budgets, incoming messages, delegation, preference preservation and absence of provider calls.
