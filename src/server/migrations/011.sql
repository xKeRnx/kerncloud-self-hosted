DO $$
BEGIN
IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=11) THEN
 ALTER TABLE model_offerings ADD COLUMN request_timeout_seconds integer NOT NULL DEFAULT 600 CHECK(request_timeout_seconds BETWEEN 30 AND 1800);
 ALTER TABLE model_offerings ADD COLUMN reasoning_effort text NOT NULL DEFAULT 'auto' CHECK(reasoning_effort IN('auto','provider_default','minimal','low','medium','high','xhigh','max'));
 ALTER TABLE model_calls ADD COLUMN usage_known boolean NOT NULL DEFAULT true;
 -- Old fallback estimates are not measurements. Preserve reservations and the uncertain status.
 UPDATE model_calls SET usage_known=false WHERE input_tokens=0 AND output_tokens=0 AND tokens>0;
 UPDATE runs r SET tokens_used=greatest(0,r.tokens_used-coalesce((SELECT sum(m.tokens) FROM model_calls m WHERE m.run_id=r.id AND NOT m.usage_known),0));
 UPDATE model_calls SET tokens=0 WHERE NOT usage_known;
 INSERT INTO schema_migrations(version) VALUES(11);
END IF;
END $$;
