import { z } from "zod";
export const appProviders = ["google", "microsoft", "github"] as const;
export type AppProvider = (typeof appProviders)[number];
export const appScopes = {
  google: {
    read: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/drive.readonly",
    ],
    write: [
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/calendar.events",
    ],
  },
  microsoft: {
    read: ["offline_access", "Mail.Read", "Calendars.Read", "Files.Read"],
    write: ["Mail.Send", "Calendars.ReadWrite"],
  },
  github: { read: ["read:user", "repo"], write: [] },
};
export const appActionInput = z
  .object({
    connection_id: z.string().uuid(),
    operation: z.enum([
      "mail_list",
      "mail_read",
      "mail_send",
      "calendar_list",
      "calendar_create",
      "files_list",
      "file_read",
      "repos_list",
      "github_publish",
    ]),
    input: z.record(z.unknown()).default({}),
  })
  .strict();
export type AppAction = z.infer<typeof appActionInput>;
export function appWrites(operation: string) {
  return ["mail_send", "calendar_create", "github_publish"].includes(operation);
}
const id = z
    .string()
    .min(1)
    .max(300)
    .regex(/^[\w.\-!]+$/),
  short = z.string().min(1).max(500),
  date = z.string().datetime({ offset: true });
export function appPlan(
  provider: AppProvider,
  operation: AppAction["operation"],
  input: unknown,
) {
  const get = (url: string) => ({
    url,
    method: "GET",
    body: undefined as unknown,
  });
  const post = (url: string, body: unknown) => ({ url, method: "POST", body });
  if (provider === "github") {
    if (operation === "repos_list")
      return get("https://api.github.com/user/repos?per_page=30&sort=updated");
    throw new Error("Operation unavailable for this provider");
  }
  const graph = "https://graph.microsoft.com/v1.0/me",
    g = provider === "google";
  if (operation === "mail_list")
    return get(
      g
        ? "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20"
        : graph +
            "/messages?$top=20&$select=id,subject,from,receivedDateTime,bodyPreview",
    );
  if (operation === "mail_read") {
    const b = z.object({ id }).strict().parse(input);
    return get(
      g
        ? "https://gmail.googleapis.com/gmail/v1/users/me/messages/" +
            encodeURIComponent(b.id) +
            "?format=full"
        : graph + "/messages/" + encodeURIComponent(b.id),
    );
  }
  if (operation === "calendar_list")
    return get(
      g
        ? "https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=30&timeMin=" +
            encodeURIComponent(new Date().toISOString())
        : graph +
            "/calendarView?startDateTime=" +
            encodeURIComponent(new Date().toISOString()) +
            "&endDateTime=" +
            encodeURIComponent(
              new Date(Date.now() + 7 * 86400000).toISOString(),
            ) +
            "&$top=30",
    );
  if (operation === "files_list")
    return get(
      g
        ? "https://www.googleapis.com/drive/v3/files?pageSize=30&fields=files(id,name,mimeType,modifiedTime)"
        : graph +
            "/drive/root/children?$top=30&$select=id,name,size,lastModifiedDateTime",
    );
  if (operation === "file_read") {
    const b = z.object({ id }).strict().parse(input);
    return get(
      g
        ? "https://www.googleapis.com/drive/v3/files/" +
            encodeURIComponent(b.id) +
            "?fields=id,name,description,mimeType,size"
        : graph +
            "/drive/items/" +
            encodeURIComponent(b.id) +
            "?$select=id,name,description,size,file",
    );
  }
  if (operation === "mail_send") {
    const b = z
      .object({
        to: z.string().email().max(254),
        subject: short,
        text: z.string().min(1).max(30000),
      })
      .strict()
      .parse(input);
    if (/[\r\n]/.test(b.subject)) throw new Error("Invalid mail subject");
    return g
      ? post("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
          raw: Buffer.from(
            "To: " +
              b.to +
              "\r\nSubject: =?UTF-8?B?" +
              Buffer.from(b.subject).toString("base64") +
              "?=\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" +
              Buffer.from(b.text).toString("base64"),
          ).toString("base64url"),
        })
      : post(graph + "/sendMail", {
          message: {
            subject: b.subject,
            body: { contentType: "Text", content: b.text },
            toRecipients: [{ emailAddress: { address: b.to } }],
          },
          saveToSentItems: true,
        });
  }
  if (operation === "calendar_create") {
    const b = z
      .object({
        title: short,
        start: date,
        end: date,
        description: z.string().max(10000).default(""),
      })
      .strict()
      .parse(input);
    if (Date.parse(b.end) <= Date.parse(b.start))
      throw new Error("End must follow start");
    return g
      ? post(
          "https://www.googleapis.com/calendar/v3/calendars/primary/events",
          {
            summary: b.title,
            description: b.description,
            start: { dateTime: b.start },
            end: { dateTime: b.end },
          },
        )
      : post(graph + "/events", {
          subject: b.title,
          body: { contentType: "Text", content: b.description },
          start: {
            dateTime: new Date(b.start).toISOString().replace("Z", ""),
            timeZone: "UTC",
          },
          end: {
            dateTime: new Date(b.end).toISOString().replace("Z", ""),
            timeZone: "UTC",
          },
        });
  }
  throw new Error("Operation unavailable for this provider");
}
