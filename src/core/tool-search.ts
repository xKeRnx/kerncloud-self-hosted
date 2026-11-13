const normalize = (v: string) =>
  v
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
const aliases: Record<string, string> = {
  research:"read_research_job research_query save_research_report",
  recherche:"read_research_job research_query save_research_report",
  tavily:"read_research_job research_query",
  brave:"read_research_job research_query",
  exa:"read_research_job research_query",
  studio:"save_content_draft",
  beitrag:"save_content_draft",
  organigramm: "propose_organisation project_status",
  spezialist: "request_agent",
  agenten: "request_agent project_status",
  zeitplan: "plan_work project_status",
  planen: "plan_work",
  office: "create_office document spreadsheet presentation",
  word: "create_office",
  excel: "create_office",
  powerpoint: "create_office",
  gmail: "app_action list_work_apps",
  outlook: "app_action list_work_apps",
  discord: "app_action list_work_apps",
  slack: "app_action list_work_apps",
  notion: "app_action list_work_apps",
  linear: "app_action list_work_apps",
  asana: "app_action list_work_apps",
  clickup: "app_action list_work_apps",
  todoist: "app_action list_work_apps",
  airtable: "app_action list_work_apps",
  hubspot: "app_action list_work_apps",
  dropbox: "app_action list_work_apps",
  figma: "app_action list_work_apps",
  vercel: "app_action list_work_apps",
  cloudflare: "app_action list_work_apps",
  gitlab: "app_action list_work_apps",
  ayrshare: "app_action list_work_apps",
  apify: "app_action list_work_apps",
  social: "app_action list_work_apps",
  integrations: "app_action list_work_apps",
  integrationen: "app_action list_work_apps",
  kalender: "app_action calendar",
  github: "project_action app_action list_work_apps",
  datei: "file artifact",
  dateien: "file artifact",
  lesen: "read",
  suchen: "search",
  durchsuchen: "search",
  speichern: "save write",
  befehl: "command exec",
  befehle: "command exec",
  rechnung: "invoice billing",
  rechnungen: "invoice billing",
  gedachtnis: "memory",
  wissen: "memory",
  ablauf: "pipeline",
  prufen: "validate test",
  browser: "browser",
  prozess: "process",
  prozesse: "process",
  sicherung: "checkpoint",
  repo: "repository git",
  aufgabe: "task",
  nachricht: "message",
};
export function searchToolIndex<
  T extends { name: string; description: string },
>(items: T[], query: string, limit = 6): T[] {
  const words = normalize(query)
    .split(/[^a-z0-9_]+/)
    .filter(Boolean);
  const terms = [
    ...new Set(
      words.flatMap((w) => [
        w,
        ...(aliases[w] ?? "").split(" ").filter(Boolean),
      ]),
    ),
  ];
  return items
    .map((item, index) => {
      const name = normalize(item.name),
        description = normalize(item.description);
      return {
        item,
        index,
        score: terms.reduce(
          (n, w) =>
            n +
            (name === w
              ? 15
              : name.includes(w)
                ? 5
                : description.includes(w)
                  ? 2
                  : 0),
          0,
        ),
      };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.min(6, limit))
    .map((x) => x.item);
}
