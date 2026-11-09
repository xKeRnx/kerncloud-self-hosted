DO $$ BEGIN
IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=30) THEN
 CREATE UNIQUE INDEX project_workspace_pair ON workspace_projects(id,workspace_id);
 CREATE TABLE user_workspace_preferences(user_id text NOT NULL REFERENCES users ON DELETE CASCADE,workspace_id text NOT NULL REFERENCES workspaces ON DELETE CASCADE,project_id text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,workspace_id),FOREIGN KEY(project_id,workspace_id) REFERENCES workspace_projects(id,workspace_id) ON DELETE CASCADE);
 CREATE INDEX user_workspace_preference_project ON user_workspace_preferences(project_id);
 INSERT INTO schema_migrations(version) VALUES(30);
END IF; END $$;
CREATE OR REPLACE FUNCTION kc_notify_project_preference() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM pg_notify('kc_changes',json_build_object('scope','user','id',NEW.user_id,'topic','user_workspace_preferences')::text); RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS kc_preference_change ON user_workspace_preferences;
CREATE TRIGGER kc_preference_change AFTER INSERT OR UPDATE ON user_workspace_preferences FOR EACH ROW EXECUTE FUNCTION kc_notify_project_preference();
