import { supportedLocales, type Locale, type Languages } from "./languages";
export function negotiateLocale(
  {
    explicit,
    cookie,
    acceptLanguage,
  }: {
    explicit?: string | null;
    cookie?: string | null;
    acceptLanguage?: string | null;
  },
  config: Languages,
): Locale {
  // Deliberate selection wins over the browser, including a disabled language's fallback.
  if (explicit && supportedLocales.includes(explicit as Locale))
    return config.enabled.includes(explicit as Locale)
      ? (explicit as Locale)
      : config.defaultLocale;
  if (cookie && supportedLocales.includes(cookie as Locale))
    return config.enabled.includes(cookie as Locale)
      ? (cookie as Locale)
      : config.defaultLocale;
  if (config.browserDetection !== true) return config.defaultLocale;
  const languages = (acceptLanguage ?? "")
    .slice(0, 2000)
    .split(",")
    .slice(0, 30)
    .map((entry, index) => {
      const [tag, ...parameters] = entry.trim().toLowerCase().split(";");
      const quality = parameters.find((p) => p.trim().startsWith("q="));
      const q = quality ? Number(quality.trim().slice(2)) : 1;
      return { locale: tag.split("-")[0] as Locale, q, index };
    })
    .filter((x) => Number.isFinite(x.q) && x.q > 0 && x.q <= 1)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  return (
    languages.find((x) => config.enabled.includes(x.locale))?.locale ??
    config.defaultLocale
  );
}
