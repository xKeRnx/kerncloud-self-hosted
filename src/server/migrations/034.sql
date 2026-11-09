-- One-time product default change. Preference cookies and user content are untouched.
WITH first_run AS (
 INSERT INTO settings(id,value) VALUES('migration:english-default-v1','true'::jsonb)
 ON CONFLICT(id) DO NOTHING RETURNING id
)
INSERT INTO settings(id,value)
 SELECT 'languages', '{"enabled":["en","de"],"defaultLocale":"en","browserDetection":false}'::jsonb FROM first_run
ON CONFLICT(id) DO UPDATE SET value=EXCLUDED.value;
