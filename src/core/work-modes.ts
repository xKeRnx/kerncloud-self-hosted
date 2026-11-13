export const workModes = ["draft", "execute", "team"] as const;
export type WorkMode = (typeof workModes)[number];
const draftTools = new Set([
  "tool_catalog",
  "tool_search",
  "save_artifact",
  "read_artifact",
  "patch_artifact",
  "validate_artifact",
  "deliver_artifacts",
  "finish_task",
  "request_input",
  "read_task_history",
  "search_project",
  "read_project_source",
  "project_status",
  "save_project_page",
  "list_project_pages",
  "list_memory",
  "read_memory",
]);
export function modeAllowsTool(mode: WorkMode | undefined, tool: string) {
  if (mode === "draft") return draftTools.has(tool);
  if (mode === "execute")
    return !["delegate_task", "request_agent", "restructure_team"].includes(
      tool,
    );
  return true; // Existing runs retain their original permissions; modes never grant tools.
}
export function workModeInstruction(mode?: WorkMode) {
  return mode === "draft"
    ? "Work mode: draft. Research and produce reviewable local artifacts. External tools and team delegation are disabled. Do not claim external actions were performed."
    : mode === "execute"
      ? "Work mode: execute. Complete the task with this agent. Prefer direct artifact delivery, precise search and existing test receipts. No delegation."
      : mode === "team"
        ? "Work mode: team. Delegate only independent useful work. Give each child a concise goal, source references and acceptance criteria; all children share the original fixed budget. Continue independent work while a child awaits input."
        : "";
}
