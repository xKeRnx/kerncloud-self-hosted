import { z } from "zod";
export const bridgeCapabilities = [
  "files.read",
  "files.write",
  "network.http",
  "browser",
  "program.run",
  "desktop",
] as const;
export const bridgeCapability = z.enum(bridgeCapabilities);
export const bridgeScope = z
  .object({
    project_ids: z.array(z.string().uuid()).max(100).default([]),
    agent_ids: z.array(z.string().uuid()).max(100).default([]),
    capabilities: z.array(bridgeCapability).max(6).default([]),
  })
  .strict();
export const bridgeAction = z
  .object({
    device_id: z.string().uuid(),
    action: z.enum([
      "files.list",
      "files.read",
      "files.write",
      "network.http",
      "browser.open",
      "browser.snapshot",
      "browser.click",
      "browser.type",
      "browser.key",
      "program.run",
      "desktop.screenshot",
      "desktop.click",
      "desktop.type",
      "desktop.key",
    ]),
    root: z.string().max(80).optional(),
    path: z.string().max(500).optional(),
    content: z.string().max(60000).optional(),
    expected_hash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    url: z.string().url().max(2000).optional(),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional(),
    body: z.string().max(60000).optional(),
    ref: z.string().max(80).optional(),
    text: z.string().max(12000).optional(),
    key: z.string().max(40).optional(),
    x: z.number().int().min(0).max(32767).optional(),
    y: z.number().int().min(0).max(32767).optional(),
    program: z.string().max(80).optional(),
  })
  .strict();
export function bridgePermission(action: string) {
  if (action.startsWith("files."))
    return action === "files.write" ? "files.write" : "files.read";
  if (action.startsWith("browser.")) return "browser";
  if (action.startsWith("desktop.")) return "desktop";
  return action;
}
export function bridgeScopeAllows(
  scope: z.infer<typeof bridgeScope>,
  project: string,
  agent: string,
  action: string,
) {
  return (
    scope.project_ids.includes(project) &&
    scope.agent_ids.includes(agent) &&
    scope.capabilities.includes(bridgePermission(action) as any)
  );
}
export const bridgeTools = [
  {
    type: "function",
    function: {
      name: "list_bridges",
      description:
        "List locally connected customer devices explicitly permitted for this project and agent. Local capabilities are an additional ceiling; no grants are implied. Do not infer paths, program IDs or network targets.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "bridge_action",
      description:
        "Perform a permitted action on a customer Bridge. Uses root aliases and relative paths, locally configured program IDs (fixed executable and arguments), allowlisted URLs and isolated browser refs. Mutations and desktop actions require exact one-time approval in the decision inbox, in addition to local grants. Never repeat an uncertain external action. For writes use expected_hash from a prior read, or omit only for a new file. Results may leave the device and reach the AI provider. Desktop screenshot returns a downloadable image, not hidden reasoning.",
      parameters: {
        type: "object",
        properties: {
          device_id: { type: "string" },
          action: { type: "string", enum: bridgeAction.shape.action.options },
          root: { type: "string" },
          path: { type: "string" },
          content: { type: "string" },
          expected_hash: { type: "string" },
          url: { type: "string" },
          method: {
            type: "string",
            enum: ["GET", "POST", "PUT", "PATCH", "DELETE"],
          },
          body: { type: "string" },
          ref: { type: "string" },
          text: { type: "string" },
          key: { type: "string" },
          x: { type: "integer" },
          y: { type: "integer" },
          program: { type: "string" },
        },
        required: ["device_id", "action"],
        additionalProperties: false,
      },
    },
  },
];
export function bridgeNeedsApproval(b: z.infer<typeof bridgeAction>) {
  return !["files.list", "files.read", "browser.snapshot"].includes(b.action);
}
