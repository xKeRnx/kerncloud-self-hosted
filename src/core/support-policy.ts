export function allowSupport(path: string, method: string, mode: string) {
  if (
    ["workspaces/select", "preferences/project"].includes(path) &&
    method === "POST"
  )
    return true;
  if (method === "GET")
    return (
      [
        "state",
        "workspace/home",
        "project/results",
        "workspace/tasks",
        "usage",
        "profile",
        "profile/security",
        "runtime",
        "environments",
        "billing/invoices",
        "account/benefits",
        "memory",
        "memory/export",
        "live",
      ].includes(path) ||
      /^artifacts\/[^/]+\/(download|preview)$/.test(path) ||
      /^runs\/[^/]+\/download$/.test(path) ||
      /^account\/benefits\/[^/]+\/receipt$/.test(path) ||
      /^billing\/invoices\/[^/]+\/download$/.test(path)
    );
  if (mode !== "write") return false;
  if (method === "POST")
    return (
      [
        "runs",
        "agents",
        "skills",
        "chat",
        "memory",
        "memory/delete",
        "execution/control",
        "attachments/upload",
      ].includes(path) || /^runs\/[^/]+\/(message|retry)$/.test(path)
    );
  return method === "PATCH" && /^runs\/[^/]+$/.test(path);
}
