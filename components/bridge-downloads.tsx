"use client";
import { useEffect, useState } from "react";
import { useLanguage } from "./language";
export function BridgeDownloads() {
  const { t, localeTag } = useLanguage();
  const size = (bytes: number) => {
    const unit = bytes < 1000 ? "B" : bytes < 1000000 ? "KB" : "MB";
    const divisor = unit === "B" ? 1 : unit === "KB" ? 1000 : 1000000;
    return (
      new Intl.NumberFormat(localeTag, { maximumFractionDigits: 1 }).format(
        bytes / divisor,
      ) +
      " " +
      unit
    );
  };
  const [data, setData] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const a = new AbortController();
    fetch("/api/public/bridge/manifest", { signal: a.signal, cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw Error("Downloads werden vorbereitet.");
        return r.json();
      })
      .then(setData)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => a.abort();
  }, []);
  const installerCatalog = data?.files?.some((f: any) => f.kind === "installer" && f.version === data.version);
  const preferred = data?.files?.filter((f: any) => installerCatalog ? f.primary && f.version === data.version : /\.(zip|pdf)$/.test(f.name)) ?? [];
  const rank = (f: any) => f.kind === "guide" ? 10 : f.platform === "win32" ? 0 : f.platform === "linux" ? 1 : f.arch === "arm64" ? 2 : 3;
  const portable = data?.files?.filter((f: any) => f.kind === "portable" && !f.primary && f.version === data.version) ?? [];
  const link = (f: any) => "/api/public/bridge/download/" + encodeURIComponent(f.name) + "?v=" + f.sha256.slice(0, 16);
  return (
    <div className="bridge-downloads">
      <p>
        Bridge {data?.version ?? ""}
      </p>
      {error && <p role="status">{error}</p>}
      <div className="bridge-download-grid">
        {preferred
          .sort((a: any, b: any) => rank(a) - rank(b))
          .map((f: any) => (
            <a
              className="bridge-download"
              key={f.name}
              href={link(f)}
            >
              <strong>{f.label}</strong>
              <span>
                {f.arch ? f.arch + " · " : ""}{(f.format ?? (f.arch ? "zip" : "pdf")).toUpperCase()} · {size(f.bytes)}
              </span>
              {f.kind !== "guide" && <span>{f.format === "exe" ? t("Setup-Assistent mit Auswahl für Autostart und Verknüpfungen", "Setup wizard with startup and shortcut choices") : f.format === "deb" ? t("Über das Softwarecenter installieren", "Install through your software center") : f.platform === "darwin" ? t("App nach Programme verschieben", "Move the app to Applications") : ""}</span>}
              <small>SHA-256: {f.sha256}</small>
            </a>
          ))}
      </div>
      {portable.length > 0 && <details className="bridge-portable-downloads"><summary>{t("Portable ZIPs ohne Installation", "Portable ZIPs without installation")}</summary><ul>{portable.map((f: any) => <li key={f.name}><a href={link(f)}>{f.label} {f.arch} · ZIP · {size(f.bytes)}</a></li>)}</ul></details>}
      <p className="form-note">
        {t(
          "Windows: Setup starten und Installationsort, Startmenü, Desktop und optionalen Autostart auswählen. Linux Debian/Ubuntu: .deb im Softwarecenter installieren; Autostart bei Bedarf in der App einschalten. macOS: ZIP entpacken und App nach Programme verschieben.",
          "Windows: run Setup and choose location, Start menu, desktop and optional startup. Linux Debian/Ubuntu: install the .deb through your software center; enable startup in the app if wanted. macOS: extract ZIP and move the app to Applications.",
        )}
      </p>
    </div>
  );
}
