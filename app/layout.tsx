import "./agent-inspector.css";
import "./environment-overview.css";
import "./project-manager.css";
import { isSelfHosted } from "@/src/server/self-hosted";
import type { Metadata } from "next";
import "./globals.css";
import "./organisation.css";
import "./timeline.css";
import "./self-hosted.css";
import "./decisions.css";
import "./usage-experience.css";
import "./customer-management.css";
import { SupportNotice } from "@/components/support-notice";
import "./extensions.css";
import "./memory.css";
import "./public.css";
import "./admin-content.css";
import "./security-infrastructure.css";
import "./workspace-rebuild.css";
import "./bridge.css";
import "./workspace-horizon.css";
import SiteFooter from "@/components/site-footer";
import { LanguageProvider } from "@/components/language";
import { languagesConfig } from "@/src/server/content";
import { requestLanguage } from "@/src/server/request-language";
import { ensureDb } from "@/src/server/db";
export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  await ensureDb();
  return {
    title: "KeRnCloud · Agent Workspace",
    description:
      (await requestLanguage()) === "en"
        ? "Your locally hosted SaaS platform for autonomous agent teams."
        : "Deine lokale SaaS-Plattform für autonome Agententeams.",
  };
}
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  await ensureDb();
  const [locale, languages] = await Promise.all([
    requestLanguage(),
    languagesConfig(),
  ]);
  return (
    <html lang={locale}>
      <body data-registration={isSelfHosted() && process.env.ALLOW_REGISTRATION !== "true" ? "closed" : "open"}>
        <LanguageProvider locale={locale} config={languages}>
          <SupportNotice />
          {children}
          <SiteFooter selfHosted={isSelfHosted()} />
        </LanguageProvider>
      </body>
    </html>
  );
}
