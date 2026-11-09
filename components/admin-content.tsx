"use client";
import { useLanguage } from "./language";
import { useEffect, useState } from "react";
import { api } from "./api-client";
import { LegalEditor } from "./legal-editor";
import {
  languageNames,
  type Languages,
  type Locale,
} from "@/src/core/languages";
import type { ContentPage, PageBlock, PageTranslation } from "@/src/core/pages";

export function AdminLanguages() {
  const { ui, localeTag } = useLanguage();

  const [data, setData] = useState<Languages | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    void api<Languages>("admin/languages")
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);
  if (!data)
    return (
      <p role={error ? "alert" : undefined}>
        {error || ui("Sprachen werden geladen …")}
      </p>
    );
  return (
    <section className="panel settings-panel">
      <h2>{ui("Website-Sprachen")}</h2>
      <p>
        {ui(
          "Englisch ist die Vorgabe für neue Besucher. Deutsch kann ausgewählt werden. Eine manuelle Auswahl bleibt über ein Präferenz-Cookie erhalten.",
        )}
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          setMessage("");
          try {
            await api("admin/languages", data);
            setMessage(
              ui(
                "Sprachen gespeichert. Öffentliche Seiten verwenden die neuen Vorgaben beim nächsten Aufruf.",
              ),
            );
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {(["en", "de"] as const).map((locale) => (
          <label className="check-row" key={locale}>
            <input
              type="checkbox"
              checked={data.enabled.includes(locale)}
              onChange={(e) =>
                setData({
                  ...data,
                  enabled: e.target.checked
                    ? [...data.enabled, locale]
                    : data.enabled.filter((l) => l !== locale),
                })
              }
            />
            {languageNames[locale]}
          </label>
        ))}
        <label className="field">
          <span>{ui("Standardsprache")}</span>
          <select
            value={data.defaultLocale}
            onChange={(e) =>
              setData({ ...data, defaultLocale: e.target.value as Locale })
            }
          >
            {(["en", "de"] as const).map((l) => (
              <option value={l} key={l} disabled={!data.enabled.includes(l)}>
                {languageNames[l]}
              </option>
            ))}
          </select>
        </label>
        <p className="form-note">
          {ui(
            "Website, Workspace und Administration unterstützen Englisch und Deutsch. Eigene Seiten, Rechtstexte und gespeicherte Inhalte behalten ihre Sprache. Das Aktivieren einer Sprache übersetzt keine eigenen Inhalte automatisch.",
          )}
        </p>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        {message && <p role="status">{message}</p>}
        <button
          className="primary"
          disabled={busy || !data.enabled.includes(data.defaultLocale)}
        >
          {busy ? ui("Speichert …") : ui("Sprachen speichern")}
        </button>
      </form>
    </section>
  );
}
const emptyTranslation = (): PageTranslation => ({
  title: "",
  description: "",
  published: false,
  blocks: [],
});
const newPage = (): ContentPage => ({
  id: "",
  slug: "",
  placements: ["footer"],
  sortOrder: 100,
  archived: false,
  version: 0,
  translations: { de: emptyTranslation(), en: emptyTranslation() },
});
export function AdminPages() {
  const { ui, localeTag, locale: currentLocale } = useLanguage();

  const [pages, setPages] = useState<ContentPage[]>([]),
    [draft, setDraft] = useState<ContentPage | null>(null),
    [locale, setLocale] = useState<Locale>(currentLocale),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const load = () =>
    api<{ pages: ContentPage[] }>("admin/pages").then((data) => {
      setPages(data.pages);
      return data.pages;
    });
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  function change(patch: Partial<ContentPage>) {
    setDraft((p) => (p ? { ...p, ...patch } : p));
    setDirty(true);
    setMessage("");
  }
  function translation(patch: Partial<PageTranslation>) {
    setDraft((p) =>
      p
        ? {
            ...p,
            translations: {
              ...p.translations,
              [locale]: { ...p.translations[locale], ...patch },
            },
          }
        : p,
    );
    setDirty(true);
    setMessage("");
  }
  function editBlock(id: string, patch: Partial<PageBlock>) {
    setDraft((p) =>
      p
        ? {
            ...p,
            translations: {
              ...p.translations,
              [locale]: {
                ...p.translations[locale],
                blocks: p.translations[locale].blocks.map((b) =>
                  b.id === id ? { ...b, ...patch } : b,
                ),
              },
            },
          }
        : p,
    );
    setDirty(true);
    setMessage("");
  }
  function open(page: ContentPage) {
    if (dirty && !window.confirm(ui("Ungespeicherte Änderungen verwerfen?")))
      return;
    setDraft(structuredClone(page));
    setDirty(false);
    setError("");
    setMessage("");
  }
  useEffect(() => {
    if (!dirty) return;
    const prevent = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  const value = draft?.translations[locale];
  return (
    <>
      <section className="panel settings-panel">
        <div className="panel-heading">
          <div>
            <h2>{ui("Eigene Seiten")}</h2>
            <p>
              {ui(
                "Baue mehrsprachige Seiten aus Text-, Hinweis- und Link-Abschnitten. Bestimme, wo sie verlinkt werden. Entwürfe und archivierte Seiten sind öffentlich nicht erreichbar.",
              )}
            </p>
          </div>
          <button
            className="primary"
            type="button"
            onClick={() => open(newPage())}
          >
            {ui("Seite anlegen")}
          </button>
        </div>
        <div className="content-page-list">
          {pages.map((p) => (
            <button
              key={p.id}
              type="button"
              className={draft?.id === p.id ? "secondary active" : "secondary"}
              onClick={() => open(p)}
            >
              {p.translations.de.title || p.translations.en.title || p.slug}
              <small>
                /p/{p.slug} ·{" "}
                {p.archived
                  ? ui("Archiviert")
                  : Object.values(p.translations).some((t) => t.published)
                    ? ui("Veröffentlicht")
                    : ui("Entwurf")}
              </small>
            </button>
          ))}
        </div>
        {!pages.length && <p>{ui("Noch keine eigenen Seiten angelegt.")}</p>}
      </section>
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="form-note">
          {message}
        </p>
      )}
      {draft && value && (
        <form
          className="panel settings-panel page-builder"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const result = await api<{ id: string }>("admin/pages", {
                ...draft,
                id: draft.id || undefined,
              });
              const next = await load();
              setDraft(next.find((p) => p.id === result.id)!);
              setDirty(false);
              setMessage(ui("Seite gespeichert."));
              window.dispatchEvent(new Event("kc:site-updated"));
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="form-grid">
            <label className="field">
              <span>{ui("Seitenadresse /p/…")}</span>
              <input
                required
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                maxLength={80}
                value={draft.slug}
                onChange={(e) => change({ slug: e.target.value })}
                placeholder="ueber-uns"
              />
            </label>
            <label className="field">
              <span>{ui("Link-Reihenfolge")}</span>
              <input
                type="number"
                min={0}
                max={9999}
                value={draft.sortOrder}
                onChange={(e) => change({ sortOrder: Number(e.target.value) })}
              />
            </label>
          </div>
          <fieldset>
            <legend>{ui("Link anzeigen in")}</legend>
            <div className="button-row">
              {(
                [
                  ["header", ui("Website-Kopfzeile")],
                  ["footer", "Footer"],
                  ["workspace", ui("Workspace-Sidebar")],
                ] as const
              ).map(([key, label]) => (
                <label className="check-row" key={key}>
                  <input
                    type="checkbox"
                    checked={draft.placements.includes(key)}
                    onChange={(e) =>
                      change({
                        placements: e.target.checked
                          ? [...draft.placements, key]
                          : draft.placements.filter((p) => p !== key),
                      })
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="check-row">
            <input
              type="checkbox"
              checked={draft.archived}
              onChange={(e) => change({ archived: e.target.checked })}
            />
            {ui("Seite archivieren (alle Sprachen und Links ausblenden)")}
          </label>
          <div className="tabs" role="group" aria-label={ui("Seitensprache")}>
            {(["en", "de"] as const).map((l) => (
              <button
                type="button"
                key={l}
                className={locale === l ? "active" : ""}
                onClick={() => setLocale(l)}
              >
                {languageNames[l]} ·{" "}
                {draft.translations[l].published
                  ? ui("Veröffentlicht")
                  : ui("Entwurf")}
              </button>
            ))}
          </div>
          <label className="field">
            <span>
              {ui("Seitentitel (")}
              {languageNames[locale]})
            </span>
            <input
              value={value.title}
              maxLength={150}
              onChange={(e) => translation({ title: e.target.value })}
            />
          </label>
          <label className="field">
            <span>{ui("Kurzbeschreibung")}</span>
            <input
              maxLength={300}
              value={value.description}
              onChange={(e) => translation({ description: e.target.value })}
            />
          </label>
          {value.blocks.map((block, index) => (
            <section
              className={`builder-block builder-${block.type}`}
              key={`${draft.id}:${locale}:${block.id}`}
            >
              <div className="panel-heading">
                <h3>
                  {index + 1}.{" "}
                  {
                    {
                      text: "Text",
                      callout: ui("Hinweis"),
                      cta: ui("Link / Aktion"),
                    }[block.type]
                  }
                </h3>
                <div className="button-row">
                  <button
                    type="button"
                    className="secondary compact"
                    aria-label={ui("Abschnitt {0} nach oben", [index + 1])}
                    disabled={index === 0}
                    onClick={() => {
                      const blocks = [...value.blocks];
                      [blocks[index - 1], blocks[index]] = [
                        blocks[index],
                        blocks[index - 1],
                      ];
                      translation({ blocks });
                    }}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="secondary compact"
                    aria-label={ui("Abschnitt {0} nach unten", [index + 1])}
                    disabled={index === value.blocks.length - 1}
                    onClick={() => {
                      const blocks = [...value.blocks];
                      [blocks[index + 1], blocks[index]] = [
                        blocks[index],
                        blocks[index + 1],
                      ];
                      translation({ blocks });
                    }}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="secondary compact"
                    onClick={() =>
                      translation({
                        blocks: value.blocks.filter((b) => b.id !== block.id),
                      })
                    }
                  >
                    {ui("Entfernen")}
                  </button>
                </div>
              </div>
              <LegalEditor
                title={ui("Abschnitt {0} ({1})", [
                  index + 1,
                  languageNames[locale],
                ])}
                content={block.content}
                format="html"
                onContentChange={(html) =>
                  editBlock(block.id, { content: html })
                }
              />
              {block.type === "cta" && (
                <div className="form-grid">
                  <label className="field">
                    <span>{ui("Button-Text")}</span>
                    <input
                      value={block.label}
                      maxLength={100}
                      onChange={(e) =>
                        editBlock(block.id, { label: e.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>{ui("Ziel: /lokale-seite oder https://…")}</span>
                    <input
                      value={block.href}
                      maxLength={2000}
                      onChange={(e) =>
                        editBlock(block.id, { href: e.target.value })
                      }
                    />
                  </label>
                </div>
              )}
            </section>
          ))}
          <div className="button-row">
            {(["text", "callout", "cta"] as const).map((type) => (
              <button
                type="button"
                className="secondary"
                key={type}
                disabled={value.blocks.length >= 30}
                onClick={() =>
                  translation({
                    blocks: [
                      ...value.blocks,
                      {
                        id: crypto.randomUUID(),
                        type,
                        content: "",
                        label: "",
                        href: "",
                      },
                    ],
                  })
                }
              >
                +{" "}
                {
                  {
                    text: "Text",
                    callout: ui("Hinweis"),
                    cta: ui("Link / Aktion"),
                  }[type]
                }
              </button>
            ))}
          </div>
          <label className="check-row">
            <input
              type="checkbox"
              checked={value.published}
              onChange={(e) => translation({ published: e.target.checked })}
            />
            {ui("Diese Sprachversion veröffentlichen")}
          </label>
          <p className="muted">
            {ui(
              "Entwürfe kannst du jederzeit speichern. Veröffentlichung und Navigation gelten pro Sprache. Bestehende Revisionen werden beim Speichern erhalten.",
            )}
          </p>
          <div className="button-row">
            <button className="primary" disabled={busy}>
              {busy ? ui("Speichert …") : ui("Seite speichern")}
              {dirty ? " *" : ""}
            </button>
            {draft.id && !draft.archived && value.published && (
              <a
                href={`/p/${draft.slug}?lang=${locale}`}
                className="secondary"
                target="_blank"
                rel="noreferrer"
              >
                {ui("Veröffentlichte Seite ansehen")}
              </a>
            )}
          </div>
        </form>
      )}
    </>
  );
}
