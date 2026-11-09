# Horizon workspace design

The default public homepage is Horizon. Clarity, Canvas and the comparison routes remain available.

Authenticated routes have a server-rendered `.workspace-horizon` wrapper. `app/workspace-horizon.css` owns the light palette, typography scale and component refinements. Its body selector also supplies inherited tokens to dialogs, tooltips and the shared footer. Marketing alternatives do not receive these tokens.

Existing application styles use semantic custom properties with their original fallback values. New application components should use `--ui-surface`, `--ui-subtle`, `--ui-line`, `--ui-ink`, `--ui-muted`, `--ui-accent` and the semantic success/warning/danger/purple variants rather than adding hard-coded dark colors. Primary actions use blue with white text; coral surfaces identify attention. Status colors retain their meanings. Avoid recoloring user content, screenshots or preview iframes.

Manrope is served locally from the existing font asset. The workspace uses readable 14–16 px controls/body text, larger page headings and responsive layouts. Existing navigation, workspace/project scoping, permissions, budgets, approvals and execution behavior are unchanged by the design layer.

`components/landing-workspace-gallery.tsx` owns the accessible five-view product gallery. Its tabs support left/right arrows, Home and End. Product screenshots also appear beside relevant feature explanations. Photography remains in the story and use-case sections. Large images can be opened for detail.

Screenshots in `public/images/workspace/` were captured from the real application UI using neutral fixtures in a dedicated database ending in `_test`. They are labelled example data and do not represent customer results, performance measurements or a live AI run. Refresh them only from a similarly isolated and sanitized environment. Never capture customer messages, credentials or private file contents for public marketing.
