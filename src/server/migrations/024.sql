DO $$
BEGIN
IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=24) THEN
 ALTER TABLE model_offerings ADD COLUMN capabilities jsonb NOT NULL DEFAULT '{}';
 ALTER TABLE model_offerings DROP CONSTRAINT IF EXISTS model_offerings_context_window_tokens_check;
 ALTER TABLE model_offerings ADD CHECK(context_window_tokens IS NULL OR context_window_tokens BETWEEN 1 AND 8388608);
 ALTER TABLE model_offerings DROP CONSTRAINT IF EXISTS model_offerings_max_output_tokens_check;
 ALTER TABLE model_offerings ADD CHECK(max_output_tokens BETWEEN 1 AND 1048576);
 ALTER TABLE model_offerings DROP CONSTRAINT IF EXISTS model_offerings_reasoning_effort_check;
 ALTER TABLE model_offerings DROP CONSTRAINT IF EXISTS model_offerings_auto_reasoning_effort_check;
 ALTER TABLE model_offerings ADD CHECK(reasoning_effort IN('auto','provider_default','none','minimal','low','medium','high','xhigh','max'));
 ALTER TABLE model_offerings ADD CHECK(auto_reasoning_effort IN('provider_default','none','minimal','low','medium','high','xhigh','max'));
 INSERT INTO schema_migrations(version) VALUES(24);
END IF;
END $$;
