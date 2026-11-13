import type { ModelTariffConfig } from "./model-tariff.ts";
import type { ModelCapabilities } from "./model-capabilities.ts";
export type Status =
  | "queued"
  | "running"
  | "waiting"
  | "input_required"
  | "paused"
  | "completed"
  | "failed"
  | "canceled";
export interface User {
  password_change_required?: boolean;
  invitation_pending?: boolean;
  id: string;
  email: string;
  name: string;
  role: "admin" | "user";
  suspended: boolean;
  marketing_consent?: boolean;
}
export interface Plan {
  max_automations?: number;
  automation_runs?: number;
  max_customer_hosts: number;
  max_local_environments: number;
  max_running_local: number;
  monthly_steps: number;
  max_parallel_tasks: number;
  id: string;
  name: string;
  price_cents: number;
  credits: number;
  max_agents: number;
  max_steps: number;
  managed: boolean;
  active: boolean;
  stripe_price_id: string | null;
  max_workspaces: number;
  max_environments: number;
  max_running_environments: number;
  runtime_minutes: number;
  environment_templates: string[];
}
export interface Workspace {
  project_id?: string;
  membership_role?: "owner" | "admin" | "editor" | "viewer";
  context_strategy?: "compact" | "cache_aware";
  run_credit_limit?: number;
  run_token_limit?: number;
  fallback_model_ids?: { id: string; consent: string }[];
  access_expires_at?: string | null;
  access_source?: string;
  allow_hosted_execution?: boolean;
  execution_host_ids?: string[];
  execution_paused?: boolean;
  id: string;
  name: string;
  owner_id: string;
  plan_id: string;
  credits: number;
  ai_mode: "byok" | "managed";
  subscription_status: string;
  retention_days: number;
  default_model_id: string | null;
  account_id: string;
}
export interface Agent {
  manager_id?: string | null;
  structure_locked?: boolean;
  can_manage?: boolean;
  monthly_credit_limit?: number;
  execution_paused?: boolean;
  id: string;
  workspace_id: string;
  name: string;
  role: string;
  instructions: string;
  skill_ids: string[];
  mcp_ids: string[];
  color: string;
  model_id?: string | null;
}
export interface Run {
  project_id?: string;
  plan_item_id?: string | null;
  credit_used?: number;
  credit_limit?: number;
  token_limit?: number;
  model_policy?: {
    work_mode?: "draft" | "execute" | "team";
    fallbacks?: string[];
    autonomy_version?: number;
    delivery_bundle?: boolean;
    quality_model_id?: string;
    context_strategy?: "compact" | "cache_aware";
    automation?: {
      id: string;
      mode: "agent" | "pipeline" | "pipeline_then_agent";
      skill_id: string;
      skill_version: number;
    };
  };
  usage_uncertain?: boolean;
  id: string;
  workspace_id: string;
  goal: string;
  status: Status;
  max_steps: number;
  steps_used: number;
  tokens_used: number;
  created_at: string;
  updated_at: string;
}
export interface Task {
  plan_item_id?: string | null;
  fallback_index?: number;
  recovery_attempts?: number;
  loop_interventions?: number;
  context_state?: Record<string, unknown>;
  model_id: string | null;
  id: string;
  run_id: string;
  workspace_id: string;
  agent_id: string;
  parent_id: string | null;
  title: string;
  instructions: string;
  status: Status;
  result: string | null;
  error: string | null;
  messages: Message[];
  worker_id: string | null;
  lease_token: string | null;
  attempts: number;
  created_at: string;
}
export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
export interface Message {
  engine_state?: {
    model: string;
    reasoning: {
      type: "reasoning";
      id: string;
      summary: never[];
      encrypted_content: string;
    }[];
  };
  recovery_code?: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}
export interface Skill {
  status?: "draft" | "approved" | "rejected";
  source_run_id?: string | null;
  evidence?: {
    kind: string;
    id: string;
    tool?: string;
    name?: string;
    sha256: string;
  }[];
  review_note?: string;
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  content: string;
  version: number;
}
export interface Connection {
  id: string;
  workspace_id: string;
  name: string;
  url: string;
  secret: string;
  allowed_tools: string[];
  enabled: boolean;
}
export interface Provider {
  engine_kind?: "openai-chat" | "openai-responses" | "anthropic";
  context_window_tokens?: number | null;
  provider_name?: string;
  request_timeout_seconds?: number;
  reasoning_effort?: string;
  auto_reasoning_effort?: string;
  capabilities?: ModelCapabilities;
  max_output_tokens?: number;
  endpoint: string;
  model: string;
  secret: string;
  name: string;
  id?: string;
  input_rate?: number;
  output_rate?: number;
  base_credits?: number;
  streaming?: boolean;
}
export interface ModelOffering {
  engine_kind?: "openai-chat" | "openai-responses" | "anthropic";
  pricing_config?: ModelTariffConfig | null;
  monitor_enabled?: boolean;
  checked_at?: string | null;
  check_status?: string;
  context_window_tokens?: number | null;
  request_timeout_seconds?: number;
  reasoning_effort?: string;
  auto_reasoning_effort?: string;
  capabilities?: ModelCapabilities;
  max_output_tokens?: number;
  id: string;
  workspace_id: string | null;
  name: string;
  provider_name: string;
  endpoint?: string;
  model: string;
  input_rate: number;
  output_rate: number;
  base_credits: number;
  active: boolean;
  configured: boolean;
  streaming?: boolean;
}
export interface Attachment {
  id: string;
  workspace_id: string;
  name: string;
  mime: string;
  source: string;
  bytes: number;
  created_at: string;
}
export interface ChatMessage {
  id: number;
  workspace_id: string;
  run_id: string | null;
  agent_id: string | null;
  author: string;
  content: string;
  created_at: string;
}
export interface Event {
  id: number;
  run_id: string | null;
  workspace_id: string;
  agent_id: string | null;
  kind: string;
  content: string;
  created_at: string;
}
export interface Worker {
  id: string;
  name: string;
  concurrency: number;
  last_seen: string;
}
export interface Campaign {
  id: string;
  title: string;
  body: string;
  code: string;
  discount_percent: number;
  active: boolean;
  expires_at: string | null;
}
export interface Snapshot {
  project?: Record<string, any>;
  projects?: {
    id: string;
    name: string;
    status: string;
    is_default: boolean;
  }[];
  page?: { runs_next: string | null };
  decision_count?: number;
  model_usage?: {
    period: string;
    used: number;
    quota: number;
    parallel: number;
  };
  artifacts: Artifact[];
  user: User;
  workspace: Workspace;
  plan: Plan;
  plans: Plan[];
  agents: Agent[];
  runs: Run[];
  tasks: Task[];
  events: Event[];
  skills: Skill[];
  connections: Omit<Connection, "secret">[];
  workers: Worker[];
  campaigns: Campaign[];
  provider: {
    name: string;
    endpoint: string;
    model: string;
    configured: boolean;
  } | null;
  managedAvailable: boolean;
  stripeAvailable: boolean;
  workspaces: Workspace[];
  models: ModelOffering[];
  attachments: Attachment[];
  chat: ChatMessage[];
  memory: MemoryEntry[];
}

export interface Artifact {
  id: string;
  run_id: string;
  task_id?: string;
  name: string;
  content: string;
}

export interface MemoryEntry {
  expires_at?: string | null;
  expired?: boolean;
  stale?: boolean;
  sources?: {
    kind: "run" | "artifact" | "attachment";
    source_id: string;
    fingerprint: string;
    available: boolean;
    stale: boolean;
  }[];
  id: string;
  workspace_id: string;
  key: string;
  title: string;
  content?: string;
  preview?: string;
  kind: "knowledge" | "decision" | "work" | "history";
  status: "open" | "in_progress" | "blocked" | "done";
  evidence: string;
  pinned: boolean;
  verified: boolean;
  automatic: boolean;
  assignee: string | null;
  author: string;
  revision: number;
  updated_at: string;
}
