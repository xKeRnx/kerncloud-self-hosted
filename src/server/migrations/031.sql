DO $$ BEGIN
IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=31) THEN
 ALTER TABLE decisions ADD COLUMN answer_options jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(answer_options)='array' AND jsonb_array_length(answer_options)<=3);
 ALTER TABLE decisions ADD COLUMN response_data jsonb NOT NULL DEFAULT '{}';
 -- A manually confirmed override applies only to the existing run. Future-run defaults retain their existing limits.
 ALTER TABLE runs DROP CONSTRAINT runs_token_limit_check;
 ALTER TABLE runs ADD CONSTRAINT runs_token_limit_check CHECK(token_limit BETWEEN 1000 AND 100000000);
 INSERT INTO schema_migrations(version) VALUES(31);
END IF;
END $$;
