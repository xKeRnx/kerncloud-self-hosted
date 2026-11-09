DO $$ BEGIN
IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=21) THEN
 ALTER TABLE model_offerings ADD COLUMN deleted_at timestamptz,
 ADD COLUMN monitor_enabled boolean NOT NULL DEFAULT true,
 ADD COLUMN checked_at timestamptz,
 ADD COLUMN check_status text NOT NULL DEFAULT 'unknown';
 INSERT INTO schema_migrations(version) VALUES(21);
END IF;
END $$;
