# Workflows, engines and project results

English is the default. German remains available in the interface. Existing projects, credentials, task history and tool grants are retained by additive migrations.

## Choose the smallest useful workflow

Create a task with one of three modes:

| Mode    | Intended use                                 | Enforced boundary                                            |
| ------- | -------------------------------------------- | ------------------------------------------------------------ |
| Draft   | Reviewable files, reports and local previews | No external tools, pipelines, delegation or hiring           |
| Execute | One agent completing the assignment          | Existing authorized tools; no delegation or hiring           |
| Team    | Independent work requiring multiple roles    | Existing grants; all children share the original task budget |

Legacy tasks retain their stored policies. A mode grants no access, credits or extra tokens. Task limits may reduce workspace defaults; expanding a running task remains a separate explicit budget decision. Context compaction, focused file reads, content fingerprints and settled-call replay avoid unnecessary repeated input and provider calls. Reservations include estimated input and allowed output; unknown usage remains conservatively reserved.

When a child needs access or clarification, its decision stays in the inbox. The coordinator receives the blocker once and can continue independent work. Repeating the same wait puts the coordinator to sleep until a relevant change; it does not authorize polling or another budget.

## Engine adapters

Under AI models, choose the API protocol for each model:

- **Chat Completions**: the existing OpenAI-compatible path, including configured streaming and reasoning effort.
- **Responses**: stateless requests with `store: false`, tool-result correlation, encrypted reasoning continuity for the same model, and an output cap including reasoning tokens.
- **Anthropic Messages**: native headers, tool blocks and cache-aware token accounting. Currently uses provider-default reasoning; custom effort is rejected rather than ignored.

The two native adapters currently return complete JSON responses rather than incremental text. Model-catalog checks remain read-only and cannot prove successful generation or remaining provider credit. Missing capability data must be entered or confirmed manually. Native CLI/ACP processes with opaque token spending are deliberately unavailable for fixed-budget jobs: a timeout alone cannot enforce their total cost. API adapters all pass through the same task, project and credit admission checks; model switching still needs explicit approval.

## Task workplace and human control

Open a task’s **Workplace** tab. Its environments, live processes and results are grouped there. The workspace owner can pause the task and acquire human control, open the existing browser or development editor/terminal, then hand the environment back with or without resuming the task.

Acquisition waits for queued, running or uncertain environment operations to settle. Human control blocks new agent tools from every task using that environment. Existing interactive sessions are revoked at acquisition and handback. Grants are retained. The control flag coordinates KeRnCloud tools; it does not terminate independent operating-system processes that were already running. Task and workspace pause controls remain effective after handback.

## Durable project pages

In **Results & files**, save a text/HTML artifact as a project page. Subsequent updates keep the page ID and append immutable rendered versions; stale writes are rejected. Agents can discover and update private pages with `list_project_pages` and `save_project_page`, without rereading the entire report or creating another task.

Administrators can review a page and create a revocable link, expiring in seven days by default (API maximum: 90 days). Publishing stores a hash of the random link token. Existing public pages require explicit review before their content can change; agents cannot bypass this review. Linked assets are snapshotted with the version. Previews use an isolated sandbox blocking network requests and form submissions. Use **Open / print PDF** for a printable result. Historical private versions remain accessible in the project; revoking the public link removes anonymous access.

## Starter teams

In the project’s team template section choose **Website studio**, **Research desk** or **Office assistant**. Each package includes roles, instructions, acceptance criteria and a suggested token budget. Inspect the exact preview before importing. Import creates a separate planned project with paused agents and no model keys, connected accounts, device permissions or running routines. A suggested budget is not an allowance and does not change existing account or workspace caps. Real results still depend on the chosen model and authorized tools.

## Release and verification boundaries

Release images are immutable and version-bound. The desktop can host locally or act as a client of an existing server. Local server updates back up data and preserve the encryption configuration. Image rollback is allowed only when the database migration set matches its checkpoint.

Automated integration tests use disposable databases and explicit local protocol fixtures. They verify isolation, version history, revocation, mode restrictions, native protocol accounting, replay and zero additional HTTP calls after budget exhaustion. These fixtures do not claim successful work by a paid external model or a guaranteed amount of token savings.

Protocol references: [OpenAI Responses migration](https://developers.openai.com/api/docs/guides/migrate-to-responses), [OpenAI reasoning](https://developers.openai.com/api/docs/guides/reasoning), [Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create).
