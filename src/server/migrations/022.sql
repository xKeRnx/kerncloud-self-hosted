DO $$ BEGIN
IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=22) THEN
 CREATE TABLE decisions (
 id text PRIMARY KEY,workspace_id text NOT NULL REFERENCES workspaces ON DELETE CASCADE,
 run_id text NOT NULL REFERENCES runs ON DELETE CASCADE,task_id text NOT NULL REFERENCES tasks ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN('information','access','approval','review')),
 question text NOT NULL,action text NOT NULL DEFAULT '',recipient text NOT NULL DEFAULT '',
 access_target text NOT NULL DEFAULT '',cost_note text NOT NULL DEFAULT '',
 tool_key text,arguments_hash text,scope_hash text,proposal_cipher text,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','answered','approved','denied','stale')),
 response text NOT NULL DEFAULT '',response_action text,answered_by text REFERENCES users ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),answered_at timestamptz,expires_at timestamptz,
 consumed_operation text,request_key text NOT NULL UNIQUE
 );
 CREATE UNIQUE INDEX decisions_one_pending_task ON decisions(task_id) WHERE status='pending';
 CREATE INDEX decisions_workspace_status ON decisions(workspace_id,status,created_at DESC);
 CREATE INDEX decisions_task_tool ON decisions(task_id,tool_key,created_at DESC);
 INSERT INTO schema_migrations(version) VALUES(22);
END IF;
END $$;
