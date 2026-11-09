export const supportedLocales = ["en", "de"] as const;
export type Locale = (typeof supportedLocales)[number];
export type Languages = { enabled: Locale[]; defaultLocale: Locale; browserDetection?: boolean };
export const languageNames: Record<Locale, string> = { en: "English", de: "Deutsch" };
export function normalizeLanguages(value?: Partial<Languages> | null): Languages {
 const enabled = supportedLocales.filter(l => value?.enabled?.includes(l));
 if (!enabled.length) enabled.push(...supportedLocales);
 return { enabled, browserDetection: false, defaultLocale: enabled.includes(value?.defaultLocale as Locale) ? value!.defaultLocale! : enabled.includes("en") ? "en" : enabled[0] };
}
export function resolveLocale(candidate: string | null | undefined, config: Languages): Locale {
 return config.enabled.includes(candidate as Locale) ? candidate as Locale : config.defaultLocale;
}
export const legalTitles: Record<Locale, Record<string,string>> = {
 de: { impressum:"Impressum", datenschutz:"Datenschutz", agb:"AGB", cookies:"Cookies", widerruf:"Widerruf" },
 en: { impressum:"Legal notice", datenschutz:"Privacy policy", agb:"Terms", cookies:"Cookies", widerruf:"Withdrawal" }
};
