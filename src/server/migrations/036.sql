DO $migration$ BEGIN
IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=36) THEN
 ALTER TABLE work_app_connections DROP CONSTRAINT IF EXISTS work_app_connections_provider_check;
 ALTER TABLE work_app_connections ADD CONSTRAINT work_app_connections_provider_check CHECK(provider IN('google','microsoft','github','discord','slack','notion','linear','todoist','asana','clickup','airtable','hubspot','dropbox','figma','vercel','cloudflare','gitlab','ayrshare','apify'));
 ALTER TABLE work_app_connections ADD COLUMN service_id text;
 -- NULL preserves the workspace-wide grants of existing connections. New connections use explicit lists.
 ALTER TABLE work_app_connections ADD COLUMN project_ids jsonb CHECK(project_ids IS NULL OR jsonb_typeof(project_ids)='array');
 ALTER TABLE work_app_connections ADD COLUMN checked_at timestamptz;
 ALTER TABLE work_app_connections ADD COLUMN health text NOT NULL DEFAULT 'unchecked' CHECK(health IN('unchecked','ok','error'));
 ALTER TABLE work_app_connections ADD COLUMN health_message text;
 ALTER TABLE work_app_states ADD COLUMN service_id text;
 ALTER TABLE work_app_states ADD COLUMN project_ids jsonb;
 INSERT INTO schema_migrations(version) VALUES(36);
END IF;
END $migration$;
