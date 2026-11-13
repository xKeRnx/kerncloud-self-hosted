export type WorkspaceRole = "owner" | "admin" | "editor" | "viewer";
export function workspacePermission(
  role: WorkspaceRole,
  path: string,
  method: string,
  body?: unknown,
) {
  if (path === "privacy/settings" && role !== "owner") return false;
  if (
    role === "owner" ||
    path.startsWith("admin") ||
    path.startsWith("profile") ||
    path.startsWith("privacy") ||
    path === "auth/logout" ||
    path === "workspaces/select" ||
    path === "preferences/project" ||
    path === "preferences/appearance" ||
    path === "workspaces" ||
    path === "team/accept"
  )
    return true;
  if (
    path.startsWith("billing") ||
    path === "runtime/checkout" ||
    path === "account/benefits" ||
    path.startsWith("customer-hosts") ||
    path.startsWith("bridge") ||
    path.startsWith("execution-policy") ||
    path.startsWith("usage") ||
    path === "environments/access" ||
    path === "environments/launch" ||
    path.startsWith("connectors/admin")
  )
    return false;
  if (role === "admin") return true;
  if (method === "GET") return !path.startsWith("team/invitations");
  if (
    path === "team/leave" ||
    path === "briefings/read" ||
    path === "knowledge/search" ||
    path === "knowledge/read"
  )
    return true;
  if (role === "viewer") return false;
  if (path === "decisions/respond")
    return (body as { choice?: string })?.choice !== "approve";
  return (
    path === "project-pages" ||
    path === "suite/plan" ||
    path === "suite/templates" ||
    path === "briefings/refresh" ||
    path === "chat" ||
    path === "runs" ||
    path.startsWith("runs/") ||
    path === "execution/control" ||
    path.startsWith("suite/projects/") ||
    path === "suite/quality/start" ||
    path === "suite/exports" ||
    path === "materials/upload" ||
    path.startsWith("attachments/")
  );
}
