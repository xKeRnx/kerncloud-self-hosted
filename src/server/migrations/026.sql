DO $$
BEGIN
IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=26) THEN
 CREATE TABLE workspace_members(workspace_id text NOT NULL REFERENCES workspaces ON DELETE CASCADE,user_id text NOT NULL REFERENCES users ON DELETE CASCADE,role text NOT NULL CHECK(role IN('admin','editor','viewer')),joined_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,user_id));
 CREATE INDEX workspace_members_user ON workspace_members(user_id);
 CREATE TABLE workspace_invitations(id text PRIMARY KEY,workspace_id text NOT NULL REFERENCES workspaces ON DELETE CASCADE,email text NOT NULL,role text NOT NULL CHECK(role IN('admin','editor','viewer')),token_hash text UNIQUE NOT NULL,invited_by text REFERENCES users ON DELETE SET NULL,expires_at timestamptz NOT NULL,accepted_by text REFERENCES users ON DELETE SET NULL,accepted_at timestamptz,revoked_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE workspace_notifications(id text PRIMARY KEY,workspace_id text NOT NULL REFERENCES workspaces ON DELETE CASCADE,user_id text REFERENCES users ON DELETE CASCADE,kind text NOT NULL,title text NOT NULL,body text NOT NULL,href text NOT NULL DEFAULT '/overview',source_key text NOT NULL,read_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(workspace_id,source_key));
 CREATE TABLE notification_reads(notification_id text NOT NULL REFERENCES workspace_notifications ON DELETE CASCADE,user_id text NOT NULL REFERENCES users ON DELETE CASCADE,read_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(notification_id,user_id));
 CREATE TABLE briefing_preferences(workspace_id text PRIMARY KEY REFERENCES workspaces ON DELETE CASCADE,enabled boolean NOT NULL DEFAULT false,timezone text NOT NULL DEFAULT 'Europe/Berlin',local_hour integer NOT NULL DEFAULT 8 CHECK(local_hour BETWEEN 0 AND 23),quiet_start integer NOT NULL DEFAULT 20 CHECK(quiet_start BETWEEN 0 AND 23),quiet_end integer NOT NULL DEFAULT 8 CHECK(quiet_end BETWEEN 0 AND 23),email boolean NOT NULL DEFAULT false,last_briefing_day text,last_event_id bigint NOT NULL DEFAULT 0);
 ALTER TABLE briefing_preferences ADD COLUMN locale text NOT NULL DEFAULT 'de' CHECK(locale IN('de','en'));
 CREATE INDEX attachment_search ON attachments USING gin(to_tsvector('simple',name||' '||coalesce(content,'')));
 CREATE INDEX artifact_search ON artifacts USING gin(to_tsvector('simple',name||' '||content));
 CREATE INDEX conversation_search ON chat_messages USING gin(to_tsvector('simple',content));
 ALTER TABLE customer_environments ADD COLUMN idle_minutes integer NOT NULL DEFAULT 0 CHECK(idle_minutes BETWEEN 0 AND 1440);
 ALTER TABLE customer_environments ADD COLUMN auto_wake boolean NOT NULL DEFAULT false;
 ALTER TABLE customer_environments ADD COLUMN last_activity_at timestamptz NOT NULL DEFAULT now();
 ALTER TABLE customer_environments ADD COLUMN storage_budget_mb integer NOT NULL DEFAULT 1024 CHECK(storage_budget_mb BETWEEN 64 AND 1048576);
 ALTER TABLE customer_environments ADD COLUMN storage_used_bytes bigint;
 ALTER TABLE customer_environments ADD COLUMN idle_stopped boolean NOT NULL DEFAULT false;
 CREATE TABLE work_app_connections(id text PRIMARY KEY,workspace_id text NOT NULL REFERENCES workspaces ON DELETE CASCADE,provider text NOT NULL CHECK(provider IN('google','microsoft','github')),name text NOT NULL,credential text NOT NULL,scopes text[] NOT NULL DEFAULT '{}',agent_ids jsonb NOT NULL DEFAULT '[]',write_enabled boolean NOT NULL DEFAULT false,enabled boolean NOT NULL DEFAULT true,revision integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE work_app_states(id text PRIMARY KEY,user_id text NOT NULL REFERENCES users ON DELETE CASCADE,workspace_id text NOT NULL REFERENCES workspaces ON DELETE CASCADE,provider text NOT NULL,verifier text NOT NULL,scopes text[] NOT NULL,name text NOT NULL,session_hash text NOT NULL,expires_at timestamptz NOT NULL,claimed_at timestamptz);
 CREATE TABLE work_projects(id text PRIMARY KEY,workspace_id text NOT NULL REFERENCES workspaces ON DELETE CASCADE,name text NOT NULL,repo_url text NOT NULL,branch text NOT NULL,environment_id text NOT NULL REFERENCES customer_environments,app_connection_id text REFERENCES work_app_connections ON DELETE SET NULL,preview_port integer CHECK(preview_port BETWEEN 1024 AND 65535),created_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE project_actions(id text PRIMARY KEY,project_id text NOT NULL REFERENCES work_projects ON DELETE CASCADE,workspace_id text NOT NULL REFERENCES workspaces ON DELETE CASCADE,actor text REFERENCES users ON DELETE SET NULL,task_id text REFERENCES tasks ON DELETE SET NULL,kind text NOT NULL,args_hash text NOT NULL,status text NOT NULL DEFAULT 'queued',result jsonb,created_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz);
 CREATE TABLE quality_evaluations(id text PRIMARY KEY,workspace_id text NOT NULL REFERENCES workspaces ON DELETE CASCADE,actor text REFERENCES users ON DELETE SET NULL,agent_id text NOT NULL REFERENCES agents,model_id text NOT NULL REFERENCES model_offerings,token_limit integer NOT NULL CHECK(token_limit BETWEEN 1000 AND 100000),credit_limit integer NOT NULL CHECK(credit_limit BETWEEN 0 AND 1000000),status text NOT NULL DEFAULT 'queued',created_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE quality_cases(id text PRIMARY KEY,evaluation_id text NOT NULL REFERENCES quality_evaluations ON DELETE CASCADE,position integer NOT NULL,goal text NOT NULL,contract jsonb NOT NULL,run_id text UNIQUE REFERENCES runs ON DELETE SET NULL,status text NOT NULL DEFAULT 'queued',verdict jsonb,UNIQUE(evaluation_id,position));
 CREATE TABLE quality_claims(evaluation_id text PRIMARY KEY REFERENCES quality_evaluations ON DELETE CASCADE,claimed_at timestamptz NOT NULL DEFAULT now());
 ALTER TABLE environment_tickets ADD COLUMN target_path text NOT NULL DEFAULT '/';
 ALTER TABLE artifacts ADD COLUMN binary_data bytea;
 ALTER TABLE artifacts ADD COLUMN binary_preview text;
 CREATE INDEX memory_search ON memories USING gin(to_tsvector('simple',title||' '||content));
 UPDATE environment_templates SET image='kerncloud-'||id||':0.5' WHERE id IN('browser','development') AND image='kerncloud-'||id||':0.4';
 INSERT INTO schema_migrations(version) VALUES(26);
END IF;
END $$;
