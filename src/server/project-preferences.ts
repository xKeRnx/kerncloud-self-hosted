import { pool, transaction } from "./db.ts";
import { projectFor } from "./organisation.ts";
import { workspaceRole } from "./team.ts";
export async function preferredProject(
  user: string,
  workspace: string,
  explicit?: string | null,
) {
  if (explicit) return projectFor(pool, workspace, explicit);
  const selected = (
    await pool.query(
      "SELECT p.* FROM user_workspace_preferences pref JOIN workspace_projects p ON p.id=pref.project_id AND p.workspace_id=pref.workspace_id WHERE pref.user_id=$1 AND pref.workspace_id=$2",
      [user, workspace],
    )
  ).rows[0];
  return selected ?? projectFor(pool, workspace);
}
export async function savePreferredProject(
  user: string,
  workspace: string,
  project: string,
) {
  await workspaceRole(user, workspace);
  return transaction(async (c) => {
    const selected = await projectFor(c, workspace, project);
    await c.query(
      "INSERT INTO user_workspace_preferences(user_id,workspace_id,project_id) VALUES($1,$2,$3) ON CONFLICT(user_id,workspace_id) DO UPDATE SET project_id=EXCLUDED.project_id,updated_at=now() WHERE user_workspace_preferences.project_id IS DISTINCT FROM EXCLUDED.project_id",
      [user, workspace, selected.id],
    );
    return { id: selected.id, saved: true };
  });
}
