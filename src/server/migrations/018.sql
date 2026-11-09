DO $$ BEGIN
IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=18) THEN
 ALTER TABLE workspaces ADD COLUMN run_credit_limit integer NOT NULL DEFAULT 10000 CHECK(run_credit_limit BETWEEN 0 AND 10000000), ADD COLUMN run_token_limit integer NOT NULL DEFAULT 100000 CHECK(run_token_limit BETWEEN 1000 AND 10000000), ADD COLUMN fallback_model_ids jsonb NOT NULL DEFAULT '[]';
 ALTER TABLE runs ADD COLUMN credit_limit integer NOT NULL DEFAULT 10000 CHECK(credit_limit BETWEEN 0 AND 10000000), ADD COLUMN token_limit integer NOT NULL DEFAULT 100000 CHECK(token_limit BETWEEN 1000 AND 10000000), ADD COLUMN model_policy jsonb NOT NULL DEFAULT '{}';
 ALTER TABLE tasks ADD COLUMN fallback_index integer NOT NULL DEFAULT 0, ADD COLUMN skill_proposal jsonb;
 ALTER TABLE artifacts ADD COLUMN retired boolean NOT NULL DEFAULT false;
 ALTER TABLE model_calls ADD COLUMN budget_tokens integer NOT NULL DEFAULT 0, ADD COLUMN provider_failed boolean NOT NULL DEFAULT false;
 ALTER TABLE skills ADD COLUMN status text NOT NULL DEFAULT 'approved' CHECK(status IN('draft','approved','rejected')), ADD COLUMN source_run_id text REFERENCES runs(id) ON DELETE SET NULL, ADD COLUMN evidence jsonb NOT NULL DEFAULT '[]', ADD COLUMN review_note text NOT NULL DEFAULT '', ADD COLUMN reviewed_by text REFERENCES users(id) ON DELETE SET NULL, ADD COLUMN reviewed_at timestamptz;
 CREATE UNIQUE INDEX skill_run_draft_once ON skills(source_run_id) WHERE source_run_id IS NOT NULL;
 CREATE TABLE skill_revisions(skill_id text NOT NULL REFERENCES skills(id) ON DELETE CASCADE,version integer NOT NULL,content text NOT NULL,status text NOT NULL,evidence jsonb NOT NULL,review_note text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(skill_id,version));
 INSERT INTO skill_revisions(skill_id,version,content,status,evidence) SELECT id,version,content,status,evidence FROM skills;
 ALTER TABLE environment_tool_calls ALTER COLUMN task_id DROP NOT NULL, ALTER COLUMN task_lease DROP NOT NULL, ALTER COLUMN operation_id DROP NOT NULL;
 ALTER TABLE environment_tool_calls ADD COLUMN requested_by text REFERENCES users(id) ON DELETE CASCADE, ADD COLUMN parent_session text;
 CREATE TABLE run_checkpoints(id text PRIMARY KEY,workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,run_id text NOT NULL REFERENCES runs(id) ON DELETE CASCADE,name text NOT NULL,files jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE checkpoint_restores(id text PRIMARY KEY,checkpoint_id text NOT NULL REFERENCES run_checkpoints(id) ON DELETE CASCADE,workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,preview_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
 INSERT INTO schema_migrations(version) VALUES(18);
END IF;
END $$;
