# Workspace experience rebuild

Start and all-task views aggregate only the authenticated workspace across projects. Project pages use explicit /projects/:id/:section URLs; old URLs remain supported. The stored project preference is unchanged by workspace filters. Projects have Overview, Tasks, Results & files, Knowledge, Planning, with chat/search/settings shortcuts. Sharing, templates, repository and environment assignment stay available in project settings.

The workspace home prioritises input-required work, active tasks and saved results. A saved file on an unfinished run is labelled a partial result. Team configuration and observed runtime comparisons are secondary views. Task details separate progress, results, communication and technical controls. Existing checkpoints, processes, downloads and retries remain available.

New task creation shows an explicit project, original user goal, optional short title and expected result, file attachments, responsible agent and numeric total budget. Per-task values can reduce, never raise, the current workspace defaults. Transaction-time checks reject defaults changed while the form was open. Current jobs, model policy and permissions remain unchanged. No AI call generates UI summaries.

Settings link existing account, privacy, billing, invoices, members, briefing and budget functions. The operator console groups all existing admin pages into customers/plans, finance/company, AI/infrastructure, website/growth and security/audit. Administrative API authorization is unchanged.

Read APIs use workspace-bound joins, bounded lists and keyset pagination with PostgreSQL timestamp precision. No data migration or historical record rewriting is required. New support-mode reads expose only metadata already available through the scoped state view; credentials and administrative access remain protected.
