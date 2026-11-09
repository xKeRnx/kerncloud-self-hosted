import { z } from "zod";
import { themeSchema, type ThemePreference } from "../core/appearance.ts";
import { pool } from "./db.ts";
export async function preferredAppearance(
  userId: string,
): Promise<{ theme: ThemePreference }> {
  const row = (
    await pool.query(
      "SELECT theme FROM user_appearance_preferences WHERE user_id=$1",
      [userId],
    )
  ).rows[0];
  return { theme: themeSchema.parse(row?.theme ?? "light") };
}
export async function saveAppearance(userId: string, body: unknown) {
  const { theme } = z.object({ theme: themeSchema }).strict().parse(body);
  await pool.query(
    "INSERT INTO user_appearance_preferences(user_id,theme) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET theme=excluded.theme,updated_at=now()",
    [userId, theme],
  );
  return { theme };
}
