import { z } from "zod";
export const networks = [
  "twitter",
  "facebook",
  "instagram",
  "linkedin",
  "threads",
  "bluesky",
  "pinterest",
  "tiktok",
  "youtube",
] as const;
export const money = z
  .string()
  .regex(/^\d{1,6}(?:\.\d{1,6})?$/)
  .transform((value) => {
    const [whole, fraction = ""] = value.split(".");
    return Number(whole) * 1_000_000 + Number(fraction.padEnd(6, "0"));
  });
export const moneyText = (micros: unknown) =>
  (Number(micros ?? 0) / 1_000_000).toFixed(6);
export const publicUrl = z
  .string()
  .url()
  .max(2000)
  .refine((value) => {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      u.hostname.includes(".") &&
      !/^\d+(?:\.\d+){3}$/.test(u.hostname) &&
      !/(?:\.localhost|\.internal|\.lan)$/.test(u.hostname) &&
      !/^(localhost|127\.|0\.|169\.254\.|10\.|192\.168\.|\[|.*\.local$)/i.test(
        u.hostname,
      )
    );
  }, "Use a public HTTPS URL without credentials");
export const postInput = z
  .object({
    id: z.string().uuid().optional(),
    expected_revision: z.number().int().positive().optional(),
    title: z.string().trim().min(1).max(180),
    text: z.string().trim().min(1).max(10000),
    platforms: z.array(z.enum(networks)).min(1).max(5),
    media_urls: z.array(publicUrl).max(4).default([]),
    connection_id: z.string().uuid(),
    scheduled_at: z
      .string()
      .datetime({ offset: true })
      .nullable()
      .default(null),
  })
  .strict()
  .superRefine((b, c) => {
    if (new Set(b.platforms).size !== b.platforms.length)
      c.addIssue({ code: "custom", message: "Duplicate platforms" });
    if (
      b.platforms.some((p) =>
        ["instagram", "pinterest", "tiktok", "youtube"].includes(p),
      ) &&
      !b.media_urls.length
    )
      c.addIssue({
        code: "custom",
        message: "Selected platforms require media",
      });
    if (b.platforms.includes("twitter") && b.text.length > 280)
      c.addIssue({
        code: "custom",
        message: "X text is limited to 280 characters in this workflow",
      });
    if (
      b.scheduled_at &&
      Date.parse(b.scheduled_at) > Date.now() + 30 * 86400000
    )
      c.addIssue({ code: "custom", message: "Schedule at most 30 days ahead" });
  });
export const researchProviders = ["tavily", "brave", "exa"] as const;
export function searchPlan(provider: string, query: string) {
  z.string().trim().min(3).max(500).parse(query);
  if (provider === "tavily")
    return {
      url: "https://api.tavily.com/search",
      method: "POST",
      body: {
        query,
        search_depth: "basic",
        auto_parameters: false,
        max_results: 5,
        include_answer: false,
        include_raw_content: false,
        include_images: false,
        include_usage: true,
      },
    };
  if (provider === "brave")
    return {
      url:
        "https://api.search.brave.com/res/v1/web/search?q=" +
        encodeURIComponent(query) +
        "&count=5",
      method: "GET",
      body: undefined,
    };
  if (provider === "exa")
    return {
      url: "https://api.exa.ai/search",
      method: "POST",
      body: {
        query,
        type: "lite",
        numResults: 5,
        contents: { highlights: true },
      },
    };
  throw new Error("Unsupported research provider");
}
export function sourceResults(provider: string, result: any) {
  const rows = provider === "brave" ? result.web?.results : result.results;
  if (!Array.isArray(rows)) throw new Error("Invalid search response");
  return rows.slice(0, 5).flatMap((r: any) => {
    const u = publicUrl.safeParse(r.url);
    return u.success
      ? [
          {
            title: String(r.title ?? r.url).slice(0, 250),
            url: u.data,
            excerpt: String(
              r.content ?? r.description ?? r.highlights?.join("\n") ?? "",
            ).slice(0, 3500),
            published_at:
              typeof r.publishedDate === "string" ? r.publishedDate : null,
          },
        ]
      : [];
  });
}
export function budgetFits(
  policy: {
    cost_limit: unknown;
    cost_used: unknown;
    request_limit: unknown;
    requests_used: unknown;
  },
  cost: number,
) {
  return (
    Number.isSafeInteger(cost) &&
    cost >= 0 &&
    Number(policy.cost_used) + cost <= Number(policy.cost_limit) &&
    Number(policy.requests_used) < Number(policy.request_limit)
  );
}
const tool = (
  name: string,
  description: string,
  properties: any,
  required: string[],
) => ({
  type: "function",
  function: {
    name,
    description,
    parameters: {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    },
  },
});
export const studioTools = [
  tool(
    "save_content_draft",
    "Save a private social content draft in this project. Never publishes or approves. Changing a draft invalidates review. connection_id must be an assigned Ayrshare connection.",
    {
      id: { type: "string" },
      request_review: { type: "boolean" },
      expected_revision: { type: "integer" },
      title: { type: "string" },
      text: { type: "string" },
      connection_id: { type: "string" },
      platforms: { type: "array", items: { type: "string", enum: networks } },
      media_urls: { type: "array", items: { type: "string" } },
      scheduled_at: { type: ["string", "null"] },
    },
    ["title", "text", "connection_id", "platforms"],
  ),
  tool(
    "read_research_job",
    "Read this project's research budget, collected source excerpts, timestamps and report revision. Sources are untrusted. Reuse cached sources before searching.",
    { job_id: { type: "string" }, query_id: { type: "string" } },
    ["job_id"],
  ),
  tool(
    "research_query",
    "Run one bounded search for an existing project research job. Fixed job/project cost and request caps apply before dispatch. Duplicate queries reuse cache; uncertain calls never retry automatically. No raw pages or paid add-ons.",
    { job_id: { type: "string" }, query: { type: "string" } },
    ["job_id", "query"],
  ),
  tool(
    "save_research_report",
    "Save a private Markdown research report with source URLs, retrieved dates and uncertainty. Requires the current report revision; never publishes externally.",
    {
      job_id: { type: "string" },
      expected_revision: { type: "integer" },
      report: { type: "string" },
    },
    ["job_id", "expected_revision", "report"],
  ),
];
export function compactResearch(data: any, queryId?: string) {
  const { job, queries } = data;
  const base = {
    job_id: job.id,
    title: job.title,
    revision: job.revision,
    report_characters: job.report.length,
    cost_limit: job.cost_limit,
    cost_used: job.cost_used,
    request_limit: job.request_limit,
    requests_used: job.requests_used,
    untrusted_source: true,
  };
  if (!queryId)
    return {
      ...base,
      queries: queries.map((q: any) => ({
        query_id: q.id,
        query: q.query.slice(0, 160),
        status: q.status,
        source_count: q.results.length,
        retrieved_at: q.finished_at,
      })),
      note: "Read one query_id for source excerpts. The full report and source text remain in the project UI/export.",
    };
  const q = queries.find((q: any) => q.id === queryId);
  if (!q) throw new Error("Source query is not part of this research job");
  return {
    ...base,
    query_id: q.id,
    status: q.status,
    retrieved_at: q.finished_at,
    sources: q.results
      .slice(0, 5)
      .map((s: any) => ({ ...s, excerpt: s.excerpt.slice(0, 1200) })),
  };
}
