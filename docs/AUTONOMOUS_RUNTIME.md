# Autonomous runtime

New runs snapshot `model_policy.autonomy_version=1`. Existing runs retain their
original policy. Normal HTTP workers perform every model/tool step; there is no
operator-authored repair task or direct worker driver in the autonomous path.

## Context and recovery

The full journal, goal, user instructions and operation receipts remain stored.
Before every inference, a deterministic provider projection references saved
artifact/patch bodies, deduplicates older read ranges and bounds old tool outputs.
Older complete assistant/tool groups become a recoverable evidence index. The
latest group, incomplete calls, user instructions and correction evidence are
retained. The 18,000-byte context target is soft; mandatory instructions are still
admitted when they fit the real remaining budget. UTF-8 bytes remain a conservative
estimate, not a provider tokenizer. Unknown model windows default to 131,072;
output configuration no longer invents a larger context window in this path.

`tasks.context_state` retains the projected working state and loaded tool names.
The original journal reconstructs the same state after a restart. No extra model
call is needed to compact. Core artifact tools stay available; `tool_catalog`
loads up to six additional authorized schemas for subsequent requests. Tool
discovery never grants environment, MCP or admin rights.

Invalid JSON arguments receive a concrete correction result without executing a
guessed `{}` call. Correction attempts remain bounded. Loop observations and
intervention counts include the entire run, including delegated tasks, and are
unaffected by context compaction. Unknown external effects still require review.
Purely local validation failures are fed back for patching and a new test.

Every inference uses the existing atomic shared run budget, including failures,
fallbacks and uncertain reservations. The autonomous output ceiling per request
is at most 16,384 tokens including reasoning; an output reserve below the smaller of 2,048 tokens and the explicitly configured
model output ceiling prevents another paid step. These are internal ceilings, never increases
to the configured run limit. Provider Euro costs are not inferred from BYOK
platform credits. Only user-authorized fallback models remain eligible.

## Browser validation

Compose adds `artifact-validator`, built from the existing pinned local browser
image. It is non-root, read-only, memory/CPU/PID limited, has no host mounts or
Docker access, and is attached only to an internal validation network. No host
port is published. Chromium receives no authentication token in its environment.
The service uses the worker secret for backend authentication; customer HTML is
never given that secret.

`validate_artifact` can only load current HTML and assets belonging to the same
workspace/run. The app renders the exact preview HTML and CSP. Every request uses
fresh browser contexts at 1440px and 390px. Network requests are intercepted and
denied; the preview CSP independently denies connections and form submission.
Tests accept bounded CSS-selector actions and assertions, not arbitrary JS or URLs.
JS/console errors, empty content, horizontal overflow or a failed assertion fail
the test. Reports are downloadable JSON artifacts and operation receipts.

At most eight browser validations are admitted per run. A 30-second watchdog kills
a stuck service process; Compose restarts it. No success is inferred from timeout.
The browser fixture smoke test covers auth, a real JS error, successful repair,
keyboard interactions, both viewports, overflow and outbound-network rejection.

Both `finish_task` and ordinary final text require a successful receipt for each
current HTML artifact. A fingerprint covers active preview HTML/CSS/JS/SVG files;
changing a file invalidates prior acceptance. A saved HTML file or a model-written
JSON test report is insufficient. Pure text/document tasks do not require a
browser. Test assertions are selected by the agent and do not establish complete
semantic correctness or universal accessibility.

Successful workflows remain human-reviewable skill drafts. The system appends
observed tools, actual browser receipts, fingerprints and fixed run limits to the
model's proposal. Proposed prerequisites and untested claims still require review.

## Local verification and operation

Run typecheck, unit tests, integration tests on a dedicated `_test` database, and
the production build before deploying locally. Run the real Chromium smoke script
inside an isolated validator container, with a fixture-only credential. The test
server in `tests/integration/agent-workflows.ts` is explicitly a protocol fixture,
not browser acceptance. Run heavy Docker builds and integration checks serially
on this host's 4GB Docker VM. Preserve database volumes and the previous image.

For a real autonomy test, record the initial goal, limits, model selection and run
ID once. Observe through read-only queries. Do not write repair messages, accept
tasks manually, change the source/runtime mid-run, reset a budget or start hidden
replacement tasks. Any such intervention makes the test assisted. A failure is
reported honestly with artifacts and usage retained.

## Follow-up after the first real acceptance run

The first unattended test stopped at 71,588 measured tokens without completing.
It is retained as a failed acceptance test; it was not manually resumed or fixed.
Repeated full-file inspection and overly conservative byte-only reservations
prevented completion. The next test is capped at the remaining 28,412 tokens,
so both real trials together remain within 100,000 tokens.

Autonomous runs now use a shorter stable system prefix and one bounded memory
index. Core schema descriptions are concise, with complete argument schemas still
present. Broad file reads are limited to 1,600 characters; exact search remains
available. After an HTML patch, the runtime automatically reruns the previous
agent-selected browser checks without another model call. The eight-check limit,
lease checks, tenant scope and fingerprint validation remain in force.

Input reservations can reuse the last provider-reported prompt measurement only
with identical model, system and tool prefix. Unchanged input units are matched
with multiplicity; new or changed units are charged at their UTF-8 byte bound,
plus framing/boundary reserves. Removed history is never subtracted. Unknown
measurements or changed prefixes fall back to the original conservative byte
bound. This is a provider-usage-based preflight estimate, not an exact tokenizer
or a provider Euro cost guarantee. Atomic shared budget enforcement is unchanged.
Optional per-run limits can only reduce the workspace limits and never change
workspace settings or allowed models.

## Bundled delivery for simple website creation

New single-agent website creation tasks without attached repositories, skills or
MCP connections use a small delivery profile. `deliver_artifacts` receives complete
files, explicit browser checks and a summary in one model response. It saves the
files transactionally, performs real browser validation, and only completes the
task and saves a skill draft when the current fingerprint is accepted. Failed
validation returns actionable feedback and leaves the task open. It performs no
external actions and cannot increase a budget. Saved HTML without a file extension
receives `.html`; this prevents wasting model calls on filename corrections.
Internal automatic browser receipts now receive the same hashes as ordinary tool
receipts, so their evidence can be independently verified. A stable local stage
allows a resumed delivery to reuse known file IDs; unknown external effects retain
the existing review requirement.

## Efficient continuation and task presentation (0.12)

For autonomous tasks, older successful local read/file-operation groups are
compacted proactively after three recent groups; exact user constraints, pending
calls and error evidence remain available. The original journal is unchanged.
Unknown external effects are excluded from this proactive reduction. Recent file
excerpts share a 6KB projection allowance, and saved bundles are referenced even
when their browser validation fails. The soft projection target is 9KB; large
mandatory instructions are retained and admitted against the actual hard limit.

The persisted context tracks at most eight immutable file ranges actually visible
in the last model request. Repeating an identical visible range returns a small
reference instead of copying its contents again. An evicted/truncated range, a new
file version or another range is read normally. Website repair profiles expose
patch/finish/discovery initially, with additional schemas loaded on demand.
Stateless provider requests still require policy and goal context; this does not
claim that an entire agent conversation can be omitted or that provider billing
is eliminated.

Task titles now use a bounded first line. The complete original prompt remains
escaped text in a collapsible description with normal-size scrollable content.
No goal or audit record is rewritten for presentation.

Any new real acceptance experiment authorized for 10,000 total tokens must count
all model attempts, including unknown consumption reserved at the full admission
bound. A public, non-billable connectivity check must succeed before starting;
failed connectivity must not consume the experiment on blind paid retries.

## Runtime 0.13

See RUNTIME-UPGRADE-0.13.txt for resumable environment processes, bounded tool
pipelines, explicit cache preference and measured-cost reporting, independent
acceptance checks, DE/EN tool discovery, memory provenance, shared provider
cooldowns and reviewed skill automations with account-wide plan quotas.
These are independent implementations; no upstream source was copied.
