"use client";
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { Sun, Moon, Monitor, Check } from "lucide-react";
import type { ThemePreference } from "@/src/core/appearance";
import { useLanguage } from "./language";
import { api } from "./api-client";
type Appearance = { theme: ThemePreference; canSave: boolean };
const AppearanceContext = createContext<{
  theme: ThemePreference;
  canSave: boolean;
  busy: boolean;
  error: string;
  saved: boolean;
  choose: (theme: ThemePreference) => Promise<void>;
  sync: (appearance: Appearance) => void;
}>({
  theme: "light",
  canSave: false,
  busy: false,
  error: "",
  saved: false,
  choose: async () => {},
  sync: () => {},
});
export function WorkspaceAppearance({
  initialTheme,
  initialCanSave,
  children,
}: {
  initialTheme: ThemePreference;
  initialCanSave: boolean;
  children: React.ReactNode;
}) {
  const [theme, setTheme] = useState(initialTheme),
    [canSave, setCanSave] = useState(initialCanSave),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  const pending = useRef(false);
  const sync = useCallback((appearance: Appearance) => {
    if (!pending.current) {
      setTheme(appearance.theme);
      setCanSave(appearance.canSave);
    }
  }, []);
  const choose = async (next: ThemePreference) => {
    if (pending.current || !canSave || theme === next) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setSaved(false);
    const previous = theme;
    setTheme(next);
    try {
      await api("preferences/appearance", { theme: next }, "POST", {
        projectScope: false,
      });
      setSaved(true);
    } catch (e) {
      setTheme(previous);
      setError((e as Error).message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <AppearanceContext.Provider
      value={{ theme, canSave, busy, error, saved, choose, sync }}
    >
      <div className="workspace-horizon" data-theme={theme}>
        {children}
      </div>
    </AppearanceContext.Provider>
  );
}
export const useWorkspaceAppearance = () => useContext(AppearanceContext);
const options = [
  { value: "light", de: "Hell", en: "Light", Icon: Sun },
  { value: "dark", de: "Dunkel", en: "Dark", Icon: Moon },
  { value: "system", de: "System", en: "System", Icon: Monitor },
] as const;
export function AppearanceChoices({ menu = false }: { menu?: boolean }) {
  const { theme, canSave, busy, error, saved, choose } =
      useWorkspaceAppearance(),
    { t } = useLanguage();
  return (
    <>
      {menu && (
        <div className="appearance-menu-label" role="presentation">
          {t("Darstellung", "Appearance")}
        </div>
      )}
      <div
        className={menu ? "appearance-menu-options" : "appearance-options"}
        role={menu ? "group" : undefined}
        aria-label={menu ? t("Darstellung", "Appearance") : undefined}
      >
        {options.map(({ value, de, en, Icon }) =>
          menu ? (
            <button
              key={value}
              type="button"
              role="menuitemradio"
              aria-checked={theme === value}
              aria-disabled={busy || !canSave}
              onClick={() => void choose(value)}
            >
              <Icon size={17} aria-hidden="true" />
              {t(de, en)}
              {theme === value && (
                <Check
                  size={16}
                  aria-hidden="true"
                  className="appearance-check"
                />
              )}
            </button>
          ) : (
            <label
              key={value}
              className={
                "appearance-option" + (theme === value ? " selected" : "")
              }
            >
              <input
                type="radio"
                name="appearance"
                value={value}
                checked={theme === value}
                disabled={busy || !canSave}
                onChange={() => void choose(value)}
              />
              <Icon size={21} aria-hidden="true" />
              <span>{t(de, en)}</span>
            </label>
          ),
        )}
      </div>
      <div
        className="appearance-feedback"
        role={error ? "alert" : "status"}
        aria-live="polite"
      >
        {error ||
          (!canSave
            ? t(
                "Im Supportmodus nicht änderbar.",
                "Cannot be changed in support mode.",
              )
            : busy
              ? t("Wird gespeichert …", "Saving …")
              : saved
                ? t("Im Benutzerkonto gespeichert.", "Saved to your account.")
                : menu
                  ? ""
                  : t(
                      "Gilt für alle Workspaces und Geräte. System folgt deiner Geräteeinstellung.",
                      "Applies across workspaces and devices. System follows your device setting.",
                    ))}
      </div>
    </>
  );
}
export function AppearanceSettings() {
  const { t } = useLanguage();
  return (
    <section className="panel appearance-settings">
      <fieldset>
        <legend>{t("Darstellung", "Appearance")}</legend>
        <p>
          {t(
            "Wähle, wie dein Workspace aussehen soll.",
            "Choose how your workspace looks.",
          )}
        </p>
        <AppearanceChoices />
      </fieldset>
    </section>
  );
}
