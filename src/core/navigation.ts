export const workspacePaths = {
  overview: "/overview",
  work: "/tasks/all",
  settings: "/settings",
  hosts: "/settings/hosts",
  bridge: "/bridge",
  budgets: "/settings/budgets",
  projectSettings: "/project-settings",
  worklog: "/worklog",
  apps: "/apps",
  social: "/social",
  socialAnalytics: "/social-analytics",
  studio: "/studio",
  research: "/research",
  projects: "/projects",
  timeline: "/timeline",
  organisation: "/organisation",
  routines: "/routines",
  quality: "/quality",
  team: "/team",
  knowledge: "/knowledge",
  briefings: "/briefings",
  decisions: "/decisions",
  agents: "/agents",
  tasks: "/tasks",
  chat: "/chat",
  files: "/files",
  memory: "/memory",
  workspaces: "/workspaces",
  activity: "/activity",
  skills: "/skills",
  mcp: "/mcp",
  models: "/models",
  billing: "/billing",
  profile: "/profile",
  invoices: "/invoices",
  privacy: "/account/privacy",
  environments: "/environments",
  environmentOverview: "/environments/all",
  admin: "/admin",
} as const;

export type WorkspaceView = keyof typeof workspacePaths;

export function resolveWorkspacePath(pathname: string): {
  view: WorkspaceView;
  runId?: string;
  agentId?: string;
  projectId?: string;
  adminTab?: string;
} | null {
  const path = pathname.replace(/\/$/, "") || "/";
  for (const [view, value] of Object.entries(workspacePaths)) {
    if (path === value) return { view: view as WorkspaceView };
  }
  const subproject =
    /^\/projects\/([a-zA-Z0-9_-]{1,100})\/(tasks|chat|files|memory|knowledge|timeline|routines|environments|settings|studio|research|social|social-analytics)$/.exec(
      path,
    );
  if (subproject)
    return {
      view:
        subproject[2] === "social-analytics"
          ? "socialAnalytics"
          : subproject[2] === "settings"
            ? "projectSettings"
            : (subproject[2] as WorkspaceView),
      projectId: subproject[1],
    };
  const agent = /^\/agents\/([a-zA-Z0-9_-]{1,100})$/.exec(path);
  if (agent) return { view: "agents", agentId: agent[1] };
  const project = /^\/projects\/([a-zA-Z0-9_-]{1,100})$/.exec(path);
  if (project) return { view: "projects", projectId: project[1] };
  const run = /^\/tasks\/([a-zA-Z0-9_-]{1,100})$/.exec(path);
  if (run) return { view: "tasks", runId: run[1] };
  const admin =
    /^\/admin\/(customers|plans|provider|payments|legal|site|languages|pages|security|infrastructure|analytics|marketing|audit|company|mail|contracts|einvoices|self-hosted)$/.exec(
      path,
    );
  return admin ? { view: "admin", adminTab: admin[1] } : null;
}

export const projectViews: WorkspaceView[] = [
  "social",
  "socialAnalytics",
  "studio",
  "research",
  "projects",
  "tasks",
  "chat",
  "files",
  "memory",
  "knowledge",
  "timeline",
  "routines",
  "environments",
  "projectSettings",
];
export function projectPath(project: string, view: WorkspaceView = "projects") {
  const prefix = "/projects/" + encodeURIComponent(project);
  return view === "projects"
    ? prefix
    : prefix +
        "/" +
        (view === "projectSettings"
          ? "settings"
          : view === "socialAnalytics"
            ? "social-analytics"
            : view);
}
export const adminGroups = [
  {
    id: "customers",
    de: "Kunden & Angebote",
    en: "Customers & plans",
    items: ["customers", "plans", "self-hosted"],
  },
  {
    id: "finance",
    de: "Finanzen & Firma",
    en: "Finance & company",
    items: ["payments", "einvoices", "company", "contracts"],
  },
  {
    id: "systems",
    de: "KI & Infrastruktur",
    en: "AI & infrastructure",
    items: ["provider", "infrastructure", "mail"],
  },
  {
    id: "content",
    de: "Website & Wachstum",
    en: "Website & growth",
    items: ["site", "pages", "languages", "legal", "analytics", "marketing"],
  },
  {
    id: "security",
    de: "Sicherheit & Protokolle",
    en: "Security & audit",
    items: ["security", "audit"],
  },
];
