import { headers, cookies } from "next/headers";
import { languagesConfig } from "./content";
import { negotiateLocale } from "../core/language-negotiation";
export async function requestLanguage() {
  const [h, c, config] = await Promise.all([
    headers(),
    cookies(),
    languagesConfig(),
  ]);
  return negotiateLocale(
    {
      explicit: h.get("x-kc-language"),
      cookie: c.get("kc_locale")?.value,
      acceptLanguage: h.get("accept-language"),
    },
    config,
  );
}
