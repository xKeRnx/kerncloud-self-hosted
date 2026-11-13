import { z } from "zod";
import { integrationById } from "./integration-catalog.ts";

export type IntegrationPlan = { url: string; method: string; body?: unknown };
const key = z
  .string()
  .min(1)
  .max(300)
  .regex(/^[A-Za-z0-9_][A-Za-z0-9_.!:@-]*$/);
const get = (url: string): IntegrationPlan => ({ url, method: "GET" });
const post = (url: string, body: unknown): IntegrationPlan => ({
  url,
  method: "POST",
  body,
});
export function integrationPlan(
  service: string,
  operation: string,
  input: unknown,
): IntegrationPlan {
  const definition = integrationById(service);
  if (!definition) throw new Error("Unknown integration");
  const raw = z.object({ action: z.string() }).passthrough().parse(input);
  const action = definition.actions.find((a) => a.id === raw.action);
  if (
    !action ||
    operation !== (action.write ? "service_write" : "service_read")
  )
    throw new Error("Action is not permitted by this read/write operation");
  const shape: Record<string, z.ZodTypeAny> = { action: z.literal(action.id) };
  for (const f of action.fields) {
    const schema = f.name.endsWith("_id")
      ? key
      : z
          .string()
          .max(f.name === "text" || f.name === "fields_json" ? 10000 : 500);
    shape[f.name] = f.required ? schema.min(1) : schema.optional().default("");
  }
  const b = z.object(shape).strict().parse(input) as Record<string, string>;
  const id = (name: string) => encodeURIComponent(b[name]);
  const a = b.action;
  switch (service) {
    case "ayrshare":
      if (a === "profiles") return get("https://api.ayrshare.com/api/user");
      if (a === "history")
        return get("https://api.ayrshare.com/api/history?lastRecords=20");
      {
        const platforms = [
          ...new Set(b.platforms.split(",").map((p) => p.trim())),
        ];
        if (
          !platforms.length ||
          platforms.some(
            (p) =>
              ![
                "twitter",
                "facebook",
                "linkedin",
                "threads",
                "bluesky",
              ].includes(p),
          )
        )
          throw new Error(
            "Choose supported text platforms: twitter, facebook, linkedin, threads, bluesky",
          );
        return post("https://api.ayrshare.com/api/post", {
          post: b.text,
          platforms,
          shortenLinks: false,
        });
      }
    case "apify":
      return get(
        a === "datasets"
          ? "https://api.apify.com/v2/datasets?limit=20&desc=1"
          : `https://api.apify.com/v2/datasets/${id("dataset_id")}/items?format=json&limit=20&clean=true`,
      );
    case "discord":
      if (a === "identity") return get("https://discord.com/api/v10/users/@me");
      if (a === "messages")
        return get(
          `https://discord.com/api/v10/channels/${id("channel_id")}/messages?limit=20`,
        );
      if (b.text.length > 2000)
        throw new Error("Discord messages are limited to 2000 characters");
      return post(
        `https://discord.com/api/v10/channels/${id("channel_id")}/messages`,
        { content: b.text, allowed_mentions: { parse: [] } },
      );
    case "slack":
      if (a === "identity") return post("https://slack.com/api/auth.test", {});
      if (a === "channels")
        return get(
          "https://slack.com/api/conversations.list?limit=30&exclude_archived=true",
        );
      if (a === "messages")
        return get(
          `https://slack.com/api/conversations.history?channel=${id("channel_id")}&limit=10`,
        );
      return post("https://slack.com/api/chat.postMessage", {
        channel: b.channel_id,
        text: b.text,
        mrkdwn: false,
        unfurl_links: false,
        unfurl_media: false,
      });
    case "notion":
      if (a === "identity") return get("https://api.notion.com/v1/users/me");
      if (a === "search")
        return post("https://api.notion.com/v1/search", {
          query: b.query,
          page_size: 20,
        });
      if (a === "blocks")
        return get(
          `https://api.notion.com/v1/blocks/${id("page_id")}/children?page_size=30`,
        );
      if (b.text.length > 2000)
        throw new Error("Notion paragraphs are limited to 2000 characters");
      return {
        url: `https://api.notion.com/v1/blocks/${id("page_id")}/children`,
        method: "PATCH",
        body: {
          children: [
            {
              object: "block",
              type: "paragraph",
              paragraph: {
                rich_text: [{ type: "text", text: { content: b.text } }],
              },
            },
          ],
        },
      };
    case "linear": {
      if (a === "identity")
        return post("https://api.linear.app/graphql", {
          query: "query { viewer { id name } }",
        });
      if (a === "teams")
        return post("https://api.linear.app/graphql", {
          query: "query { teams(first:20) { nodes { id name key } } }",
        });
      if (a === "issues")
        return post("https://api.linear.app/graphql", {
          query:
            "query { viewer { assignedIssues(first:20) { nodes { id identifier title state { name } } } } }",
        });
      return post("https://api.linear.app/graphql", {
        query:
          "mutation CreateIssue($input:IssueCreateInput!){ issueCreate(input:$input){ success issue { id identifier title url } } }",
        variables: {
          input: { teamId: b.team_id, title: b.title, description: b.text },
        },
      });
    }
    case "todoist":
      if (a === "projects")
        return get("https://api.todoist.com/api/v1/projects?limit=30");
      if (a === "tasks")
        return get("https://api.todoist.com/api/v1/tasks?limit=30");
      return post("https://api.todoist.com/api/v1/tasks", {
        content: b.title,
        ...(b.project_id ? { project_id: b.project_id } : {}),
      });
    case "asana":
      if (a === "identity")
        return get(
          "https://app.asana.com/api/1.0/users/me?opt_fields=gid,name",
        );
      if (a === "workspaces")
        return get("https://app.asana.com/api/1.0/workspaces?limit=30");
      if (a === "tasks")
        return get(
          `https://app.asana.com/api/1.0/tasks?project=${id("project_id")}&limit=20&opt_fields=gid,name,completed,notes`,
        );
      return post("https://app.asana.com/api/1.0/tasks", {
        data: { workspace: b.workspace_id, name: b.title, notes: b.text },
      });
    case "clickup":
      if (a === "identity") return get("https://api.clickup.com/api/v2/user");
      if (a === "workspaces") return get("https://api.clickup.com/api/v2/team");
      if (a === "tasks")
        return get(
          `https://api.clickup.com/api/v2/list/${id("list_id")}/task?page=0&include_closed=false`,
        );
      return post(`https://api.clickup.com/api/v2/list/${id("list_id")}/task`, {
        name: b.title,
        description: b.text,
        notify_all: false,
      });
    case "airtable":
      if (a === "bases")
        return get("https://api.airtable.com/v0/meta/bases?pageSize=30");
      if (a === "records")
        return get(
          `https://api.airtable.com/v0/${id("base_id")}/${id("table_id")}?pageSize=20&maxRecords=20`,
        );
      return post(
        `https://api.airtable.com/v0/${id("base_id")}/${id("table_id")}`,
        {
          records: [
            { fields: z.record(z.unknown()).parse(JSON.parse(b.fields_json)) },
          ],
        },
      );
    case "hubspot":
      if (a === "contacts")
        return get(
          "https://api.hubapi.com/crm/v3/objects/contacts?limit=20&properties=firstname,lastname,email",
        );
      if (a === "deals")
        return get(
          "https://api.hubapi.com/crm/v3/objects/deals?limit=20&properties=dealname,amount,dealstage",
        );
      return post("https://api.hubapi.com/crm/v3/objects/contacts", {
        properties: {
          email: z.string().email().parse(b.email),
          firstname: b.first_name,
          lastname: b.last_name,
        },
      });
    case "dropbox":
      if (a === "identity")
        return post(
          "https://api.dropboxapi.com/2/users/get_current_account",
          null,
        );
      return post("https://api.dropboxapi.com/2/files/list_folder", {
        path: b.path,
        limit: 30,
        recursive: false,
      });
    case "figma":
      if (a === "identity") return get("https://api.figma.com/v1/me");
      return get(
        `https://api.figma.com/v1/files/${id("file_id")}/${a === "file" ? "meta" : "comments"}`,
      );
    case "vercel":
      return get(
        a === "projects"
          ? "https://api.vercel.com/v9/projects?limit=20"
          : "https://api.vercel.com/v6/deployments?limit=20",
      );
    case "cloudflare":
      if (a === "identity")
        return get("https://api.cloudflare.com/client/v4/user/tokens/verify");
      if (a === "zones")
        return get("https://api.cloudflare.com/client/v4/zones?per_page=20");
      return get(
        `https://api.cloudflare.com/client/v4/zones/${id("zone_id")}/dns_records?per_page=20`,
      );
    case "gitlab":
      if (a === "identity") return get("https://gitlab.com/api/v4/user");
      if (a === "projects")
        return get(
          "https://gitlab.com/api/v4/projects?membership=true&per_page=20&simple=true",
        );
      if (a === "issues")
        return get(
          `https://gitlab.com/api/v4/projects/${id("project_id")}/issues?per_page=20`,
        );
      return post(
        `https://gitlab.com/api/v4/projects/${id("project_id")}/issues`,
        { title: b.title, description: b.text },
      );
    case "google-docs":
    case "google-sheets":
      if (a === "files")
        return get(
          "https://www.googleapis.com/drive/v3/files?pageSize=20&fields=files(id,name,mimeType)&q=" +
            encodeURIComponent(
              `trashed=false and mimeType='application/vnd.google-apps.${service === "google-docs" ? "document" : "spreadsheet"}'`,
            ),
        );
      if (a === "document")
        return get(
          `https://docs.googleapis.com/v1/documents/${id("document_id")}`,
        );
      // Deliberately restrict ranges so one tool call cannot read an entire workbook.
      if (
        !/^(?:[A-Za-z0-9_ ]+!)?[A-Z]{1,2}[1-9][0-9]{0,3}:[A-Z]{1,2}[1-9][0-9]{0,3}$/.test(
          b.range,
        )
      )
        throw new Error("Use a bounded A1 range such as Sheet1!A1:D30");
      {
        const cells = b.range.split("!").pop()!.split(":");
        const column = (s: string) =>
          [...s.match(/^[A-Z]+/)![0]].reduce(
            (n, c) => n * 26 + c.charCodeAt(0) - 64,
            0,
          );
        const rows = cells.map((c) => Number(c.match(/[0-9]+/)![0]));
        if (
          Math.abs(rows[1] - rows[0]) >= 200 ||
          Math.abs(column(cells[1]) - column(cells[0])) >= 200
        )
          throw new Error("Cell range exceeds 200 rows or columns");
      }
      return get(
        `https://sheets.googleapis.com/v4/spreadsheets/${id("spreadsheet_id")}/values/${encodeURIComponent(b.range)}`,
      );
    case "google-tasks":
      if (a === "lists")
        return get(
          "https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=30",
        );
      if (a === "tasks")
        return get(
          `https://tasks.googleapis.com/tasks/v1/lists/${id("list_id")}/tasks?maxResults=30`,
        );
      return post(
        `https://tasks.googleapis.com/tasks/v1/lists/${id("list_id")}/tasks`,
        { title: b.title, notes: b.text },
      );
    case "google-contacts":
      return get(
        "https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses&pageSize=30",
      );
    case "youtube":
      return get(
        a === "channels"
          ? "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&maxResults=20"
          : `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${id("playlist_id")}&maxResults=20`,
      );
    case "microsoft-todo":
      if (a === "lists")
        return get("https://graph.microsoft.com/v1.0/me/todo/lists?$top=30");
      if (a === "tasks")
        return get(
          `https://graph.microsoft.com/v1.0/me/todo/lists/${id("list_id")}/tasks?$top=30`,
        );
      return post(
        `https://graph.microsoft.com/v1.0/me/todo/lists/${id("list_id")}/tasks`,
        { title: b.title },
      );
    case "microsoft-contacts":
      return get(
        "https://graph.microsoft.com/v1.0/me/contacts?$top=30&$select=id,displayName,emailAddresses",
      );
    case "onenote":
      return get(
        a === "notebooks"
          ? "https://graph.microsoft.com/v1.0/me/onenote/notebooks?$top=20"
          : "https://graph.microsoft.com/v1.0/me/onenote/pages?$top=20&$select=id,title,lastModifiedDateTime",
      );
    case "teams":
      return get(
        a === "chats"
          ? "https://graph.microsoft.com/v1.0/me/chats?$top=20"
          : `https://graph.microsoft.com/v1.0/chats/${id("chat_id")}/messages?$top=20`,
      );
  }
  throw new Error("Integration action is unavailable");
}

const hosts: Record<string, string[]> = {
  google: [
    "gmail.googleapis.com",
    "www.googleapis.com",
    "docs.googleapis.com",
    "sheets.googleapis.com",
    "tasks.googleapis.com",
    "people.googleapis.com",
  ],
  microsoft: ["graph.microsoft.com"],
  github: ["api.github.com"],
  discord: ["discord.com"],
  slack: ["slack.com"],
  notion: ["api.notion.com"],
  linear: ["api.linear.app"],
  todoist: ["api.todoist.com"],
  asana: ["app.asana.com"],
  clickup: ["api.clickup.com"],
  airtable: ["api.airtable.com"],
  hubspot: ["api.hubapi.com"],
  dropbox: ["api.dropboxapi.com"],
  figma: ["api.figma.com"],
  vercel: ["api.vercel.com"],
  cloudflare: ["api.cloudflare.com"],
  gitlab: ["gitlab.com"],
  ayrshare: ["api.ayrshare.com"],
  apify: ["api.apify.com"],
};
export function integrationHeaders(
  provider: string,
  token: string,
  url: string,
) {
  const target = new URL(url);
  if (
    target.protocol !== "https:" ||
    target.username ||
    target.password ||
    target.port ||
    !hosts[provider]?.includes(target.hostname)
  )
    throw new Error("Unapproved integration endpoint");
  if (!token || /[\s\x00-\x1f\x7f]/.test(token))
    throw new Error("Invalid credential format");
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization:
      (provider === "discord"
        ? "Bot "
        : provider === "clickup" || provider === "linear"
          ? ""
          : "Bearer ") + token,
  };
  if (provider === "figma") {
    delete headers.Authorization;
    headers["X-Figma-Token"] = token;
  }
  if (provider === "notion") headers["Notion-Version"] = "2025-09-03";
  if (provider === "github") headers["X-GitHub-Api-Version"] = "2026-03-10";
  return headers;
}
