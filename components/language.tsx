"use client";
import { createContext, useContext } from "react";
import {
  languageNames,
  type Languages,
  type Locale,
} from "@/src/core/languages";
import { uiMessage } from "@/src/core/ui-messages";
const LanguageContext = createContext<{ locale: Locale; config: Languages }>({
  locale: "en",
  config: { enabled: ["en", "de"], defaultLocale: "en" },
});
export function LanguageProvider({
  locale,
  config,
  children,
}: {
  locale: Locale;
  config: Languages;
  children: React.ReactNode;
}) {
  return (
    <LanguageContext.Provider value={{ locale, config }}>
      {children}
    </LanguageContext.Provider>
  );
}
export function useLanguage() {
  const value = useContext(LanguageContext),
    localeTag = value.locale === "en" ? "en-GB" : "de-DE";
  return {
    ...value,
    localeTag,
    t: (de: string, en: string) => (value.locale === "en" ? en : de),
    ui: (source: string, values?: unknown[]) =>
      uiMessage(value.locale, source, values),
    number: (v: number) => new Intl.NumberFormat(localeTag).format(v),
    money: (v: number) =>
      new Intl.NumberFormat(localeTag, {
        style: "currency",
        currency: "EUR",
      }).format(v / 100),
    minutes: (v: number) =>
      new Intl.NumberFormat(localeTag, { maximumFractionDigits: 2 }).format(
        v / 60,
      ),
    bytes: (v?: number | null) =>
      v == null
        ? "–"
        : new Intl.NumberFormat(localeTag).format(Math.round(v / 1048576)) +
          " MiB",
    date: (v: string | null) =>
      v
        ? new Date(v).toLocaleString(localeTag, {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "—",
  };
}
export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, config, t } = useLanguage();
  if (config.enabled.length < 2) return null;
  return (
    <label className="language-switcher">
      <span className="sr-only">{t("Sprache", "Language")}</span>
      <select
        aria-label={t("Sprache", "Language")}
        value={locale}
        onChange={(event) => {
          const url = new URL(window.location.href);
          url.searchParams.set("lang", event.target.value);
          window.location.assign(url);
        }}
      >
        {config.enabled.map((lang) => (
          <option key={lang} value={lang}>
            {compact ? lang.toUpperCase() : languageNames[lang]}
          </option>
        ))}
      </select>
    </label>
  );
}
