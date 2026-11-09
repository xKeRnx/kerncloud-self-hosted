"use client";
import { useLanguage } from "./language";
import { useState } from "react";
import { api } from "./api-client";
type Props = {
  environment: {
    id: string;
    template_id: string;
    agent_permissions: string[];
    agent_ids: string[];
    controller_seen: string | null;
  };
  agents: { id: string; name: string }[];
  onChanged: () => Promise<unknown>;
};
export function EnvironmentAgentAccess({
  environment: e,
  agents,
  onChanged,
}: Props) {
  const { ui, localeTag } = useLanguage();

  const [all, setAll] = useState(e.agent_ids.length === 0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false);
  const ready =
    e.controller_seen && Date.now() - Date.parse(e.controller_seen) < 20000;
  return (
    <details className="environment-agent-access">
      <summary>
        {ui("Agenten-Zugriff ·")}{" "}
        {e.agent_permissions.length ? ui("freigegeben") : ui("gesperrt")}
      </summary>
      <p className="form-note">
        {ready
          ? ui("Agentenwerkzeuge bereit.")
          : ui(
              "Werkzeuge noch nicht bereit. Umgebung starten; ältere Images benötigen nach Sicherung der Dateien ein Neuaufsetzen.",
            )}
      </p>
      <p>
        {ui(
          "Freigegebene Agenten können in dieser Umgebung arbeiten. Terminalzugriff erlaubt auch Dateiänderungen und Netzwerkaufrufe. Der Browser verwendet die dort geöffneten Sitzungen.",
        )}
      </p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setError("");
          setSaved(false);
          const f = new FormData(event.currentTarget);
          const ids = all ? [] : f.getAll("agents");
          if (!all && !ids.length) {
            setError(
              ui(
                "Mindestens einen Agenten auswählen oder alle Agenten freigeben.",
              ),
            );
            return;
          }
          setBusy(true);
          try {
            await api("environments/agents", {
              id: e.id,
              permissions: f.getAll("permissions"),
              agentIds: ids,
            });
            await onChanged();
            setSaved(true);
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="check-list">
          {[
            ["files", ui("Projektdateien lesen und bearbeiten")],
            ["exec", ui("Terminal: Befehle, Git und Tests")],
            ...(e.template_id === "browser"
              ? [["browser", ui("Sichtbaren Browser bedienen")]]
              : []),
          ].map(([value, label]) => (
            <label className="checkbox" key={value}>
              <input
                name="permissions"
                type="checkbox"
                value={value}
                defaultChecked={e.agent_permissions.includes(value)}
              />
              {label}
            </label>
          ))}
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={all}
            onChange={(event) => setAll(event.target.checked)}
          />
          {ui("Alle Agenten dieses Workspaces")}
        </label>
        {!all && (
          <div className="check-list">
            {agents.map((a) => (
              <label className="checkbox" key={a.id}>
                <input
                  name="agents"
                  type="checkbox"
                  value={a.id}
                  defaultChecked={e.agent_ids.includes(a.id)}
                />
                {a.name}
              </label>
            ))}
          </div>
        )}
        {error && (
          <p role="alert" className="error-box">
            {error}
          </p>
        )}
        {saved && (
          <p role="status">
            {ui(
              "Freigabe gespeichert. Ohne aktivierte Rechte bleibt der Agenten-Zugriff gesperrt.",
            )}
          </p>
        )}
        <button className="secondary" disabled={busy}>
          {ui("Agenten-Freigabe speichern")}
        </button>
      </form>
    </details>
  );
}
