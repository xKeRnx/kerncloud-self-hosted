DO $$ BEGIN
IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=13) THEN
 ALTER TABLE users ADD COLUMN password_change_required boolean NOT NULL DEFAULT false;
 ALTER TABLE users ADD COLUMN invitation_pending boolean NOT NULL DEFAULT false;
 ALTER TABLE accounts ADD COLUMN access_expires_at timestamptz;
 ALTER TABLE accounts ADD COLUMN access_source text NOT NULL DEFAULT 'existing';
 ALTER TABLE accounts ADD COLUMN subscription_period_end timestamptz;
 ALTER TABLE accounts ADD COLUMN subscription_cancel_at timestamptz;
 CREATE INDEX accounts_access_expiry ON accounts(access_expires_at) WHERE access_expires_at IS NOT NULL;
 CREATE TABLE password_resets(id text PRIMARY KEY,user_id text NOT NULL REFERENCES users ON DELETE CASCADE,kind text NOT NULL CHECK(kind IN('reset','invite')),expires_at timestamptz NOT NULL,used_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
 CREATE INDEX password_resets_user ON password_resets(user_id);
 CREATE TABLE mail_outbox(id text PRIMARY KEY,user_id text REFERENCES users ON DELETE CASCADE,recipient text NOT NULL,purpose text NOT NULL,payload text,status text NOT NULL DEFAULT 'queued' CHECK(status IN('queued','sending','sent','failed','uncertain','canceled')),expires_at timestamptz NOT NULL,started_at timestamptz,finished_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
 CREATE INDEX mail_pending ON mail_outbox(status,created_at);
 CREATE TABLE support_sessions(id text PRIMARY KEY,actor_id text NOT NULL REFERENCES users ON DELETE CASCADE,parent_session text REFERENCES sessions ON DELETE SET NULL,target_id text NOT NULL REFERENCES users ON DELETE CASCADE,previous_workspace text,mode text NOT NULL CHECK(mode IN('read','write')),reason text NOT NULL,expires_at timestamptz NOT NULL,ended_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE customer_notes(id text PRIMARY KEY,user_id text NOT NULL REFERENCES users ON DELETE CASCADE,actor_id text REFERENCES users ON DELETE SET NULL,content text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE account_grants(id text PRIMARY KEY,account_id text NOT NULL REFERENCES accounts ON DELETE CASCADE,actor_id text REFERENCES users ON DELETE SET NULL,kind text NOT NULL CHECK(kind IN('gift','goodwill','test','adjustment')),plan_id text REFERENCES plans,access_until timestamptz,credits integer NOT NULL DEFAULT 0,runtime_seconds integer NOT NULL DEFAULT 0,amount_cents integer NOT NULL DEFAULT 0 CHECK(amount_cents=0),reason text NOT NULL,customer_message text NOT NULL DEFAULT '',receipt boolean NOT NULL DEFAULT false,fingerprint text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(account_id,id));
 CREATE INDEX account_grants_account ON account_grants(account_id,created_at);
 ALTER TABLE account_grants ADD COLUMN issuer_snapshot jsonb NOT NULL DEFAULT '{}';
 CREATE TABLE contract_declarations(id text PRIMARY KEY,kind text NOT NULL CHECK(kind IN('cancel','withdraw')),name text NOT NULL,email text NOT NULL,contract text NOT NULL,termination_type text NOT NULL DEFAULT 'ordinary',requested_end text NOT NULL DEFAULT 'nächstmöglich',reason text NOT NULL DEFAULT '',fingerprint text NOT NULL,confirmation_id text REFERENCES mail_outbox ON DELETE SET NULL,created_at timestamptz NOT NULL DEFAULT now(),processed_at timestamptz,processed_by text REFERENCES users ON DELETE SET NULL,outcome text NOT NULL DEFAULT '');
 CREATE INDEX contract_declarations_email ON contract_declarations(email,created_at);
 CREATE TABLE invoice_profile_jobs(id text PRIMARY KEY,account_id text NOT NULL REFERENCES accounts ON DELETE CASCADE,company_version integer NOT NULL,customer_id text NOT NULL,footer text NOT NULL,status text NOT NULL DEFAULT 'queued' CHECK(status IN('queued','running','done','failed','obsolete')),started_at timestamptz,finished_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
 INSERT INTO schema_migrations(version) VALUES(13);
END IF;
END $$;
