import Link from "next/link";
import { ensureDb } from "@/src/server/db";
import { setting, legalKeys, publicSite } from "@/src/server/business";
import { notFound } from "next/navigation";
import { renderLegalHtml } from "@/src/server/legal-html";
import { requestLanguage } from "@/src/server/request-language";
import { legalTitles } from "@/src/core/languages";
import { PublicHeader } from "@/components/public-header";
import { resolvedLegalHtml } from "@/src/server/company";
export const dynamic = "force-dynamic";
export default async function LegalPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  await ensureDb();
  const { key } = await params;
  if (!(legalKeys as readonly string[]).includes(key)) notFound();
  const locale = await requestLanguage();
  const [page, site] = await Promise.all([
    setting(locale === "de" ? `legal:${key}` : `legal:en:${key}`),
    publicSite(),
  ]);
  const fallback =
    locale === "en" && !page?.published ? await setting(`legal:${key}`) : null;
  return (
    <>
      <PublicHeader brand={site.brand} pages={site.customPages} />
      <main className="legal-page">
        <Link href="/">
          {locale === "en" ? "← Back to KeRnCloud" : "← Zurück zu KeRnCloud"}
        </Link>
        <h1>
          {page?.published && page.title
            ? page.title
            : legalTitles[locale][key]}
        </h1>
        {page?.published ? (
          <>
            <small>
              Version {page.version} ·{" "}
              {new Date(page.updated_at).toLocaleDateString(
                locale === "en" ? "en-GB" : "de-DE",
              )}
            </small>
            <div
              className="legal-copy legal-richtext"
              dangerouslySetInnerHTML={{
                __html: await resolvedLegalHtml(page),
              }}
            />
          </>
        ) : (
          <div className="legal-unpublished">
            <p>
              {locale === "en"
                ? "The operator has not published this text in English yet. This application is currently in a local test phase."
                : "Dieser Text wurde vom Betreiber noch nicht bereitgestellt. Die Anwendung befindet sich in einer lokalen Testphase."}
            </p>
            {fallback?.published && (
              <Link href={`/legal/${key}?lang=de`}>
                Read the published German version
              </Link>
            )}
          </div>
        )}
      </main>
    </>
  );
}
