DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=16) THEN
  ALTER TABLE plan_allocations ADD COLUMN source text NOT NULL DEFAULT 'manual' CHECK(source IN('manual','automatic'));
  ALTER TABLE plan_allocations ADD COLUMN period_end timestamptz;
  INSERT INTO schema_migrations(version) VALUES(16);
 END IF;
END $$;
