DO $$
BEGIN
IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=23) THEN
 ALTER TABLE model_offerings ADD COLUMN auto_reasoning_effort text NOT NULL DEFAULT 'provider_default'
   CHECK(auto_reasoning_effort IN('provider_default','minimal','low','medium','high','xhigh','max'));
 -- No model/provider heuristics are migrated into customer settings.
 -- Existing explicit reasoning_effort selections and credentials remain unchanged.
 INSERT INTO schema_migrations(version) VALUES(23);
END IF;
END $$;
