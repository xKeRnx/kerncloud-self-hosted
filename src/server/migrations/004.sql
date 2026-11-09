CREATE TABLE IF NOT EXISTS memories(
 id text PRIMARY KEY,workspace_id text NOT NULL REFERENCES workspaces ON DELETE CASCADE,key text NOT NULL,title text NOT NULL,content text NOT NULL CHECK(length(content)<=8000),
 kind text NOT NULL CHECK(kind IN('knowledge','decision','work','history')),status text NOT NULL CHECK(status IN('open','in_progress','blocked','done')),
 evidence text NOT NULL DEFAULT '',pinned boolean NOT NULL DEFAULT false,verified boolean NOT NULL DEFAULT false,automatic boolean NOT NULL DEFAULT false,
 assignee text,author text NOT NULL,revision integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(workspace_id,key)
);
CREATE INDEX IF NOT EXISTS memories_workspace ON memories(workspace_id,updated_at DESC);
CREATE TABLE IF NOT EXISTS memory_revisions(memory_id text NOT NULL REFERENCES memories ON DELETE CASCADE,revision integer NOT NULL,title text NOT NULL,content text NOT NULL,kind text NOT NULL,status text NOT NULL,evidence text NOT NULL,author text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(memory_id,revision));
INSERT INTO schema_migrations(version) VALUES(4) ON CONFLICT DO NOTHING;
