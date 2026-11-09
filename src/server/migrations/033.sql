DO $$ BEGIN
IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=33) THEN
 CREATE TABLE user_appearance_preferences (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme text NOT NULL CHECK(theme IN ('light','dark','system')),
  updated_at timestamptz NOT NULL DEFAULT now()
 );
 INSERT INTO schema_migrations(version) VALUES(33);
END IF; END $$;
