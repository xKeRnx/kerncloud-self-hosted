import { z } from "zod";
export const themeSchema = z.enum(["light", "dark", "system"]);
export type ThemePreference = z.infer<typeof themeSchema>;
export function resolveTheme(
  theme: ThemePreference,
  systemDark: boolean,
): "light" | "dark" {
  return theme === "system" ? (systemDark ? "dark" : "light") : theme;
}
