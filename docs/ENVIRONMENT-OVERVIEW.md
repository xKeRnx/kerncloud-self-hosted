# Workspace environment overview (0.29)

/environments/all lists environments across all projects of the authenticated workspace, with visible project names, filters, status/search, 25-row pagination and automatic refresh. It never changes the user's saved project selection. The account's other workspaces remain isolated. The existing /environments page remains scoped to the selected project. Workspace navigation exposes All environments.

Owners and workspace admins can start, stop and reassign. Viewers/editors receive read-only metadata and cannot invoke the mutations. Start/stop resolves the environment's real project and calls the existing customer lifecycle, preserving minute reservations, plan limits, controller jobs, gateway checks and tenant boundaries. A stale expected project fails with a conflict. No keys, credentials, command arguments or file contents are exposed by the overview.

Reassignment preserves files and existing agent settings but changes the project guard. It is allowed only for booked/stopped environments with inactive billing, no queued/running/uncertain infrastructure or tool actions, and compatible Git assignment. The dialog explains that authorised target-project agents can reach retained files. Existing project reassignment endpoints receive the same guards.

The interactive timeline now uses work-timeline-bar instead of timeline-item. The old class belongs to activity-feed rows; sharing it made live messages absolutely positioned coloured bars. Activity feeds on overview, task details and activity history retain their normal document flow.
