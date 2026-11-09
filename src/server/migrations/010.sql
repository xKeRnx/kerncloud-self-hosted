DO $$
BEGIN
IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=10) THEN
 ALTER TABLE model_offerings DROP CONSTRAINT IF EXISTS model_offerings_max_output_tokens_check;
 ALTER TABLE model_offerings ADD CONSTRAINT model_offerings_max_output_tokens_check CHECK(max_output_tokens BETWEEN 256 AND 1048576);
 INSERT INTO schema_migrations(version) VALUES(10);
END IF;
END $$;
