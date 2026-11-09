DO $$
DECLARE tab text;
BEGIN
IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=27) THEN
 CREATE INDEX events_workspace_id ON events(workspace_id,id DESC);
 CREATE INDEX tasks_workspace_run ON tasks(workspace_id,run_id,created_at,id);
 CREATE INDEX artifacts_workspace_time ON artifacts(workspace_id,created_at DESC,id DESC) WHERE NOT retired;
 CREATE INDEX attachments_workspace_time ON attachments(workspace_id,created_at DESC,id DESC);
 CREATE INDEX chat_workspace_id ON chat_messages(workspace_id,id DESC);
 CREATE INDEX runs_workspace_cursor ON runs(workspace_id,created_at DESC,id DESC);
 CREATE INDEX tasks_due ON tasks(not_before,run_id,created_at) WHERE status='queued';
 ALTER TABLE artifacts ADD COLUMN binary_object text, ADD COLUMN binary_bytes integer NOT NULL DEFAULT 0, ADD COLUMN binary_sha256 text;
 ALTER TABLE workers ADD COLUMN draining boolean NOT NULL DEFAULT false;
 CREATE TABLE object_uploads(object_key text PRIMARY KEY,workspace_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
 CREATE INDEX object_uploads_age ON object_uploads(created_at);
 CREATE TABLE object_deletions(object_key text PRIMARY KEY,created_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE scheduler_leases(name text PRIMARY KEY,token text NOT NULL,lease_until timestamptz NOT NULL,next_at timestamptz NOT NULL);
 CREATE TABLE gateway_instances(id text PRIMARY KEY,address text NOT NULL,expires_at timestamptz NOT NULL);
 CREATE TABLE environment_gateway_leases(environment_id text PRIMARY KEY REFERENCES customer_environments ON DELETE CASCADE,generation integer NOT NULL,gateway_id text NOT NULL REFERENCES gateway_instances ON DELETE CASCADE,token text NOT NULL,expires_at timestamptz NOT NULL);
 CREATE INDEX gateway_lease_expiry ON environment_gateway_leases(expires_at);
 INSERT INTO schema_migrations(version) VALUES(27);
END IF;
END $$;
CREATE OR REPLACE FUNCTION kc_notify_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rowdata jsonb; scope text; target text;
BEGIN
 IF TG_TABLE_NAME='tasks' AND TG_OP='UPDATE' THEN
  IF OLD.status IS NOT DISTINCT FROM NEW.status AND OLD.result IS NOT DISTINCT FROM NEW.result AND OLD.error IS NOT DISTINCT FROM NEW.error AND OLD.title IS NOT DISTINCT FROM NEW.title AND OLD.instructions IS NOT DISTINCT FROM NEW.instructions THEN RETURN NEW; END IF;
 END IF;
 rowdata=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 IF TG_OP='UPDATE' AND to_jsonb(OLD)=to_jsonb(NEW) THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='settings' AND rowdata->>'id' NOT IN('site','languages','company','hosted_provider','legal') THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
 IF TG_TABLE_NAME='customer_environments' AND TG_OP='UPDATE' AND (to_jsonb(OLD)-'relay_seen'-'controller_seen'-'last_activity_at')=(to_jsonb(NEW)-'relay_seen'-'controller_seen'-'last_activity_at') THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='tasks' AND (to_jsonb(OLD)-'messages'-'lease_until'-'context_state')=(to_jsonb(NEW)-'messages'-'lease_until'-'context_state') THEN RETURN NEW; END IF;
 IF rowdata ? 'workspace_id' AND rowdata->>'workspace_id' IS NOT NULL THEN scope='workspace';target=rowdata->>'workspace_id';
 ELSIF TG_TABLE_NAME='workspaces' THEN scope='workspace';target=rowdata->>'id';
 ELSIF TG_TABLE_NAME='accounts' THEN scope='account';target=rowdata->>'id';
 ELSIF rowdata ? 'account_id' THEN scope='account';target=rowdata->>'account_id';
 ELSIF TG_TABLE_NAME='users' THEN scope='user';target=rowdata->>'id';
 ELSIF rowdata ? 'user_id' THEN scope='user';target=rowdata->>'user_id';
 ELSE scope='global';target='*'; END IF;
 PERFORM pg_notify('kc_changes',json_build_object('scope',scope,'id',target,'topic',TG_TABLE_NAME)::text);
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['workspaces','workspace_members','users','sessions','account_security','accounts','agents','runs','tasks','events','model_deltas','chat_messages','artifacts','attachments','memories','skills','connections','model_offerings','plans','settings','campaigns','decisions','customer_environments','workspace_notifications','work_app_connections','work_projects'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS kc_change ON %I',tab);
  EXECUTE format('CREATE TRIGGER kc_change AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION kc_notify_change()',tab);
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION kc_queue_object_deletion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.binary_object IS NOT NULL THEN INSERT INTO object_deletions(object_key) VALUES(OLD.binary_object) ON CONFLICT DO NOTHING; END IF; RETURN OLD; END $$;
DROP TRIGGER IF EXISTS kc_object_delete ON artifacts;
CREATE TRIGGER kc_object_delete AFTER DELETE ON artifacts FOR EACH ROW EXECUTE FUNCTION kc_queue_object_deletion();
