"use client";
import Link from "next/link";
import { KernCloudLogo } from "./kerncloud-logo";
import { LanguageSwitcher, useLanguage } from "./language";
import type { PageLink } from "@/src/core/pages";
export function PublicHeader({
  brand,
  pages,
}: {
  brand: string;
  pages: PageLink[];
}) {
  const { locale, t } = useLanguage();
  return (
    <header className="content-public-header">
      <Link className="landing-brand" href="/">
        <KernCloudLogo size={30} />
        <span>{brand}</span>
      </Link>
      <nav aria-label={t("Website-Navigation", "Website navigation")}>
        <Link href="/#pricing">{t("Pläne", "Plans")}</Link>
        {pages
          .filter((p) => p.locale === locale && p.placements.includes("header"))
          .map((p) => (
            <Link href={`/p/${p.slug}?lang=${locale}`} key={p.slug}>
              {p.title}
            </Link>
          ))}
        <Link href="/login">{t("Anmelden", "Sign in")}</Link>
        <LanguageSwitcher />
      </nav>
    </header>
  );
}
