DO $$
BEGIN
IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=25) THEN
 ALTER TABLE model_offerings ADD COLUMN pricing_config jsonb NOT NULL DEFAULT '{}';
 INSERT INTO schema_migrations(version) VALUES(25);
END IF;
END $$;
