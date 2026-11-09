DO $$ BEGIN
IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=20) THEN
 ALTER TABLE memories ADD COLUMN expires_at timestamptz;
 CREATE TABLE memory_sources(memory_id text NOT NULL REFERENCES memories(id) ON DELETE CASCADE,workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,kind text NOT NULL CHECK(kind IN('run','artifact','attachment')),source_id text NOT NULL,fingerprint text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(memory_id,kind,source_id));
 CREATE INDEX memory_sources_lookup ON memory_sources(workspace_id,kind,source_id);
 CREATE TABLE memory_exclusions(workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,kind text NOT NULL,source_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,kind,source_id));
 CREATE TABLE provider_health(id text PRIMARY KEY,model_id text REFERENCES model_offerings(id) ON DELETE CASCADE,workspace_id text REFERENCES workspaces(id) ON DELETE CASCADE,cooldown_until timestamptz NOT NULL,reason text NOT NULL,failures integer NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now());
 ALTER TABLE tasks ADD COLUMN not_before timestamptz;
 ALTER TABLE plans ADD COLUMN max_automations integer NOT NULL DEFAULT 0 CHECK(max_automations BETWEEN 0 AND 1000),ADD COLUMN automation_runs integer NOT NULL DEFAULT 0 CHECK(automation_runs BETWEEN 0 AND 1000000);
 UPDATE plans SET max_automations=CASE id WHEN 'starter' THEN 1 WHEN 'pro' THEN 3 WHEN 'business' THEN 10 ELSE 0 END,automation_runs=CASE id WHEN 'starter' THEN 100 WHEN 'pro' THEN 500 WHEN 'business' THEN 2000 ELSE 0 END;
 CREATE TABLE automation_usage(account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,period text NOT NULL,calls integer NOT NULL DEFAULT 0,PRIMARY KEY(account_id,period));
 CREATE TABLE automations(id text PRIMARY KEY,workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,skill_id text NOT NULL REFERENCES skills(id) ON DELETE CASCADE,skill_version integer NOT NULL,name text NOT NULL,mode text NOT NULL CHECK(mode IN('agent','pipeline','pipeline_then_agent')),goal text NOT NULL,recipe jsonb,interval_minutes integer CHECK(interval_minutes BETWEEN 15 AND 43200),enabled boolean NOT NULL DEFAULT false,next_at timestamptz,token_limit integer NOT NULL CHECK(token_limit BETWEEN 1000 AND 10000000),credit_limit integer NOT NULL CHECK(credit_limit BETWEEN 0 AND 10000000),trigger_hash text,revision integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE automation_triggers(id text PRIMARY KEY,automation_id text NOT NULL REFERENCES automations(id) ON DELETE CASCADE,dedupe_key text NOT NULL,scheduled_at timestamptz NOT NULL DEFAULT now(),status text NOT NULL DEFAULT 'queued' CHECK(status IN('queued','admitting','started','blocked','uncertain')),run_id text REFERENCES runs(id) ON DELETE SET NULL,error text,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(automation_id,dedupe_key));
 CREATE INDEX automation_due ON automation_triggers(status,scheduled_at);
 INSERT INTO schema_migrations(version) VALUES(20);
 UPDATE environment_templates SET image='kerncloud-'||id||':0.4' WHERE id IN('browser','development') AND image='kerncloud-'||id||':0.3';
END IF;
END $$;
