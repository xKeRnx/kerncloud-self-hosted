CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=2) THEN
  ALTER TABLE plans ADD COLUMN max_workspaces integer NOT NULL DEFAULT 1 CHECK(max_workspaces BETWEEN 1 AND 100);
  UPDATE plans SET max_workspaces=CASE id WHEN 'free' THEN 2 WHEN 'starter' THEN 5 WHEN 'pro' THEN 20 ELSE 1 END;
  CREATE TABLE accounts (id text PRIMARY KEY,owner_id text UNIQUE NOT NULL REFERENCES users ON DELETE CASCADE,plan_id text NOT NULL REFERENCES plans,credits integer NOT NULL DEFAULT 0 CHECK(credits>=0),subscription_status text NOT NULL DEFAULT 'free');
  INSERT INTO accounts(id,owner_id,plan_id,credits,subscription_status) SELECT id,owner_id,plan_id,credits,subscription_status FROM workspaces;
  ALTER TABLE workspaces DROP CONSTRAINT workspaces_owner_id_key;
  ALTER TABLE workspaces ADD COLUMN default_model_id text;
  ALTER TABLE agents ADD COLUMN model_id text;
  ALTER TABLE tasks ADD COLUMN model_id text;
  ALTER TABLE runs ADD COLUMN chat boolean NOT NULL DEFAULT false;
  CREATE TABLE model_offerings (
   id text PRIMARY KEY,workspace_id text REFERENCES workspaces ON DELETE CASCADE,name text NOT NULL,provider_name text NOT NULL,endpoint text NOT NULL,model text NOT NULL,secret text NOT NULL,
   input_rate numeric(12,4) NOT NULL DEFAULT 1000 CHECK(input_rate>=0),output_rate numeric(12,4) NOT NULL DEFAULT 1000 CHECK(output_rate>=0),base_credits integer NOT NULL DEFAULT 0 CHECK(base_credits>=0),
   active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now()
  );
  INSERT INTO model_offerings(id,workspace_id,name,provider_name,endpoint,model,secret,input_rate,output_rate) SELECT workspace_id,workspace_id,name,name,endpoint,model,secret,0,0 FROM providers;
  INSERT INTO model_offerings(id,name,provider_name,endpoint,model,secret) SELECT 'legacy-hosted',value->>'name',value->>'name',value->>'endpoint',value->>'model',value->>'secret' FROM settings WHERE id='hosted_provider';
  ALTER TABLE model_calls ADD COLUMN account_id text REFERENCES accounts ON DELETE CASCADE;
  ALTER TABLE model_calls ADD COLUMN model_id text;
  ALTER TABLE model_calls ADD COLUMN pricing jsonb NOT NULL DEFAULT '{}';
  ALTER TABLE model_calls ADD COLUMN input_tokens integer NOT NULL DEFAULT 0;
  ALTER TABLE model_calls ADD COLUMN output_tokens integer NOT NULL DEFAULT 0;
  ALTER TABLE model_calls ADD COLUMN charged_credits integer NOT NULL DEFAULT 0;
  CREATE TABLE attachments (id text PRIMARY KEY,workspace_id text NOT NULL REFERENCES workspaces ON DELETE CASCADE,name text NOT NULL,mime text NOT NULL,source text NOT NULL,content text NOT NULL,bytes integer NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE run_attachments (run_id text NOT NULL REFERENCES runs ON DELETE CASCADE,attachment_id text NOT NULL REFERENCES attachments ON DELETE CASCADE,PRIMARY KEY(run_id,attachment_id));
  CREATE TABLE chat_messages (id bigserial PRIMARY KEY,workspace_id text NOT NULL REFERENCES workspaces ON DELETE CASCADE,run_id text REFERENCES runs ON DELETE SET NULL,agent_id text,author text NOT NULL,content text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
  INSERT INTO schema_migrations(version) VALUES(2);
 END IF;
END $$;
CREATE OR REPLACE VIEW workspace_context AS SELECT w.id,w.owner_id,w.name,a.plan_id,a.credits,w.ai_mode,a.subscription_status,w.retention_days,w.default_model_id,w.created_at,a.id AS account_id FROM workspaces w JOIN accounts a ON a.owner_id=w.owner_id;
