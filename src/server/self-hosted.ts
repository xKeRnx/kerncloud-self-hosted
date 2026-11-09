import { selfHostedEdition } from "../core/edition.ts";
import type { PoolClient } from "pg";

// Server deployment policy, never a request parameter or a client-side entitlement.
export const isSelfHosted = () => selfHostedEdition || process.env.DEPLOYMENT_MODE === "self-hosted";

export async function ensureSelfHostedPlan(c: PoolClient) {
  if (!isSelfHosted()) return;
  await c.query(`INSERT INTO plans
    (id,name,price_cents,credits,max_agents,max_steps,managed,active,max_workspaces,
     max_environments,max_running_environments,runtime_minutes,environment_templates,
     max_customer_hosts,max_local_environments,max_running_local,monthly_steps,
     max_parallel_tasks,max_automations,automation_runs)
    VALUES ('self-hosted','Self-hosted',0,0,50,500,false,true,100,
      0,0,0,'["browser","development"]',100,100,10,1000000,10,1000,1000000)
    ON CONFLICT(id) DO NOTHING`);
}

export async function assignNewSelfHostedAccount(c: PoolClient, userId: string) {
  if (!isSelfHosted()) return;
  // Only a newly inserted account is passed here; never convert existing subscriptions.
  await c.query(`UPDATE accounts SET plan_id='self-hosted',subscription_status='active',
    access_source='self_hosted',access_expires_at=NULL
    WHERE owner_id=$1 AND plan_id='free' AND stripe_subscription_id IS NULL`, [userId]);
}
