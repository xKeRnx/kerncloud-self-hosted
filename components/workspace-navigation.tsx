"use client";
import {
  LayoutDashboard,
  FolderKanban,
  ListTodo,
  Inbox,
  BarChart3,
  Bot,
  Users,
  BookOpen,
  Plug,
  Blocks,
  Server,
  Settings2,
  ChevronDown,
  Activity,
} from "lucide-react";
import { useLanguage } from "./language";
import { projectViews, type WorkspaceView } from "../src/core/navigation";
export function WorkspaceNavigation({
  view,
  nav,
  decisions,
}: {
  view: WorkspaceView;
  nav: (v: WorkspaceView) => void;
  decisions: number;
}) {
  const { t } = useLanguage();
  const main = [
    ["overview", LayoutDashboard, t("Start", "Home")],
    ["projects", FolderKanban, t("Projekte", "Projects")],
    ["work", ListTodo, t("Alle Aufträge", "All tasks")],
    ["decisions", Inbox, t("Postfach", "Inbox")],
    ["activity", BarChart3, t("Verbrauch", "Usage")],
  ] as const;
  const groups = [
    {
      label: t("Agententeam", "Agent team"),
      items: [
        ["agents", Bot, t("Agenten", "Agents")],
        ["organisation", Users, t("Organisation", "Organisation")],
        ["skills", BookOpen, "Skills"],
        ["quality", Activity, t("KI-Testlabor", "AI test lab")],
      ],
    },
    {
      label: t("Verbindungen & Umgebungen", "Connections & environments"),
      items: [
        ["bridge", Server, t("Bridge & Geräte", "Bridge & devices")],
        ["models", Blocks, t("KI & Modelle", "AI & models")],
        ["apps", Plug, t("Integrationen", "Integrations")],
        ["mcp", Plug, t("Erweiterte Werkzeuge (MCP)", "Advanced tools (MCP)")],
        [
          "environmentOverview",
          Server,
          t("Alle Umgebungen", "All environments"),
        ],
      ],
    },
  ];
  const item = (key: WorkspaceView, Icon: any, label: string) => {
    const active =
      view === key || (key === "projects" && projectViews.includes(view));
    return (
      <button
        key={key}
        className={"nav-item" + (active ? " active" : "")}
        aria-current={active ? "page" : undefined}
        aria-label={label}
        data-analytics={"nav-" + key}
        onClick={() => nav(key)}
      >
        <Icon size={18} />
        <span>{label}</span>
        {key === "decisions" && decisions > 0 && <em>{decisions}</em>}
      </button>
    );
  };
  return (
    <>
      <div className="nav-label">WORKSPACE</div>
      <nav aria-label={t("Workspace-Navigation", "Workspace navigation")}>
        {main.map(([key, Icon, label]) => item(key, Icon, label))}
      </nav>
      {groups.map((g) => (
        <details
          className="sidebar-nav-group"
          key={g.label}
          open={g.items.some(([k]) => k === view)}
        >
          <summary aria-label={g.label} title={g.label}>
            <Bot size={17} />
            <span>{g.label}</span>
            <ChevronDown className="group-chevron" size={14} />
          </summary>
          <nav aria-label={g.label}>
            {g.items.map(([k, I, l]: any) => item(k, I, l))}
          </nav>
        </details>
      ))}
      <nav aria-label={t("Einstellungen", "Settings")}>
        {item("settings", Settings2, t("Einstellungen", "Settings"))}
      </nav>
    </>
  );
}
