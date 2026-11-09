DO $$ BEGIN
IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=8) THEN
 ALTER TABLE customer_environments ADD COLUMN agent_permissions jsonb NOT NULL DEFAULT '[]';
 ALTER TABLE customer_environments ADD COLUMN agent_ids jsonb NOT NULL DEFAULT '[]';
 ALTER TABLE customer_environments ADD COLUMN controller_seen timestamptz;
 CREATE TABLE environment_tool_calls(
  id text PRIMARY KEY, operation_id text NOT NULL UNIQUE REFERENCES operations(id) ON DELETE CASCADE,
  environment_id text NOT NULL REFERENCES customer_environments ON DELETE CASCADE,
  generation integer NOT NULL, task_id text NOT NULL REFERENCES tasks ON DELETE CASCADE,
  task_lease text NOT NULL, permission text NOT NULL, tool text NOT NULL, args jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK(status IN('queued','running','done','uncertain','canceled')),
  result jsonb, created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, finished_at timestamptz
 );
 CREATE UNIQUE INDEX environment_tool_single ON environment_tool_calls(environment_id) WHERE status='running';
 UPDATE environment_templates SET image='kerncloud-browser:0.3',name=CASE WHEN name='Browser · Firefox Desktop' THEN 'Browser · Chromium Desktop' ELSE name END WHERE id='browser' AND image='kerncloud-browser:0.2';
 UPDATE environment_templates SET image='kerncloud-development:0.3' WHERE id='development' AND image='kerncloud-development:0.2';
 INSERT INTO schema_migrations(version) VALUES(8);
END IF;
END $$;
