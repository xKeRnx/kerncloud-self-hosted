"use client";
import { useEffect, useState } from "react";
import type { PageLink } from "@/src/core/pages";
import { useLanguage } from "./language";
export function CustomWorkspaceLinks() {
  const { ui, localeTag } = useLanguage();

  const [pages, setPages] = useState<PageLink[]>([]);
  const { locale } = useLanguage();
  useEffect(() => {
    let active = true;
    const load = () =>
      void fetch("/api/site", { cache: "no-store" })
        .then((r) => r.json())
        .then((data) => {
          if (active) setPages(data.customPages ?? []);
        })
        .catch(() => {});
    load();
    window.addEventListener("kc:site-updated", load);
    return () => {
      active = false;
      window.removeEventListener("kc:site-updated", load);
    };
  }, []);
  const links = pages.filter(
    (p) => p.locale === locale && p.placements.includes("workspace"),
  );
  if (!links.length) return null;
  return (
    <>
      <div className="nav-label">{ui("WEITERE SEITEN")}</div>
      <nav>
        {links.map((p) => (
          <a
            className="nav-item"
            key={p.slug}
            href={`/p/${p.slug}?lang=${locale}`}
          >
            <span aria-hidden="true">↗</span>
            <span>{p.title}</span>
          </a>
        ))}
      </nav>
    </>
  );
}
