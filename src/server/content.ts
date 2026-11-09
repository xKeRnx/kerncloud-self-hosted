import { z } from "zod";
import { randomUUID } from "node:crypto";
import { pool, transaction, audit } from "./db.ts";
import { HttpError } from "./auth.ts";
import {
  normalizeLanguages,
  type Languages,
  type Locale,
} from "../core/languages.ts";
import {
  safePageHref,
  type ContentPage,
  type PageLink,
} from "../core/pages.ts";
import { sanitizeLegalHtml, legalPlainText } from "./legal-html.ts";

export async function languagesConfig(): Promise<Languages> {
  return normalizeLanguages(
    (await pool.query("SELECT value FROM settings WHERE id='languages'"))
      .rows[0]?.value,
  );
}
export async function contentPages(): Promise<ContentPage[]> {
  return (
    await pool.query(
      "SELECT value FROM settings WHERE id LIKE 'content-page:%' ORDER BY (value->>'sortOrder')::int, value->>'slug'",
    )
  ).rows.map((r) => r.value);
}
export async function publicPageLinks(): Promise<PageLink[]> {
  const [pages, languages] = await Promise.all([
    contentPages(),
    languagesConfig(),
  ]);
  return pages.flatMap((p) =>
    p.archived
      ? []
      : languages.enabled.flatMap((locale) =>
          p.translations[locale]?.published
            ? [
                {
                  slug: p.slug,
                  title: p.translations[locale].title,
                  locale,
                  placements: p.placements,
                  sortOrder: p.sortOrder,
                },
              ]
            : [],
        ),
  );
}
export async function publishedPage(slug: string, locale: Locale) {
  const page = (await contentPages()).find(
    (p) => p.slug === slug && !p.archived,
  );
  const translation = page?.translations[locale];
  if (
    !page ||
    !translation?.published ||
    !(await languagesConfig()).enabled.includes(locale)
  )
    return null;
  return {
    slug,
    version: page.version,
    ...translation,
    blocks: translation.blocks.map((b) => ({
      ...b,
      content: sanitizeLegalHtml(b.content),
      href: safePageHref(b.href) ? b.href : "",
    })),
  };
}
const blockSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(["text", "callout", "cta"]),
  content: z.string().max(100000),
  label: z.string().trim().max(100),
  href: z.string().trim().max(2000),
});
const translationSchema = z.object({
  title: z.string().trim().max(150),
  description: z.string().trim().max(300),
  published: z.boolean(),
  blocks: z.array(blockSchema).max(30),
});
export async function adminContent(
  actor: string,
  path: string,
  body: unknown,
  method: string,
) {
  if (path === "languages" && method === "GET") return languagesConfig();
  if (path === "languages" && method === "POST") {
    const data = z
      .object({
        enabled: z
          .array(z.enum(["de", "en"]))
          .min(1)
          .max(2),
        defaultLocale: z.enum(["de", "en"]),
      })
      .parse(body);
    if (!data.enabled.includes(data.defaultLocale))
      throw new HttpError(400, "Die Standardsprache muss aktiviert sein.");
    const config = normalizeLanguages(data);
    await transaction(async (c) => {
      await c.query(
        "INSERT INTO settings(id,value) VALUES('languages',$1) ON CONFLICT(id) DO UPDATE SET value=EXCLUDED.value",
        [JSON.stringify(config)],
      );
      await audit(c, actor, "admin.languages.update", "languages");
    });
    return { ok: true };
  }
  if (path === "pages" && method === "GET")
    return { pages: await contentPages(), languages: await languagesConfig() };
  if (path === "pages" && method === "POST") {
    const b = z
      .object({
        id: z.string().uuid().optional(),
        version: z.number().int().min(0).default(0),
        slug: z
          .string()
          .min(1)
          .max(80)
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        placements: z.array(z.enum(["header", "footer", "workspace"])).max(3),
        sortOrder: z.number().int().min(0).max(9999),
        archived: z.boolean().default(false),
        translations: z.object({
          de: translationSchema,
          en: translationSchema,
        }),
      })
      .parse(body);
    for (const translation of Object.values(b.translations)) {
      const ids = translation.blocks.map((block) => block.id);
      if (new Set(ids).size !== ids.length)
        throw new HttpError(400, "Abschnitt-IDs müssen eindeutig sein.");
      for (const block of translation.blocks) {
        block.content = sanitizeLegalHtml(block.content);
        if (block.type === "cta" && (!safePageHref(block.href) || !block.label))
          throw new HttpError(
            400,
            "Link-Abschnitte benötigen einen Titel und einen gültigen lokalen oder HTTP(S)-Link.",
          );
      }
      if (
        translation.published &&
        (!translation.title ||
          !translation.blocks.some(
            (block) => legalPlainText(block.content, "html").trim().length > 0,
          ))
      )
        throw new HttpError(
          400,
          "Veröffentlichte Sprachversionen brauchen einen Titel und sichtbaren Inhalt.",
        );
      if (
        translation.blocks.reduce((n, block) => n + block.content.length, 0) >
        200000
      )
        throw new HttpError(400, "Maximal 200.000 Zeichen pro Sprachversion.");
    }
    const id = b.id ?? randomUUID();
    await transaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(6820192028)");
      const rows = (
        await c.query(
          "SELECT value FROM settings WHERE id LIKE 'content-page:%'",
        )
      ).rows.map((r) => r.value as ContentPage);
      const old = rows.find((p) => p.id === id);
      if (b.id && !old) throw new HttpError(404, "Seite fehlt.");
      if (old && old.version !== b.version)
        throw new HttpError(
          409,
          "Die Seite wurde inzwischen geändert. Bitte neu laden.",
        );
      if (rows.some((p) => p.slug === b.slug && p.id !== id))
        throw new HttpError(409, "Diese Seitenadresse ist bereits vergeben.");
      if (!old && rows.length >= 100)
        throw new HttpError(409, "Maximal 100 eigene Seiten.");
      if (old)
        await c.query(
          "INSERT INTO settings(id,value) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [`content-history:${id}:${old.version}`, JSON.stringify(old)],
        );
      await c.query(
        "INSERT INTO settings(id,value) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET value=EXCLUDED.value",
        [
          `content-page:${id}`,
          JSON.stringify({
            ...b,
            id,
            version: (old?.version ?? 0) + 1,
            updated_at: new Date().toISOString(),
          }),
        ],
      );
      await audit(c, actor, "admin.pages.update", id);
    });
    return { ok: true, id };
  }
  return null;
}
