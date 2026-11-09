DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=17) THEN
  ALTER TABLE tasks ADD COLUMN recovery_attempts integer NOT NULL DEFAULT 0;
  ALTER TABLE tasks ADD COLUMN loop_interventions integer NOT NULL DEFAULT 0;
  ALTER TABLE tasks ADD COLUMN context_state jsonb NOT NULL DEFAULT '{}';
  ALTER TABLE model_calls ADD COLUMN request_key text;
  ALTER TABLE model_calls ADD COLUMN response jsonb;
  ALTER TABLE model_calls ADD COLUMN heartbeat_at timestamptz NOT NULL DEFAULT now();
  CREATE UNIQUE INDEX model_calls_request ON model_calls(task_id,request_key) WHERE request_key IS NOT NULL;
  ALTER TABLE operations ADD COLUMN tool_name text;
  ALTER TABLE operations ADD COLUMN arguments_hash text;
  ALTER TABLE operations ADD COLUMN outcome_hash text;
  ALTER TABLE operations ADD COLUMN failed boolean NOT NULL DEFAULT false;
  ALTER TABLE operations ADD COLUMN recorded_at timestamptz NOT NULL DEFAULT now();
  CREATE INDEX operations_history ON operations(task_id,recorded_at DESC) WHERE outcome_hash IS NOT NULL;
  ALTER TABLE model_offerings ADD COLUMN context_window_tokens integer CHECK(context_window_tokens BETWEEN 8192 AND 8388608);
  INSERT INTO schema_migrations(version) VALUES(17);
 END IF;
END $$;
