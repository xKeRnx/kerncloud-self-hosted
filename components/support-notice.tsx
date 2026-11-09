"use client";
import { useEffect, useState } from "react";
import { api, selectWorkspace } from "./api-client";
import { useLanguage } from "./language";
export function SupportNotice() {
  const { t } = useLanguage();
  const [data, setData] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const load = () =>
      void api<any>("support/status")
        .then((r) => setData(r.active ? r : null))
        .catch(() => {});
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    document.body.classList.toggle("kc-support-active", Boolean(data));
    return () => document.body.classList.remove("kc-support-active");
  }, [data]);
  if (!data) return null;
  return (
    <aside className="support-notice" role="status">
      <div>
        <strong>
          {t("Supportmodus", "Support mode")} · {data.name ?? data.email} ·{" "}
          {data.mode === "write"
            ? t("Workspace-Bearbeitung", "Workspace editing")
            : t("Nur ansehen", "Read only")}
          {data.expired ? " · " + t("Abgelaufen", "Expired") : ""}
        </strong>
        <small>
          {data.reason} · {t("Endet", "Ends")}{" "}
          {data.expires_at
            ? new Date(data.expires_at).toLocaleTimeString()
            : ""}
        </small>
        {error && <small>{error}</small>}
      </div>
      <button
        className="secondary"
        onClick={() =>
          void api("support/exit", {})
            .then(() => {
              selectWorkspace(undefined);
              window.location.assign("/admin/customers");
            })
            .catch((e) => setError(e.message))
        }
      >
        {t("Zurück zum Admin", "Back to admin")}
      </button>
    </aside>
  );
}
