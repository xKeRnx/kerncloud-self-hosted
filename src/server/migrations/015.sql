DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=15) THEN
  ALTER TABLE model_calls ADD COLUMN model_name text;
  ALTER TABLE model_calls ADD COLUMN provider_name text;
  ALTER TABLE model_calls ADD COLUMN duration_ms integer;
  ALTER TABLE model_calls ADD COLUMN outcome text;
  ALTER TABLE model_calls ADD COLUMN cached_tokens integer;
  ALTER TABLE model_calls ADD COLUMN cache_input_tokens integer;
  CREATE INDEX model_calls_account_time ON model_calls(account_id,created_at DESC);
  CREATE TABLE plan_allocations(account_id text NOT NULL REFERENCES accounts ON DELETE CASCADE,period text NOT NULL,plan_id text NOT NULL,credits integer NOT NULL,runtime_seconds integer NOT NULL,actor_id text REFERENCES users ON DELETE SET NULL,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(account_id,period));
  INSERT INTO schema_migrations(version) VALUES(15);
 END IF;
END $$;
