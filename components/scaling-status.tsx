"use client";
import { useEffect, useState } from "react";
import { api } from "./api-client";
import { useLanguage } from "./language";
export function ScalingStatus() {
  const { t } = useLanguage(),
    [data, setData] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    const load = () =>
      void api("admin/scaling")
        .then((d) => {
          if (alive) {
            setData(d);
            setError("");
          }
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    load();
    const timer = setInterval(load, 30000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  return (
    <section className="panel settings-panel">
      <h2>
        {t("Skalierung & Hintergrunddienste", "Scaling & background services")}
      </h2>
      <p>
        {t(
          "Messwerte der antwortenden App-Instanz und gemeinsam registrierte Dienste. Keine Aussage über eine garantierte Nutzerkapazität.",
          "Metrics of the responding app instance and registered shared services. No guaranteed user capacity is implied.",
        )}
      </p>
      {error && <p role="alert">{error}</p>}
      {data && (
        <>
          <div className="form-note" style={{ display: "block" }}>
            <p>
              {t("Datenbankverbindungen: ", "Database connections: ")}
              {data.instance.pool.total}/{data.instance.pool.max} ·{" "}
              {t("Wartend: ", "Waiting: ")}
              {data.instance.pool.waiting} ·{" "}
              {t("Ereignis-Abonnenten: ", "Event subscribers: ")}
              {data.instance.events.subscribers}
            </p>
            <p>
              {t("Ausgelagerte Binärdateien: ", "External binary files: ")}
              {data.objects.files - data.objects.legacy} · {data.objects.bytes}{" "}
              Bytes · {t("Noch in Datenbank: ", "Still in database: ")}
              {data.objects.legacy}
            </p>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Gateway</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.gateways.map((g: any) => (
                  <tr key={g.id}>
                    <td>{g.id}</td>
                    <td>
                      {g.healthy
                        ? t("Erreichbar", "Reachable")
                        : t("Abgelaufen", "Expired")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table>
              <thead>
                <tr>
                  <th>{t("Hintergrundauftrag", "Background job")}</th>
                  <th>{t("Nächster Lauf", "Next run")}</th>
                </tr>
              </thead>
              <tbody>
                {data.scheduler.map((j: any) => (
                  <tr key={j.name}>
                    <td>{j.name}</td>
                    <td>
                      {j.running
                        ? t("Läuft", "Running")
                        : new Date(j.next_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
