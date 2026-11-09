DO $$
BEGIN
IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=9) THEN
 ALTER TABLE model_offerings ADD COLUMN max_output_tokens integer NOT NULL DEFAULT 8192 CHECK(max_output_tokens BETWEEN 256 AND 32768);
 -- Repair only the known old worker fallback with an actually empty final assistant message.
 WITH repaired AS (
  UPDATE tasks SET status='failed',result=NULL,error='Früherer Worker hat eine leere KI-Antwort fälschlich als abgeschlossen markiert. Ausgabe-Tokenlimit unter KI & Modelle prüfen und bei Bedarf einen neuen Versuch starten.'
  WHERE status='completed' AND result='Keine Antwort.' AND messages->-1->>'role'='assistant'
   AND coalesce(messages->-1->>'content','')='' AND jsonb_array_length(coalesce(messages->-1->'tool_calls','[]'::jsonb))=0
  RETURNING workspace_id,run_id,agent_id,error
 ) INSERT INTO events(workspace_id,run_id,agent_id,kind,content) SELECT workspace_id,run_id,agent_id,'warning',error FROM repaired;
 UPDATE runs r SET status='failed',updated_at=now() WHERE r.status='completed' AND EXISTS(SELECT 1 FROM tasks t WHERE t.run_id=r.id AND t.status='failed');
 INSERT INTO schema_migrations(version) VALUES(9);
END IF;
END $$;
