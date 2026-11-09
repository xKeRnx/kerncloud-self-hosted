# Projects and agent organisation

Version 0.25 adds general projects inside each workspace. Existing data is preserved in the active **Allgemein / Bestand** project. Existing Git development bindings remain available inside their owning general project. New workspaces receive a default project and a coordinator reporting directly to the user.

## Data boundaries

Runs belong to exactly one project. Tasks, results, checkpoints and task conversations inherit their run's project. Attachments, memory, skills, routines, Git bindings and environments have explicit project IDs. The server validates supplied project IDs against the authenticated workspace. The project cookie is a selection preference, never an access credential. Workspace members can still inspect projects within their authorised workspace; this feature does not introduce project-private human memberships.

Agent checkout, model reservations, delegation and leased operations enforce project-agent assignments. Context and full-text retrieval include the current project and explicitly workspace-shared materials. Source-ID guessing does not authorise reading a different project. Memory keys can repeat across projects. An agent cannot cite another project's private attachment, run or artifact as a memory source. Only workspace owners/admins can share material across projects. Review shared skills and third-party connection permissions: connections remain independently authorised by their existing agent grants and provider-side scopes.

A browser or development environment belongs to one project, in addition to its existing template, host, generation and agent grants. A directory alone does not isolate files from an authorised shell. Use separate environments/volumes for private project data. Reassign only stopped/booked environments without pending actions. Reassignment retains existing files: review or reset the environment before assigning it to a project that must not see its old contents. Git bindings must stay with the environment's project. Files and archives already downloaded by a user cannot be revoked remotely.

## Budgets and execution

Project credit and token caps cover all runs, including conservative reservations and uncertain usage. Project-row locking serialises concurrent reservations. Existing account, subscription, plan, agent and task limits also apply. A configured agent monthly credit cap uses UTC months. BYOK provider charges remain external; use provider-side spending limits as well. No new balance is granted when an agent is created.

The default migration project retains the previous account/task budget behaviour using a high compatibility ceiling; lower it in the project editor if desired. New project forms propose explicit smaller limits. Paused, completed and archived projects do not admit new work or leased operations. In-flight external effects may already have occurred and retain the existing uncertain-outcome handling.

## Plan and timeline

Plan steps contain an owner, intended start, target date, a min/max estimate in minutes, confidence, prerequisites and a human lock. Dependencies must form an acyclic graph inside one project. Agents cannot change locked steps. Changes from the user are announced to active project runs using compact event references; agents can request the full current plan using `project_status`.

Agents can bind a plan step using delegate_task(plan_item_id=...), then wait_for_team. These are subtasks of the SAME run and retain its shared token/credit caps; planning cannot reset an exhausted task budget. The checkout dependency gate also applies to these subtasks. Planning alone does not automatically purchase work. A user can also start a plan step as a task with the normal model and budget checks. Checkout waits for its planned start and completed prerequisites without model polling. Failed/canceled dependency runs do not count as completed. Existing runs determine the execution status of linked steps. The historical timeline shows recorded starts; time estimates and target dates are not completion guarantees.

## Organisation and hiring

An agent may report to one manager; cycles are rejected. Users can edit all reporting relationships and lock individual nodes or the whole organisation against agent changes. Manager status is a governance role and does not confer MCP, container, file or billing permissions. `propose_organisation` permits a manager to request changes inside its own unlocked project team. Reporting-line proposals always need human approval and are invalidated by changed organisation settings.

`request_agent` proposes a direct report with a reason, approved model, project assignment and a positive fixed monthly credit limit. The default policy is human approval through Decisions. Repeated approvals and retried operations do not create duplicate agents. The pending request performs no model calls for the proposed agent.

Automatic creation is disabled unless the owner/admin selects it. It is bounded by allowed roles/models, maximum automatically created agents, hierarchy depth, per-agent credit caps and the subscription's total agent count. Workspace and organisation locks protect concurrent checks. New agents receive no MCP connections, skills or environment grants automatically. Denials are persisted and cannot be retried under a new call ID to bypass the decision. Review model choice and external provider costs before enabling automation.

## Routines

Each routine belongs to a project and references a reviewed assigned skill. Existing routines retain bounded queue behaviour. New forms default to one coalesced follow-up and skipped missed schedules. Choose queue (maximum ten pending), coalesce (one pending follow-up), or skip (ignore triggers while pending/active). Missed schedules either produce one catch-up or are skipped; they never replay every missed interval. Paused routines and stale skill revisions retain their existing protections.

## Team packages

Export is an inspectable JSON whitelist: roles, instructions, reporting lines, project description, skills and routine definitions. It omits credentials, sessions, MCP connections, environment bindings, task files and transcripts. Known secret patterns are redacted, but free text may still contain confidential data: inspect before sharing. This is a reusable configuration package, not a disaster-recovery backup.

Import requires a matching preview hash and explicit review acknowledgement, enforces plan limits, remaps IDs and rejects invalid/cyclic references. It creates a planned project, paused agents, draft skills and disabled routines. It never enables an imported routine, provisions a container or installs arbitrary software. Re-importing the same package into the same workspace returns the prior import. Review instructions, skill contents, model settings and budgets before manually activating anything.

## Local verification

Run typecheck, unit tests, integration tests against a dedicated database ending `_test`, and production build. Integration fixtures cover project isolation, source guessing, memory provenance, environment grants, dependency admission, concurrent budget reservations, hierarchy locks, exact hire approvals, bounded automatic creation, routine burst handling and paused template import. They do not invoke a real AI provider or take payments.

Concept references reviewed: [Paperclip projects](https://docs.paperclip.ing/guides/projects-workflow/projects/), [timeline](https://docs.paperclip.ing/guides/day-to-day/work-timeline/), [organisation](https://docs.paperclip.ing/guides/org/org-structure/), and [hire approvals](https://docs.paperclip.ing/how-to/handle-board-approvals-for-hires/). KeRnCloud retains its own worker, tenant, billing and budget architecture.

Rollback to an older image requires the matching database backup: project-scoped memory keys intentionally replace the old workspace-only unique key. Preserve the compatible image, database dump and object archive together.
