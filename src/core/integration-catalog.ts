export type IntegrationField = {
  name: string;
  label: string;
  required?: boolean;
};
export type IntegrationAction = {
  id: string;
  label: string;
  write?: boolean;
  fields: IntegrationField[];
};
export type Integration = {
  id: string;
  name: string;
  provider: string;
  category: string;
  auth: "oauth" | "token";
  docs: string;
  description: string;
  operations?: string[];
  scopes?: { read: string[]; write: string[] };
  actions: IntegrationAction[];
  test: { operation: string; input: Record<string, unknown> };
};
const field = (
  name: string,
  label: string,
  required = true,
): IntegrationField => ({ name, label, required });
const action = (
  id: string,
  label: string,
  fields: IntegrationField[] = [],
  write = false,
): IntegrationAction => ({ id, label, fields, write });
const oauth = (
  id: string,
  name: string,
  provider: string,
  category: string,
  description: string,
  docs: string,
  read: string[],
  write: string[],
  operations: string[],
  test: string,
): Integration => ({
  id,
  name,
  provider,
  category,
  description,
  docs,
  auth: "oauth",
  scopes: { read, write },
  operations,
  actions: [],
  test: { operation: test, input: {} },
});
const token = (
  id: string,
  name: string,
  category: string,
  description: string,
  docs: string,
  actions: IntegrationAction[],
  test: string,
): Integration => ({
  id,
  name,
  provider: id,
  category,
  description,
  docs,
  auth: "token",
  actions,
  test: { operation: "service_read", input: { action: test } },
});
const google = "https://www.googleapis.com/auth/";
export const integrations: Integration[] = [
  oauth(
    "gmail",
    "Gmail",
    "google",
    "Mail & calendar",
    "Find and read messages; send plain-text email with approval.",
    "https://developers.google.com/workspace/gmail/api/guides",
    [google + "gmail.readonly"],
    [google + "gmail.send"],
    ["mail_list", "mail_read", "mail_send"],
    "mail_list",
  ),
  oauth(
    "google-calendar",
    "Google Calendar",
    "google",
    "Mail & calendar",
    "Read upcoming events and create appointments with approval.",
    "https://developers.google.com/workspace/calendar/api/guides/overview",
    [google + "calendar.readonly"],
    [google + "calendar.events"],
    ["calendar_list", "calendar_create"],
    "calendar_list",
  ),
  oauth(
    "google-drive",
    "Google Drive",
    "google",
    "Files & knowledge",
    "List files and read or export supported text documents.",
    "https://developers.google.com/workspace/drive/api/guides/about-sdk",
    [google + "drive.readonly"],
    [],
    ["files_list", "file_read"],
    "files_list",
  ),
  oauth(
    "outlook",
    "Outlook Mail",
    "microsoft",
    "Mail & calendar",
    "Read messages and send email with approval.",
    "https://learn.microsoft.com/en-us/graph/api/resources/mail-api-overview",
    ["offline_access", "Mail.Read"],
    ["Mail.Send"],
    ["mail_list", "mail_read", "mail_send"],
    "mail_list",
  ),
  oauth(
    "microsoft-calendar",
    "Microsoft Calendar",
    "microsoft",
    "Mail & calendar",
    "Read upcoming events and create appointments with approval.",
    "https://learn.microsoft.com/en-us/graph/api/resources/calendar",
    ["offline_access", "Calendars.Read"],
    ["Calendars.ReadWrite"],
    ["calendar_list", "calendar_create"],
    "calendar_list",
  ),
  oauth(
    "onedrive",
    "OneDrive",
    "microsoft",
    "Files & knowledge",
    "List files and read supported text files.",
    "https://learn.microsoft.com/en-us/graph/api/resources/onedrive",
    ["offline_access", "Files.Read"],
    [],
    ["files_list", "file_read"],
    "files_list",
  ),
  oauth(
    "github",
    "GitHub",
    "github",
    "Development",
    "List repositories and publish reviewed files as a draft pull request.",
    "https://docs.github.com/en/rest",
    ["read:user", "repo"],
    [],
    ["repos_list", "github_publish"],
    "repos_list",
  ),
  token(
    "discord",
    "Discord",
    "Chat & collaboration",
    "Read channel messages and send bot messages with approval. Bot access only.",
    "https://docs.discord.com/developers/resources/message",
    [
      action("identity", "Identify bot"),
      action("messages", "Read channel messages", [
        field("channel_id", "Channel ID"),
      ]),
      action(
        "send",
        "Send channel message",
        [field("channel_id", "Channel ID"), field("text", "Message")],
        true,
      ),
    ],
    "identity",
  ),
  token(
    "slack",
    "Slack",
    "Chat & collaboration",
    "List channels, read recent messages and send messages with approval.",
    "https://docs.slack.dev/reference/methods/",
    [
      action("identity", "Test bot identity"),
      action("channels", "List channels"),
      action("messages", "Read channel messages", [
        field("channel_id", "Channel ID"),
      ]),
      action(
        "send",
        "Send message",
        [field("channel_id", "Channel ID"), field("text", "Message")],
        true,
      ),
    ],
    "identity",
  ),
  token(
    "notion",
    "Notion",
    "Files & knowledge",
    "Search shared pages, read page blocks and append text with approval.",
    "https://developers.notion.com/reference/intro",
    [
      action("identity", "Identify integration"),
      action("search", "Search page titles", [
        field("query", "Search query", false),
      ]),
      action("blocks", "Read page blocks", [
        field("page_id", "Page or block ID"),
      ]),
      action(
        "append",
        "Append paragraph",
        [field("page_id", "Page ID"), field("text", "Paragraph")],
        true,
      ),
    ],
    "identity",
  ),
  token(
    "linear",
    "Linear",
    "Tasks & CRM",
    "List teams and assigned issues; create an issue with approval.",
    "https://linear.app/developers/graphql",
    [
      action("identity", "Identify account"),
      action("teams", "List teams"),
      action("issues", "List assigned issues"),
      action(
        "create",
        "Create issue",
        [
          field("team_id", "Team ID"),
          field("title", "Title"),
          field("text", "Description", false),
        ],
        true,
      ),
    ],
    "identity",
  ),
  token(
    "todoist",
    "Todoist",
    "Tasks & CRM",
    "List projects and tasks; create a task with approval.",
    "https://developer.todoist.com/api/v1/",
    [
      action("projects", "List projects"),
      action("tasks", "List active tasks"),
      action(
        "create",
        "Create task",
        [field("title", "Task"), field("project_id", "Project ID", false)],
        true,
      ),
    ],
    "projects",
  ),
  token(
    "asana",
    "Asana",
    "Tasks & CRM",
    "List workspaces and project tasks; create a task with approval.",
    "https://developers.asana.com/reference",
    [
      action("identity", "Identify account"),
      action("workspaces", "List workspaces"),
      action("tasks", "List project tasks", [
        field("project_id", "Project ID"),
      ]),
      action(
        "create",
        "Create task",
        [
          field("workspace_id", "Workspace ID"),
          field("title", "Title"),
          field("text", "Notes", false),
        ],
        true,
      ),
    ],
    "identity",
  ),
  token(
    "clickup",
    "ClickUp",
    "Tasks & CRM",
    "List workspaces and list tasks; create a task with approval.",
    "https://developer.clickup.com/reference",
    [
      action("identity", "Identify account"),
      action("workspaces", "List workspaces"),
      action("tasks", "Read list tasks", [field("list_id", "List ID")]),
      action(
        "create",
        "Create task",
        [
          field("list_id", "List ID"),
          field("title", "Title"),
          field("text", "Description", false),
        ],
        true,
      ),
    ],
    "identity",
  ),
  token(
    "airtable",
    "Airtable",
    "Tasks & CRM",
    "List accessible bases, read records and create one record with approval.",
    "https://airtable.com/developers/web/api/introduction",
    [
      action("bases", "List bases"),
      action("records", "Read table records", [
        field("base_id", "Base ID"),
        field("table_id", "Table ID"),
      ]),
      action(
        "create",
        "Create record",
        [
          field("base_id", "Base ID"),
          field("table_id", "Table ID"),
          field("fields_json", "Record fields as JSON"),
        ],
        true,
      ),
    ],
    "bases",
  ),
  token(
    "hubspot",
    "HubSpot",
    "Tasks & CRM",
    "Read contacts and deals; create a contact with approval.",
    "https://developers.hubspot.com/docs/api-reference/overview",
    [
      action("contacts", "List contacts"),
      action("deals", "List deals"),
      action(
        "create",
        "Create contact",
        [
          field("email", "Email"),
          field("first_name", "First name", false),
          field("last_name", "Last name", false),
        ],
        true,
      ),
    ],
    "contacts",
  ),
  token(
    "dropbox",
    "Dropbox",
    "Files & knowledge",
    "Identify account and list folder contents.",
    "https://www.dropbox.com/developers/documentation/http/documentation",
    [
      action("identity", "Identify account"),
      action("files", "List folder", [
        field("path", "Folder path (empty for root)", false),
      ]),
    ],
    "identity",
  ),
  token(
    "figma",
    "Figma",
    "Design",
    "Identify account, inspect file metadata and read file comments.",
    "https://developers.figma.com/docs/rest-api/",
    [
      action("identity", "Identify account"),
      action("file", "Read file metadata", [field("file_id", "File key")]),
      action("comments", "Read file comments", [field("file_id", "File key")]),
    ],
    "identity",
  ),
  token(
    "vercel",
    "Vercel",
    "Development",
    "List projects and recent deployments. Deployment changes are not enabled.",
    "https://vercel.com/docs/rest-api",
    [
      action("projects", "List projects"),
      action("deployments", "List deployments"),
    ],
    "projects",
  ),
  token(
    "cloudflare",
    "Cloudflare",
    "Development",
    "Verify API token, list zones and inspect DNS records.",
    "https://developers.cloudflare.com/api/",
    [
      action("identity", "Verify API token"),
      action("zones", "List zones"),
      action("dns", "Read DNS records", [field("zone_id", "Zone ID")]),
    ],
    "identity",
  ),
  oauth(
    "google-docs",
    "Google Docs",
    "google",
    "Files & knowledge",
    "Find document metadata and read document structure and text.",
    "https://developers.google.com/workspace/docs/api/reference/rest",
    [google + "drive.metadata.readonly", google + "documents.readonly"],
    [],
    [],
    "service_read",
  ),
  oauth(
    "google-sheets",
    "Google Sheets",
    "google",
    "Files & knowledge",
    "Find spreadsheets and read a bounded cell range.",
    "https://developers.google.com/workspace/sheets/api/reference/rest",
    [google + "drive.metadata.readonly", google + "spreadsheets.readonly"],
    [],
    [],
    "service_read",
  ),
  oauth(
    "google-tasks",
    "Google Tasks",
    "google",
    "Tasks & CRM",
    "List task lists and tasks; create a task with approval.",
    "https://developers.google.com/workspace/tasks/reference/rest",
    [google + "tasks.readonly"],
    [google + "tasks"],
    [],
    "service_read",
  ),
  oauth(
    "google-contacts",
    "Google Contacts",
    "google",
    "Mail & calendar",
    "Read contact names and email addresses.",
    "https://developers.google.com/people/api/rest/v1/people.connections/list",
    [google + "contacts.readonly"],
    [],
    [],
    "service_read",
  ),
  oauth(
    "youtube",
    "YouTube",
    "google",
    "Design",
    "Read your channels and playlist items. No publishing or deletion.",
    "https://developers.google.com/youtube/v3/docs",
    [google + "youtube.readonly"],
    [],
    [],
    "service_read",
  ),
  oauth(
    "microsoft-todo",
    "Microsoft To Do",
    "microsoft",
    "Tasks & CRM",
    "List task lists and tasks; create a task with approval.",
    "https://learn.microsoft.com/en-us/graph/api/resources/todo-overview",
    ["offline_access", "Tasks.Read"],
    ["Tasks.ReadWrite"],
    [],
    "service_read",
  ),
  oauth(
    "microsoft-contacts",
    "Microsoft Contacts",
    "microsoft",
    "Mail & calendar",
    "Read contact names and email addresses.",
    "https://learn.microsoft.com/en-us/graph/api/user-list-contacts",
    ["offline_access", "Contacts.Read"],
    [],
    [],
    "service_read",
  ),
  oauth(
    "onenote",
    "OneNote",
    "microsoft",
    "Files & knowledge",
    "List notebook and page metadata.",
    "https://learn.microsoft.com/en-us/graph/api/resources/onenote-api-overview",
    ["offline_access", "Notes.Read"],
    [],
    [],
    "service_read",
  ),
  oauth(
    "teams",
    "Microsoft Teams",
    "microsoft",
    "Chat & collaboration",
    "List your chats and read recent messages. Tenant consent may be required.",
    "https://learn.microsoft.com/en-us/graph/api/chat-list",
    ["offline_access", "Chat.Read"],
    [],
    [],
    "service_read",
  ),
  token(
    "gitlab",
    "GitLab.com",
    "Development",
    "List member projects and project issues; create an issue with approval.",
    "https://docs.gitlab.com/api/rest/",
    [
      action("identity", "Identify account"),
      action("projects", "List member projects"),
      action("issues", "List project issues", [
        field("project_id", "Numeric project ID"),
      ]),
      action(
        "create",
        "Create issue",
        [
          field("project_id", "Numeric project ID"),
          field("title", "Title"),
          field("text", "Description", false),
        ],
        true,
      ),
    ],
    "identity",
  ),
];
integrations.push(
  token(
    "ayrshare",
    "Ayrshare Social Media",
    "Social media",
    "Connect profiles in Ayrshare; inspect connected accounts and history. Publish approved text posts to supported text networks. A separate provider plan is required.",
    "https://www.ayrshare.com/docs/introduction",
    [
      action("profiles", "Inspect connected profiles"),
      action("history", "Read recent post history"),
      action(
        "publish",
        "Publish text post",
        [
          field(
            "platforms",
            "Comma-separated: twitter, facebook, linkedin, threads, bluesky",
          ),
          field("text", "Post text"),
        ],
        true,
      ),
    ],
    "profiles",
  ),
  token(
    "apify",
    "Apify Datasets",
    "Research & data",
    "List existing datasets and read a bounded page of collected records. Does not start actors or paid scraping jobs.",
    "https://docs.apify.com/api/v2",
    [
      action("datasets", "List existing datasets"),
      action("items", "Read dataset records", [
        field("dataset_id", "Dataset ID"),
      ]),
    ],
    "datasets",
  ),
);
const serviceActions: Record<string, IntegrationAction[]> = {
  "google-docs": [
    action("files", "Find documents"),
    action("document", "Read document", [field("document_id", "Document ID")]),
  ],
  "google-sheets": [
    action("files", "Find spreadsheets"),
    action("values", "Read cell range", [
      field("spreadsheet_id", "Spreadsheet ID"),
      field("range", "Cell range (maximum 200 cells per dimension)"),
    ]),
  ],
  "google-tasks": [
    action("lists", "List task lists"),
    action("tasks", "List tasks", [field("list_id", "Task list ID")]),
    action(
      "create",
      "Create task",
      [
        field("list_id", "Task list ID"),
        field("title", "Title"),
        field("text", "Notes", false),
      ],
      true,
    ),
  ],
  "google-contacts": [action("contacts", "List contacts")],
  youtube: [
    action("channels", "List own channels"),
    action("playlist", "Read playlist items", [
      field("playlist_id", "Playlist ID"),
    ]),
  ],
  "microsoft-todo": [
    action("lists", "List task lists"),
    action("tasks", "Read tasks", [field("list_id", "Task list ID")]),
    action(
      "create",
      "Create task",
      [field("list_id", "Task list ID"), field("title", "Title")],
      true,
    ),
  ],
  "microsoft-contacts": [action("contacts", "List contacts")],
  onenote: [
    action("notebooks", "List notebooks"),
    action("pages", "List pages"),
  ],
  teams: [
    action("chats", "List chats"),
    action("messages", "Read chat messages", [field("chat_id", "Chat ID")]),
  ],
};
for (const integration of integrations)
  if (serviceActions[integration.id]) {
    integration.actions = serviceActions[integration.id];
    integration.test.input = { action: integration.actions[0].id };
  }
export const tokenProviders = integrations
  .filter((i) => i.auth === "token")
  .map((i) => i.provider);
export const integrationById = (id: string | null | undefined) =>
  integrations.find((i) => i.id === id);
export function integrationManifest(serviceId: string | null | undefined) {
  const i = integrationById(serviceId);
  return i
    ? {
        service: i.id,
        operations: i.operations ?? [],
        actions: i.actions,
        operation_fields: Object.fromEntries(
          (i.operations ?? []).map((operation) => [
            operation,
            (
              {
                mail_list: [],
                mail_read: ["id"],
                mail_send: ["to", "subject", "text"],
                calendar_list: [],
                calendar_create: [
                  "title",
                  "start (ISO datetime)",
                  "end (ISO datetime)",
                  "description (optional)",
                ],
                files_list: [],
                file_read: ["id"],
                repos_list: [],
                github_publish: [
                  "repository (owner/repo)",
                  "base",
                  "branch",
                  "title",
                  "body",
                  "files [{path,content}] (max 20KB)",
                ],
              } as Record<string, string[]>
            )[operation] ?? [],
          ]),
        ),
      }
    : undefined;
}
