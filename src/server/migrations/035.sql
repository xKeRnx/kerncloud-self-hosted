DO $migration$ BEGIN
IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=35) THEN
ALTER TABLE model_offerings ADD COLUMN IF NOT EXISTS engine_kind text NOT NULL DEFAULT 'openai-chat';
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='model_engine_kind') THEN
  ALTER TABLE model_offerings ADD CONSTRAINT model_engine_kind CHECK(engine_kind IN('openai-chat','openai-responses','anthropic'));
 END IF;
CREATE TABLE IF NOT EXISTS project_pages (
 id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,project_id text NOT NULL REFERENCES workspace_projects(id) ON DELETE CASCADE,
 preview_html text NOT NULL, title text NOT NULL, revision integer NOT NULL DEFAULT 1, artifact_id text NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
 share_hash text,share_expires_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS project_pages_share ON project_pages(share_hash) WHERE share_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS project_pages_project ON project_pages(workspace_id,project_id,updated_at DESC);
CREATE TABLE IF NOT EXISTS project_page_versions (
 page_id text NOT NULL REFERENCES project_pages(id) ON DELETE CASCADE, revision integer NOT NULL,preview_html text NOT NULL,artifact_id text NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(page_id,revision)
);
ALTER TABLE customer_environments ADD COLUMN IF NOT EXISTS human_controlled boolean NOT NULL DEFAULT false;
ALTER TABLE customer_environments ADD COLUMN IF NOT EXISTS control_owner_id text REFERENCES users(id) ON DELETE SET NULL;

INSERT INTO schema_migrations(version) VALUES(35);
END IF;
END $migration$;
