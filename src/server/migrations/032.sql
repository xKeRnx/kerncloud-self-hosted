DO $$ BEGIN
IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=32) THEN
 CREATE TABLE bridge_tokens(id text PRIMARY KEY,workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,name text NOT NULL,token_hash text NOT NULL UNIQUE,scope jsonb NOT NULL DEFAULT '{}',expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),used_at timestamptz,revoked_at timestamptz,deleted_at timestamptz);
 CREATE INDEX bridge_tokens_workspace ON bridge_tokens(workspace_id,created_at);
 CREATE TABLE bridge_devices(id text PRIMARY KEY,workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,token_id text NOT NULL UNIQUE REFERENCES bridge_tokens(id) ON DELETE CASCADE,name text NOT NULL,platform text NOT NULL,credential_hash text NOT NULL UNIQUE,enabled boolean NOT NULL DEFAULT true,local_paused boolean NOT NULL DEFAULT true,local_policy jsonb NOT NULL DEFAULT '{}',last_seen timestamptz,created_at timestamptz NOT NULL DEFAULT now(),revision int NOT NULL DEFAULT 1,deleted_at timestamptz);
 CREATE INDEX bridge_devices_workspace ON bridge_devices(workspace_id,created_at);
 CREATE TABLE bridge_jobs(id text PRIMARY KEY,workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,device_id text NOT NULL REFERENCES bridge_devices(id) ON DELETE CASCADE,operation_id text NOT NULL UNIQUE REFERENCES operations(id) ON DELETE CASCADE,task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,task_lease text NOT NULL,project_id text NOT NULL,agent_id text NOT NULL,device_revision int NOT NULL,action text NOT NULL,args_cipher text NOT NULL,status text NOT NULL DEFAULT 'queued' CHECK(status IN('queued','running','done','uncertain','canceled')),claim_lease text,claim_until timestamptz,result jsonb,created_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz);
 CREATE INDEX bridge_jobs_claim ON bridge_jobs(device_id,status,created_at);
 INSERT INTO schema_migrations(version) VALUES(32);
END IF; END $$;
