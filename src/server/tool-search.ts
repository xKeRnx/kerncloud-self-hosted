import { projectPageTool, projectPagesReadTool } from "./project-pages.ts";
import { modeAllowsTool, type WorkMode } from "../core/work-modes.ts";
import { searchToolIndex } from "../core/tool-search.ts";
import { bridgeToolsFor } from "./bridge.ts";
import { builtinTools } from "./engine.ts";
import { environmentTools } from "../core/environment-tools.ts";
import type { PoolClient } from "pg";
export async function authorizedToolSearch(
  c: PoolClient,
  task: any,
  mapping: Record<string, { connectionId: string; toolName: string }>,
  query: string,
  mode?: WorkMode,
) {
  const connections = (
    await c.query(
      "SELECT co.id,co.name,co.allowed_tools FROM connections co JOIN agents a ON a.id=$2 WHERE co.workspace_id=$1 AND co.enabled AND a.workspace_id=$1 AND a.mcp_ids ? co.id",
      [task.workspace_id, task.agent_id],
    )
  ).rows;
  const tools = [
    ...builtinTools,
    projectPageTool,
    projectPagesReadTool,
    ...(await bridgeToolsFor(c, task)),
    ...environmentTools,
  ].map((t) => ({
    name: t.function.name,
    description: t.function.description,
    schema: t.function.parameters,
  }));
  for (const [name, link] of Object.entries(mapping)) {
    const conn = connections.find(
      (c) =>
        c.id === link.connectionId && c.allowed_tools.includes(link.toolName),
    );
    if (conn)
      tools.push({
        name,
        description: conn.name + " " + link.toolName,
        schema: undefined,
      });
  }
  const matches = searchToolIndex(
    tools.filter((t) => modeAllowsTool(mode, t.name)),
    query,
  );
  if (matches.length) {
    const previous = task.context_state?.loaded_tools ?? [];
    const names = [
      ...new Set([...previous, ...matches.map((m) => m.name)]),
    ].slice(-18);
    await c.query(
      "UPDATE tasks SET context_state=jsonb_set(context_state,'{loaded_tools}',$2::jsonb,true) WHERE id=$1",
      [task.id, JSON.stringify(names)],
    );
  }
  return {
    matches,
    guidance:
      "Nur gefundene Schemas nachgeladen; Ausführung prüft alle Freigaben erneut.",
  };
}
