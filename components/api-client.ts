let projectId: string | undefined;
let workspaceId: string | undefined;
export function setProjectScope(id?: string) {
  projectId = id;
}
export async function selectProject(id: string) {
  const result = await api<{ id: string; saved: boolean }>(
    "preferences/project",
    { id },
    "POST",
    { projectScope: false },
  );
  projectId = result.id;
  return result;
}
export function selectWorkspace(id?: string) {
  if (workspaceId !== id) projectId = undefined;
  workspaceId = id;
}
export async function api<T = Record<string, any>>(
  path: string,
  body?: unknown,
  method = "POST",
  options: { projectScope?: boolean; projectId?: string } = {},
): Promise<T> {
  const form = typeof FormData !== "undefined" && body instanceof FormData;
  const r = await fetch(`/api/${path}`, {
    method: body === undefined ? "GET" : method,
    headers: {
      ...(body === undefined || form
        ? {}
        : { "Content-Type": "application/json" }),
      ...((options.projectId ?? projectId) && options.projectScope !== false
        ? { "x-project-id": options.projectId ?? projectId! }
        : {}),
      ...(workspaceId ? { "x-workspace-id": workspaceId } : {}),
    },
    body: body === undefined ? undefined : form ? body : JSON.stringify(body),
    cache: "no-store",
  });
  const data = await r.json();
  if (!r.ok)
    throw Object.assign(new Error(data.error ?? "Anfrage fehlgeschlagen"), {
      status: r.status,
    });
  return data;
}
