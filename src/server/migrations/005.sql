ALTER TABLE users ADD COLUMN IF NOT EXISTS password_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS authenticated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS mfa_verified boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS account_security (
 user_id text PRIMARY KEY REFERENCES users ON DELETE CASCADE,
 totp_secret text, pending_secret text, pending_until timestamptz, last_step bigint NOT NULL DEFAULT -1,
 recovery_hashes jsonb NOT NULL DEFAULT '[]', enabled_at timestamptz
);
CREATE TABLE IF NOT EXISTS login_challenges (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users ON DELETE CASCADE, attempts integer NOT NULL DEFAULT 0,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '5 minutes'
);
CREATE TABLE IF NOT EXISTS oauth_identities (
 provider text NOT NULL CHECK(provider IN('google','github')), subject text NOT NULL, user_id text NOT NULL REFERENCES users ON DELETE CASCADE,
 email text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(provider,subject), UNIQUE(provider,user_id)
);
CREATE TABLE IF NOT EXISTS oauth_states (
 id text PRIMARY KEY, provider text NOT NULL, verifier text NOT NULL, nonce text NOT NULL, link_user_id text REFERENCES users ON DELETE CASCADE,
 intent text NOT NULL, privacy boolean NOT NULL DEFAULT false, expires_at timestamptz NOT NULL DEFAULT now()+interval '5 minutes'
);
CREATE TABLE IF NOT EXISTS infrastructure_hosts (
 id text PRIMARY KEY, name text NOT NULL, kind text NOT NULL CHECK(kind IN('docker','aws_ecs')),
 token_hash text NOT NULL, enabled boolean NOT NULL DEFAULT true, provisioning boolean NOT NULL DEFAULT false,
 last_seen timestamptz, inventory jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS environment_templates (
 id text PRIMARY KEY, name text NOT NULL, image text NOT NULL, command jsonb NOT NULL DEFAULT '[]',
 cpu integer NOT NULL DEFAULT 1 CHECK(cpu BETWEEN 1 AND 16), memory_mb integer NOT NULL DEFAULT 512 CHECK(memory_mb BETWEEN 64 AND 32768),
 container_port integer NOT NULL DEFAULT 0 CHECK(container_port BETWEEN 0 AND 65535), network boolean NOT NULL DEFAULT false,
 enabled boolean NOT NULL DEFAULT false, user_id text NOT NULL DEFAULT '1000:1000', read_only boolean NOT NULL DEFAULT true
);
INSERT INTO environment_templates(id,name,image,command) VALUES('minimal','Minimale Docker-Testumgebung','alpine:3.22','["sleep","infinity"]') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS customer_environments (
 id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces ON DELETE RESTRICT, host_id text NOT NULL REFERENCES infrastructure_hosts,
 template_id text NOT NULL REFERENCES environment_templates, name text NOT NULL, generation integer NOT NULL DEFAULT 1,
 status text NOT NULL DEFAULT 'pending', resource_id text, endpoint text, last_error text, updated_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS environment_jobs (
 id text PRIMARY KEY, environment_id text NOT NULL REFERENCES customer_environments, host_id text NOT NULL REFERENCES infrastructure_hosts,
 action text NOT NULL CHECK(action IN('deploy','start','stop','reset','delete')), generation integer NOT NULL, spec jsonb NOT NULL,
 status text NOT NULL DEFAULT 'queued', lease text, lease_until timestamptz, result jsonb, error text, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS environment_jobs_queue ON environment_jobs(host_id,status,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS environment_jobs_active ON environment_jobs(environment_id) WHERE status IN('queued','running','uncertain');
INSERT INTO schema_migrations(version) VALUES(5) ON CONFLICT DO NOTHING;
