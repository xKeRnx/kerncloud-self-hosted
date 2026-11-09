DO $$ BEGIN
IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=29) THEN
CREATE TABLE self_hosted_interests(
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,email text NOT NULL UNIQUE,company text NOT NULL DEFAULT '',use_case text NOT NULL DEFAULT '',team_size text NOT NULL DEFAULT 'undecided',deployment text NOT NULL DEFAULT 'undecided',locale text NOT NULL CHECK(locale IN('de','en')),status text NOT NULL DEFAULT 'new' CHECK(status IN('new','contacted','qualified','archived')),note text NOT NULL DEFAULT '',revision integer NOT NULL DEFAULT 1,consent_version text NOT NULL,consented_at timestamptz NOT NULL DEFAULT now(),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '180 days');
CREATE INDEX self_hosted_interest_status ON self_hosted_interests(status,created_at DESC);
CREATE INDEX self_hosted_interest_expiry ON self_hosted_interests(expires_at);
INSERT INTO schema_migrations(version) VALUES(29);
END IF; END $$;
