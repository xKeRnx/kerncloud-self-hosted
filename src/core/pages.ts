import type { Locale } from "./languages.ts";
export type PageBlock = {
  id: string;
  type: "text" | "callout" | "cta";
  content: string;
  label: string;
  href: string;
};
export type PageTranslation = {
  title: string;
  description: string;
  published: boolean;
  blocks: PageBlock[];
};
export type ContentPage = {
  id: string;
  slug: string;
  placements: ("header" | "footer" | "workspace")[];
  sortOrder: number;
  archived: boolean;
  version: number;
  translations: Record<Locale, PageTranslation>;
};
export type PageLink = {
  slug: string;
  title: string;
  locale: Locale;
  placements: ContentPage["placements"];
  sortOrder: number;
};
export function safePageHref(href: string) {
  if (!href || /[\s\\\u0000-\u001f\u007f]/.test(href)) return false;
  if (/^\/(?!\/)/.test(href)) return true;
  try {
    const url = new URL(href);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
