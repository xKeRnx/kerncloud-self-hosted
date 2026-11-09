DO $$ BEGIN
IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=28) THEN
 CREATE TABLE workspace_projects(id text PRIMARY KEY DEFAULT gen_random_uuid()::text,workspace_id text NOT NULL REFERENCES workspaces ON DELETE CASCADE,name text NOT NULL,description text NOT NULL DEFAULT '',status text NOT NULL DEFAULT 'planned' CHECK(status IN('planned','active','paused','completed','archived')),is_default boolean NOT NULL DEFAULT false,all_agents boolean NOT NULL DEFAULT false,agent_ids jsonb NOT NULL DEFAULT '[]',credit_limit integer NOT NULL DEFAULT 100000 CHECK(credit_limit>=0),token_limit bigint NOT NULL DEFAULT 1000000 CHECK(token_limit>=0),target_at timestamptz,revision integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now());
 CREATE UNIQUE INDEX project_default ON workspace_projects(workspace_id) WHERE is_default;
 CREATE INDEX project_workspace ON workspace_projects(workspace_id,created_at);
 INSERT INTO workspace_projects(workspace_id,name,status,is_default,all_agents,credit_limit,token_limit) SELECT id,'Allgemein / Bestand','active',true,true,2147483647,1000000000000 FROM workspaces;
 CREATE INDEX events_run_agent_time ON events(run_id,agent_id,kind,created_at) WHERE kind IN('started','completed','failed','input_required');
 ALTER TABLE tasks ADD COLUMN started_at timestamptz,ADD COLUMN finished_at timestamptz;
 ALTER TABLE runs ADD COLUMN project_id text REFERENCES workspace_projects;
 ALTER TABLE attachments ADD COLUMN project_id text REFERENCES workspace_projects,ADD COLUMN workspace_shared boolean NOT NULL DEFAULT false;
 ALTER TABLE chat_messages ADD COLUMN project_id text REFERENCES workspace_projects;
 ALTER TABLE skills ADD COLUMN project_id text REFERENCES workspace_projects,ADD COLUMN workspace_shared boolean NOT NULL DEFAULT false;
 ALTER TABLE memories ADD COLUMN project_id text REFERENCES workspace_projects,ADD COLUMN workspace_shared boolean NOT NULL DEFAULT false;
 ALTER TABLE work_projects ADD COLUMN project_id text REFERENCES workspace_projects;
 ALTER TABLE automations ADD COLUMN project_id text REFERENCES workspace_projects,ADD COLUMN overlap_policy text NOT NULL DEFAULT 'queue' CHECK(overlap_policy IN('queue','coalesce','skip')),ADD COLUMN catch_up text NOT NULL DEFAULT 'coalesce' CHECK(catch_up IN('coalesce','skip'));
 ALTER TABLE customer_environments ADD COLUMN project_id text REFERENCES workspace_projects;
 ALTER TABLE agents ADD COLUMN manager_id text REFERENCES agents ON DELETE SET NULL,ADD COLUMN structure_locked boolean NOT NULL DEFAULT false,ADD COLUMN can_manage boolean NOT NULL DEFAULT false,ADD COLUMN hire_source text UNIQUE,ADD COLUMN auto_hire boolean NOT NULL DEFAULT false,ADD COLUMN monthly_credit_limit integer NOT NULL DEFAULT 0 CHECK(monthly_credit_limit>=0);
 CREATE TABLE template_imports(workspace_id text NOT NULL REFERENCES workspaces ON DELETE CASCADE,digest text NOT NULL,project_id text NOT NULL REFERENCES workspace_projects,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,digest));
 CREATE TABLE organisation_settings(workspace_id text PRIMARY KEY REFERENCES workspaces ON DELETE CASCADE,locked boolean NOT NULL DEFAULT false,revision integer NOT NULL DEFAULT 1,hiring text NOT NULL DEFAULT 'approval' CHECK(hiring IN('off','approval','automatic')),allowed_roles jsonb NOT NULL DEFAULT '[]',allowed_models jsonb NOT NULL DEFAULT '[]',max_hires integer NOT NULL DEFAULT 3 CHECK(max_hires BETWEEN 0 AND 50),max_depth integer NOT NULL DEFAULT 5 CHECK(max_depth BETWEEN 1 AND 10),hire_credit_limit integer NOT NULL DEFAULT 0 CHECK(hire_credit_limit>=0));
 CREATE TABLE project_plan_items(id text PRIMARY KEY DEFAULT gen_random_uuid()::text,project_id text NOT NULL REFERENCES workspace_projects ON DELETE CASCADE,workspace_id text NOT NULL REFERENCES workspaces ON DELETE CASCADE,title text NOT NULL,agent_id text REFERENCES agents,run_id text REFERENCES runs ON DELETE SET NULL,status text NOT NULL DEFAULT 'planned' CHECK(status IN('planned','ready','in_progress','blocked','done','canceled')),planned_start timestamptz,target_at timestamptz,estimate_min integer CHECK(estimate_min BETWEEN 1 AND 525600),estimate_max integer CHECK(estimate_max BETWEEN 1 AND 525600),confidence text NOT NULL DEFAULT 'low' CHECK(confidence IN('low','medium','high')),dependencies jsonb NOT NULL DEFAULT '[]',locked boolean NOT NULL DEFAULT false,revision integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),CHECK(estimate_max IS NULL OR estimate_min IS NULL OR estimate_max>=estimate_min),CHECK(target_at IS NULL OR planned_start IS NULL OR target_at>=planned_start));
 ALTER TABLE runs ADD COLUMN plan_item_id text REFERENCES project_plan_items ON DELETE SET NULL;
 ALTER TABLE tasks ADD COLUMN plan_item_id text REFERENCES project_plan_items ON DELETE SET NULL;
 ALTER TABLE project_plan_items ADD COLUMN task_id text REFERENCES tasks ON DELETE SET NULL;
 CREATE INDEX plan_project ON project_plan_items(project_id,created_at);
 CREATE TABLE organisation_changes(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,workspace_id text NOT NULL REFERENCES workspaces ON DELETE CASCADE,actor text NOT NULL,kind text NOT NULL,details jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
 CREATE INDEX org_history ON organisation_changes(workspace_id,id DESC);
 INSERT INTO organisation_settings(workspace_id) SELECT id FROM workspaces;
 UPDATE agents a SET can_manage=true WHERE a.id=(SELECT id FROM agents WHERE workspace_id=a.workspace_id ORDER BY CASE WHEN role='Koordination' THEN 0 ELSE 1 END,id LIMIT 1);
 UPDATE agents a SET manager_id=(SELECT id FROM agents WHERE workspace_id=a.workspace_id AND can_manage ORDER BY id LIMIT 1) WHERE NOT a.can_manage;
 ALTER TABLE memories DROP CONSTRAINT memories_workspace_id_key_key;
 ALTER TABLE memories ADD UNIQUE(workspace_id,project_id,key);
 INSERT INTO schema_migrations(version) VALUES(28);
END IF;
END $$;
CREATE OR REPLACE FUNCTION kc_default_project(w text) RETURNS text LANGUAGE sql STABLE AS $$ SELECT id FROM workspace_projects WHERE workspace_id=w AND is_default $$;
CREATE OR REPLACE FUNCTION kc_project_agent(p text,a text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS(SELECT 1 FROM workspace_projects pr JOIN agents ag ON ag.workspace_id=pr.workspace_id WHERE pr.id=p AND ag.id=a AND(pr.all_agents OR pr.agent_ids ? a)) $$;
CREATE OR REPLACE FUNCTION kc_seed_project() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO workspace_projects(workspace_id,name,status,is_default,all_agents,credit_limit,token_limit) VALUES(NEW.id,'Allgemein / Bestand','active',true,true,2147483647,1000000000000);INSERT INTO organisation_settings(workspace_id) VALUES(NEW.id);RETURN NEW;END $$;
DROP TRIGGER IF EXISTS kc_seed_project ON workspaces;
CREATE TRIGGER kc_seed_project AFTER INSERT ON workspaces FOR EACH ROW EXECUTE FUNCTION kc_seed_project();
CREATE OR REPLACE FUNCTION kc_plan_ready(p text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS(SELECT 1 FROM project_plan_items pi WHERE pi.id=p AND pi.status IN('ready','in_progress') AND(pi.planned_start IS NULL OR pi.planned_start<=now()) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(pi.dependencies) d(id) JOIN project_plan_items dep ON dep.id=d.id LEFT JOIN runs dr ON dr.id=dep.run_id LEFT JOIN tasks dt ON dt.id=dep.task_id WHERE CASE WHEN dep.task_id IS NOT NULL THEN dt.status<>'completed' WHEN dep.run_id IS NOT NULL THEN dr.status<>'completed' ELSE dep.status<>'done' END)) $$;
CREATE OR REPLACE FUNCTION kc_assign_project() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.project_id IS NULL THEN
 IF TG_TABLE_NAME='skills' THEN IF NEW.source_run_id IS NOT NULL THEN SELECT project_id INTO NEW.project_id FROM runs WHERE id=NEW.source_run_id;END IF;END IF;
 IF TG_TABLE_NAME='chat_messages' THEN IF NEW.run_id IS NOT NULL THEN SELECT project_id INTO NEW.project_id FROM runs WHERE id=NEW.run_id;END IF;END IF;
 NEW.project_id:=coalesce(NEW.project_id,kc_default_project(NEW.workspace_id)); END IF; IF NOT EXISTS(SELECT 1 FROM workspace_projects WHERE id=NEW.project_id AND workspace_id=NEW.workspace_id) THEN RAISE EXCEPTION 'Project outside workspace' USING ERRCODE='23514'; END IF;RETURN NEW;END $$;
DO $$ DECLARE tab text;BEGIN FOREACH tab IN ARRAY ARRAY['runs','attachments','memories','work_projects','automations','customer_environments','skills','chat_messages'] LOOP
 EXECUTE format('UPDATE %I SET project_id=kc_default_project(workspace_id) WHERE project_id IS NULL',tab);
 EXECUTE format('ALTER TABLE %I ALTER COLUMN project_id SET NOT NULL',tab);
 EXECUTE format('DROP TRIGGER IF EXISTS kc_assign_project ON %I',tab);
 EXECUTE format('CREATE TRIGGER kc_assign_project BEFORE INSERT OR UPDATE OF project_id,workspace_id ON %I FOR EACH ROW EXECUTE FUNCTION kc_assign_project()',tab);
 EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I(workspace_id,project_id)',tab||'_project_scope',tab);
END LOOP;
FOREACH tab IN ARRAY ARRAY['workspace_projects','project_plan_items','organisation_settings','organisation_changes'] LOOP
 EXECUTE format('DROP TRIGGER IF EXISTS kc_change ON %I',tab);
 EXECUTE format('CREATE TRIGGER kc_change AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION kc_notify_change()',tab);
END LOOP;END $$;
