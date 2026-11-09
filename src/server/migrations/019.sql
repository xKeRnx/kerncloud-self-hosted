DO $$ BEGIN
IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=19) THEN
 ALTER TABLE workspaces ADD COLUMN context_strategy text NOT NULL DEFAULT 'compact' CHECK(context_strategy IN('compact','cache_aware'));
 ALTER TABLE model_calls ADD COLUMN context_strategy text NOT NULL DEFAULT 'legacy',ADD COLUMN context_input_bytes integer,ADD COLUMN context_omitted_groups integer,ADD COLUMN provider_cost_usd numeric CHECK(provider_cost_usd>=0);
 INSERT INTO schema_migrations(version) VALUES(19);
END IF;
END $$;
