CREATE TABLE IF NOT EXISTS plans (
 id text PRIMARY KEY, name text NOT NULL, price_cents integer NOT NULL CHECK(price_cents>=0), credits integer NOT NULL CHECK(credits>=0),
 max_agents integer NOT NULL CHECK(max_agents BETWEEN 1 AND 50), max_steps integer NOT NULL CHECK(max_steps BETWEEN 1 AND 500),
 managed boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT true, stripe_price_id text
);
INSERT INTO plans(id,name,price_cents,credits,max_agents,max_steps,managed,active,stripe_price_id) VALUES ('free','Explorer',0,0,3,20,false,true,null),('starter','Starter',1900,100000,6,60,true,true,null),('pro','Business',4900,500000,15,150,true,true,null) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS users (
 id text PRIMARY KEY, email text UNIQUE NOT NULL, name text NOT NULL, password_hash text NOT NULL,
 role text NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user')), suspended boolean NOT NULL DEFAULT false,
 privacy_version text NOT NULL, marketing_consent boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (id text PRIMARY KEY, user_id text NOT NULL REFERENCES users ON DELETE CASCADE, expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS workspaces (
 id text PRIMARY KEY, owner_id text UNIQUE NOT NULL REFERENCES users ON DELETE CASCADE, name text NOT NULL,
 plan_id text NOT NULL DEFAULT 'free' REFERENCES plans, credits integer NOT NULL DEFAULT 0 CHECK(credits>=0),
 ai_mode text NOT NULL DEFAULT 'byok' CHECK(ai_mode IN ('byok','managed')), subscription_status text NOT NULL DEFAULT 'free',
 stripe_customer_id text, stripe_subscription_id text, retention_days integer NOT NULL DEFAULT 30 CHECK(retention_days BETWEEN 1 AND 365), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS providers (workspace_id text PRIMARY KEY REFERENCES workspaces ON DELETE CASCADE, name text NOT NULL, endpoint text NOT NULL, model text NOT NULL, secret text NOT NULL);
CREATE TABLE IF NOT EXISTS settings (id text PRIMARY KEY, value jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS agents (
 id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces ON DELETE CASCADE, name text NOT NULL, role text NOT NULL,
 instructions text NOT NULL, skill_ids jsonb NOT NULL DEFAULT '[]', mcp_ids jsonb NOT NULL DEFAULT '[]', color text NOT NULL DEFAULT 'cyan'
);
CREATE TABLE IF NOT EXISTS skills (id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces ON DELETE CASCADE, name text NOT NULL, description text NOT NULL, content text NOT NULL, version integer NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS connections (id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces ON DELETE CASCADE, name text NOT NULL, url text NOT NULL, secret text NOT NULL, allowed_tools jsonb NOT NULL DEFAULT '[]', enabled boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS runs (
 id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces ON DELETE CASCADE, goal text NOT NULL,
 status text NOT NULL DEFAULT 'running', max_steps integer NOT NULL, steps_used integer NOT NULL DEFAULT 0,
 tokens_used integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tasks (
 id text PRIMARY KEY, run_id text NOT NULL REFERENCES runs ON DELETE CASCADE, workspace_id text NOT NULL REFERENCES workspaces ON DELETE CASCADE,
 agent_id text NOT NULL REFERENCES agents, parent_id text REFERENCES tasks ON DELETE CASCADE, title text NOT NULL, instructions text NOT NULL,
 status text NOT NULL DEFAULT 'queued', result text, error text, messages jsonb NOT NULL DEFAULT '[]',
 worker_id text, lease_token text, lease_until timestamptz, attempts integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tasks_queue ON tasks(status,created_at);
CREATE INDEX IF NOT EXISTS runs_workspace ON runs(workspace_id,created_at DESC);
CREATE TABLE IF NOT EXISTS events (
 id bigserial PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces ON DELETE CASCADE, run_id text REFERENCES runs ON DELETE CASCADE,
 agent_id text, kind text NOT NULL, content text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS workers (id text PRIMARY KEY, name text NOT NULL, concurrency integer NOT NULL, last_seen timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS model_calls (
 id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces ON DELETE CASCADE, run_id text NOT NULL REFERENCES runs ON DELETE CASCADE,
 task_id text NOT NULL REFERENCES tasks ON DELETE CASCADE, reserved integer NOT NULL, managed boolean NOT NULL, status text NOT NULL DEFAULT 'reserved',
 tokens integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ledger (id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces ON DELETE CASCADE, amount integer NOT NULL, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS campaigns (id text PRIMARY KEY, title text NOT NULL, body text NOT NULL, code text UNIQUE NOT NULL, discount_percent integer NOT NULL CHECK(discount_percent BETWEEN 0 AND 100), active boolean NOT NULL DEFAULT true, expires_at timestamptz);
CREATE TABLE IF NOT EXISTS audit (id bigserial PRIMARY KEY, actor_id text REFERENCES users ON DELETE SET NULL, action text NOT NULL, subject text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS auth_attempts (key text PRIMARY KEY, attempts integer NOT NULL DEFAULT 0, expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS operations (id text PRIMARY KEY, task_id text NOT NULL REFERENCES tasks ON DELETE CASCADE, result jsonb, status text NOT NULL DEFAULT 'pending');
CREATE TABLE IF NOT EXISTS artifacts (id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces ON DELETE CASCADE, run_id text NOT NULL REFERENCES runs ON DELETE CASCADE, task_id text NOT NULL REFERENCES tasks ON DELETE CASCADE, name text NOT NULL, content text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
