DO $$ BEGIN
IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=6) THEN
 ALTER TABLE oauth_identities DROP CONSTRAINT IF EXISTS oauth_identities_provider_check;
 ALTER TABLE oauth_identities ADD CONSTRAINT oauth_identities_provider_check CHECK(provider IN('google','github','microsoft'));
 ALTER TABLE environment_templates ADD COLUMN access_mode text NOT NULL DEFAULT 'none' CHECK(access_mode IN('none','code-server','basic'));
 CREATE TABLE environment_credentials(environment_id text PRIMARY KEY REFERENCES customer_environments ON DELETE CASCADE, secret text NOT NULL);
 INSERT INTO environment_templates(id,name,image,command,cpu,memory_mb,container_port,network,access_mode) VALUES
 ('browser','Browser · Firefox Desktop','kerncloud-browser:0.2','[]',2,2048,8080,true,'basic'),
 ('development','Entwicklungsumgebung · Code Editor','kerncloud-development:0.2','[]',1,1024,8080,true,'code-server') ON CONFLICT DO NOTHING;
 INSERT INTO schema_migrations(version) VALUES(6);
END IF;
END $$;
