"use client";
import { LanguageSwitcher, useLanguage } from "./language";
import { legalTitles } from "@/src/core/languages";
import type { PageLink } from "@/src/core/pages";
import { useEffect, useState } from "react";
export default function SiteFooter({selfHosted=false}:{selfHosted?:boolean}) {
  const { locale, t } = useLanguage();
  const [site, setSite] = useState<{
      analyticsEnabled: boolean;
      consentVersion: string;
      brand: string;
      customPages: PageLink[];
      pages: {
        key: string;
        version: number;
      }[];
    } | null>(null),
    [consent, setConsent] = useState<string | null>(null),
    [show, setShow] = useState(false);
  useEffect(() => {
    let active = true;
    const load = () =>
      void fetch("/api/site", { cache: "no-store" })
        .then((r) => r.json())
        .then((value) => {
          if (!active) return;
          const version = value.consentVersion ?? "0:0";
          setConsent(
            localStorage.getItem("kc_analytics_version") === version
              ? localStorage.getItem("kc_analytics_consent")
              : null,
          );
          setSite(value);
        })
        .catch(() => {});
    load();
    window.addEventListener("kc:site-updated", load);
    return () => {
      active = false;
      window.removeEventListener("kc:site-updated", load);
    };
  }, []);
  useEffect(() => {
    if (!site?.analyticsEnabled || consent !== "yes") return;
    const event = (kind: string, target = "", page = location.pathname) =>
      void fetch("/api/analytics/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          target,
          page,
          referrer: document.referrer,
          consent: true,
        }),
        keepalive: true,
      }).catch(() => {});
    event("page");
    const click = (e: MouseEvent) => {
      const el = (e.target as Element).closest?.("[data-analytics]");
      if (el) event("click", el.getAttribute("data-analytics") ?? "");
    };
    const view = (e: Event) =>
      event("page", "", `/workspace/${(e as CustomEvent<string>).detail}`);
    document.addEventListener("kc:view", view);
    document.addEventListener("click", click);
    return () => {
      document.removeEventListener("click", click);
      document.removeEventListener("kc:view", view);
    };
  }, [site?.analyticsEnabled, consent]);
  const choose = (value: string) => {
    localStorage.setItem("kc_analytics_consent", value);
    localStorage.setItem("kc_analytics_version", site?.consentVersion ?? "0:0");
    setConsent(value);
    setShow(false);
  };
  return (
    <>
      <footer className="site-footer">
        <div className="footer-main">
          <span className="footer-brand">© {site?.brand ?? "KeRnCloud"}</span>
          <nav
            className="footer-links"
            aria-label={t("Rechtliche Informationen", "Legal information")}
          >
            {Object.entries(legalTitles[locale]).map(([k, title]) => (
              <a key={k} href={`/legal/${k}?lang=${locale}`}>
                {title}
              </a>
            ))}
            {site?.customPages
              ?.filter(
                (p) => p.locale === locale && p.placements.includes("footer"),
              )
              .map((p) => (
                <a key={p.slug} href={`/p/${p.slug}?lang=${locale}`}>
                  {p.title}
                </a>
              ))}
            {!selfHosted && <><a className="contract-action" href="/contracts/cancel">{t("Verträge hier kündigen", "Cancel contracts here")}</a>
            <a className="contract-action contract-withdraw" href="/contracts/withdraw">{t("Vertrag widerrufen", "Withdraw from contract")}</a></>}
          </nav>
          <div className="footer-preferences">
            <LanguageSwitcher />
            <button onClick={() => setShow(true)}>
              {t("Cookie-Einstellungen", "Cookie settings")}
            </button>
          </div>
        </div>

      </footer>
      {(show || (site?.analyticsEnabled && consent === null)) && (
        <div
          className="consent-panel"
          role="dialog"
          aria-label={t("Cookie-Einstellungen", "Cookie settings")}
        >
          <h3>
            {t("Deine Datenschutz-Einstellungen", "Your privacy preferences")}
          </h3>
          <p>
            {t(
              "Die Anmeldung verwendet ein notwendiges Sitzungscookie. Ein optionales Pr\u00E4ferenz-Cookie merkt sich deine gew\u00E4hlte Sprache. Optionale Nutzungsanalyse erfasst freigegebene Seitenaufrufe und Klicks, bei angemeldeten Nutzern auch die Konto-ID. Keine IP-Adressen, Werbetracker oder vollst\u00E4ndigen Referrer-URLs werden daf\u00FCr gespeichert.",
              "Sign-in uses a necessary session cookie. An optional preference cookie remembers your chosen language. With your consent, usage analytics records page views and clicks, including the account ID for signed-in users. No IP addresses, advertising trackers or full referrer URLs are stored for this purpose.",
            )}
          </p>
          <p>
            {t(
              "Du kannst die Analyse jederzeit hier ablehnen.",
              "You can decline analytics here at any time.",
            )}{" "}
            <a href={`/legal/datenschutz?lang=${locale}`}>
              {t("Datenschutz lesen", "Read privacy policy")}
            </a>
          </p>
          <div className="button-row">
            <button className="secondary" onClick={() => choose("no")}>
              {t("Nur notwendige", "Necessary only")}
            </button>
            {site?.analyticsEnabled && (
              <button className="primary" onClick={() => choose("yes")}>
                {t("Analyse erlauben", "Allow analytics")}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
