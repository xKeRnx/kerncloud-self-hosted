# Timeline and project overview (0.27)

Planned and actual timelines share a client-side interactive chart. Zoom in/out is bounded by available history and a one-minute minimum. Drag empty chart areas, use half-window arrows or the range slider to pan. Fit work includes all available loaded items, and Reset returns to the default view. The actual timeline offers 1h/24h/7d/30d presets and loads at most 300 task records from the preceding 31 days; zoom does not fetch unlimited history. Work overlapping the left boundary remains visible. Concurrent task intervals use separate lanes. Recorded durations of older work still depend on available agent/run events, as described in the UI.

Hover and keyboard focus show a custom detail card. Click pins the card so its task link can be used; Escape, Close or clicking outside dismisses it. Planned cards also show estimates, confidence and prerequisite counts. Screen-reader labels, visible focus and reduced-motion styles are provided. All zoom, hover and pan operations run locally and generate no model calls.

/projects and /projects/<id> both activate the Project tab. The selected project now has live database totals for run statuses, measured tokens, charged and reserved credits, uploaded files, deliverables, assigned agents, memories and environments, plus five recent runs. Unknown token quantities are identified instead of silently treated as measured. BYOK calls and external provider billing remain distinct. Project limits do not grant account credit. Values are scoped to the selected project; subscription slots and runtime balances remain account-wide.

Environment booking and listing already attached resources to projects. This update also scopes customer management, launch tickets, activity history and agent selection to the selected project. Agent auto-wake resolves its run project; the scheduler's internal idle shutdown still operates across workspace projects. Moving an environment between projects remains an explicit stopped-environment action and retains its existing files. These project selections do not add project-private human memberships inside a workspace.

Project content and the Git/environment disclosure now share a 24px vertical stack. Long material names wrap without displacing their sharing controls. No schema migration or existing data rewrite is required.

## Remembered project

The browser remembers the selected project for one year using a first-party preference cookie per workspace. Reloading a project page, opening tasks/files, or returning to a workspace uses that selection. An explicit project link takes precedence. Deleted, foreign or malformed cookie selections fall back to the workspace default. This preference grants no permissions and is not synchronized across browsers or devices. Workspace switching clears only the in-memory selection and generic compatibility cookie.
