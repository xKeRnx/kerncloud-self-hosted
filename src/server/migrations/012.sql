DO $$ BEGIN
IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=12) THEN
 ALTER TABLE infrastructure_hosts ADD COLUMN customer_account_id text REFERENCES accounts ON DELETE CASCADE;
 ALTER TABLE infrastructure_hosts ADD CONSTRAINT private_hosts_not_public_pool CHECK(customer_account_id IS NULL OR NOT self_service);
 CREATE INDEX infrastructure_customer_account ON infrastructure_hosts(customer_account_id);
 ALTER TABLE customer_environments ADD COLUMN billing_source text NOT NULL DEFAULT 'hosted' CHECK(billing_source IN('hosted','customer'));
 ALTER TABLE workspaces ADD COLUMN allow_hosted_execution boolean NOT NULL DEFAULT true;
 ALTER TABLE workspaces ADD COLUMN execution_host_ids jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(execution_host_ids)='array');
 ALTER TABLE plans ADD COLUMN max_customer_hosts integer NOT NULL DEFAULT 0 CHECK(max_customer_hosts BETWEEN 0 AND 100);
 ALTER TABLE plans ADD COLUMN max_local_environments integer NOT NULL DEFAULT 0 CHECK(max_local_environments BETWEEN 0 AND 100);
 ALTER TABLE plans ADD COLUMN max_running_local integer NOT NULL DEFAULT 0 CHECK(max_running_local BETWEEN 0 AND 100);
 ALTER TABLE plans ADD COLUMN monthly_steps integer NOT NULL DEFAULT 1000 CHECK(monthly_steps BETWEEN 1 AND 1000000);
 ALTER TABLE plans ADD COLUMN max_parallel_tasks integer NOT NULL DEFAULT 2 CHECK(max_parallel_tasks BETWEEN 1 AND 100);
 CREATE TABLE account_step_usage(account_id text NOT NULL REFERENCES accounts ON DELETE CASCADE,period text NOT NULL,used integer NOT NULL DEFAULT 0 CHECK(used>=0),PRIMARY KEY(account_id,period));
 UPDATE plans SET max_workspaces=1,monthly_steps=30,max_parallel_tasks=1 WHERE id='free' AND stripe_price_id IS NULL AND price_cents=0;
 UPDATE plans SET credits=50000,max_agents=3,max_steps=30,max_workspaces=1,max_environments=0,max_running_environments=0,runtime_minutes=0,environment_templates='["browser","development"]',max_customer_hosts=1,max_local_environments=1,max_running_local=1,monthly_steps=300,max_parallel_tasks=1 WHERE id='starter' AND stripe_price_id IS NULL AND price_cents=1900 AND credits=100000;
 UPDATE plans SET name='Pro',credits=150000,max_agents=6,max_steps=60,max_workspaces=3,max_environments=1,max_running_environments=1,runtime_minutes=60,max_customer_hosts=2,max_local_environments=3,max_running_local=2,monthly_steps=1500,max_parallel_tasks=2 WHERE id='pro' AND stripe_price_id IS NULL AND price_cents=4900 AND credits=500000;
 INSERT INTO plans(id,name,price_cents,credits,max_agents,max_steps,managed,active,stripe_price_id,max_workspaces,max_environments,max_running_environments,runtime_minutes,environment_templates,max_customer_hosts,max_local_environments,max_running_local,monthly_steps,max_parallel_tasks) VALUES('business','Business',9900,400000,12,100,true,true,null,10,2,2,300,'["browser","development"]',5,10,4,5000,4) ON CONFLICT DO NOTHING;
 INSERT INTO schema_migrations(version) VALUES(12);
END IF;
END $$;
