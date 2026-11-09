"use client";
import type { ProviderModel } from "@/src/core/provider-catalog";
import { useLanguage } from "./language";
import { useEffect, useState } from "react";
import { modelCheckWindow, modelCheckCountdown } from "@/src/core/model-check";
import { ModelPricingFields } from "./model-pricing-fields";
import { ModelCapabilityFields } from "./model-capability-fields";
import {
  defaultModelTimeoutSeconds,
  maxModelTimeoutSeconds,
  reasoningEffortValues,
} from "@/src/core/agent-recovery";
import {
  Plus,
  Blocks,
  Check,
  Settings2,
  Trash2,
  RefreshCw,
} from "lucide-react";
import type { ModelOffering, Snapshot, Plan } from "@/src/core/types";
import {
  minOutputTokens,
  maxOutputTokens,
  defaultOutputTokens,
} from "@/src/core/model-limits";
type Save = (path: string, body: unknown) => Promise<unknown>;
function Field({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const { ui, localeTag } = useLanguage();

  return (
    <label className="field">
      <span>{title}</span>
      {children}
    </label>
  );
}
export function ModelCatalog({
  models,
  admin = false,
  save,
  state,
  plans,
}: {
  models: ModelOffering[];
  admin?: boolean;
  save: Save;
  state?: Snapshot;
  plans?: Plan[];
}) {
  const { ui, localeTag, t } = useLanguage();

  const [editing, setEditing] = useState<ModelOffering | null | undefined>(
      undefined,
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [removing, setRemoving] = useState<ModelOffering | null>(null);
  const [identity, setIdentity] = useState({ name: "", provider: "" });
  const [selection, setSelection] = useState<ProviderModel | null | undefined>(
    undefined,
  );
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => setNow(Date.now()), [models]);
  const coolingDown = models.some(
    (m) => m.active && modelCheckWindow(m.checked_at, now).remainingSeconds > 0,
  );
  useEffect(() => {
    if (!coolingDown) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [coolingDown]);
  const edit = (m: ModelOffering | null | undefined) => {
    setIdentity({ name: m?.name ?? "", provider: m?.provider_name ?? "" });
    setSelection(undefined);
    setEditing(m);
  };
  const action = async (m: ModelOffering, action: string) => {
    setBusy(true);
    setError("");
    try {
      await save(admin ? "admin/models/action" : "models/action", {
        id: m.id,
        action,
      });
      setRemoving(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await save(admin ? "admin/models" : "models", {
        id: editing?.id,
        name: f.get("name"),
        provider_name: f.get("provider"),
        endpoint: f.get("endpoint"),
        model: f.get("model"),
        ...(f.get("replace") || !editing ? { key: f.get("key") } : {}),
        ...(admin
          ? {
              pricing_config: f.get("pricing_enabled")
                ? {
                    mode: f.get("pricing_mode"),
                    currency: f.get("pricing_currency"),
                    input_per_million:
                      f.get("pricing_input") === ""
                        ? null
                        : Number(f.get("pricing_input")),
                    output_per_million:
                      f.get("pricing_output") === ""
                        ? null
                        : Number(f.get("pricing_output")),
                    request:
                      f.get("pricing_request") === ""
                        ? null
                        : Number(f.get("pricing_request")),
                    eur_per_currency_unit: Number(f.get("pricing_fx")),
                    eur_per_1000_credits: Number(f.get("pricing_credit_value")),
                    markup_percent: Number(f.get("pricing_markup")),
                    cost_buffer_percent: Number(f.get("pricing_buffer")),
                    acknowledge_extras: f.get("pricing_ack") === "on",
                    platform_base_credits: Number(
                      f.get("pricing_platform_base"),
                    ),
                  }
                : null,
            }
          : {}),
        input_rate: Number(f.get("input") ?? 0),
        output_rate: Number(f.get("output") ?? 0),
        base_credits: Number(f.get("base") ?? 0),
        active: f.get("active") === "on",
        monitor_enabled: f.get("monitor_enabled") === "on",
        streaming: f.get("streaming") === "on",
        max_output_tokens: Number(f.get("max_output_tokens")),
        context_window_tokens: f.get("context_window_tokens")
          ? Number(f.get("context_window_tokens"))
          : null,
        request_timeout_seconds: Number(f.get("request_timeout_seconds")),
        reasoning_effort: f.get("reasoning_effort"),
        auto_reasoning_effort: f.get("auto_reasoning_effort"),
        detect_capabilities: f.get("detect_capabilities") === "true",
      });
      edit(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="panel-heading">
        <div>
          <h2>
            {admin
              ? ui("KI-Angebote & Credit-Tarife")
              : ui("Deine Modellauswahl")}
          </h2>
          <p>
            {admin
              ? ui(
                  "Mehrere Anbieter und Modelle anbieten. Jeder Aufruf verwendet seinen gespeicherten Tarif.",
                )
              : ui(
                  "Wähle einen Standard pro Workspace. Für einzelne Agenten kannst du ein anderes Modell festlegen.",
                )}
          </p>
        </div>
        <button className="primary" onClick={() => edit(null)}>
          <Plus size={16} />
          {admin ? ui("Modell anbieten") : ui("Eigene KI hinzufügen")}
        </button>
      </div>
      <div className="form-note">
        {admin
          ? ui(
              "Verbrauch = aufgerundete Summe aus Eingabe- und Ausgabe-Tokens × jeweiligem Tarif / 1.000 + Grundpreis pro Aufruf. Vor jedem Schritt wird ein höherer Höchstbetrag reserviert und anschließend abgerechnet. Fehlt eine Token-Aufschlüsselung, gilt der höhere Token-Tarif.",
            )
          : ui(
              "Eigene Schlüssel werden verschlüsselt gespeichert. BYOK verursacht hier keine Plattform-KI-Credits; dein Anbieter berechnet seine Nutzung separat. Betreiber-Modelle benötigen einen passenden Plan und Guthaben.",
            )}
      </div>
      <div className="catalog-grid">
        {models.map((m) => {
          const wait = modelCheckWindow(m.checked_at, now).remainingSeconds;
          const checking = m.check_status === "checking" && wait > 0;
          return (
            <article
              className={`panel model-card ${!m.active ? "inactive" : ""}`}
              key={m.id}
            >
              <div className="panel-heading">
                <Blocks size={22} />
                <span className="subtle-chip">
                  {m.workspace_id
                    ? ui("Eigener Anbieter")
                    : m.active
                      ? ui("KeRnCloud KI")
                      : ui("Deaktiviert")}
                </span>
              </div>
              <h3>{m.name}</h3>
              <p>
                {m.provider_name} · {m.model}
              </p>
              <p>
                {t("Denkaufwand: ", "Reasoning effort: ")}
                {(m.reasoning_effort ?? "auto") === "auto"
                  ? t("Automatisch → ", "Automatic → ") +
                    ((m.auto_reasoning_effort ?? "provider_default") ===
                    "provider_default"
                      ? t("Anbietervorgabe", "Provider default")
                      : m.auto_reasoning_effort)
                  : m.reasoning_effort === "provider_default"
                    ? t("Anbietervorgabe", "Provider default")
                    : m.reasoning_effort}
              </p>
              {!m.workspace_id && (
                <p>
                  <b>{m.input_rate}</b>
                  {ui(" Eingabe / ")}
                  <b>{m.output_rate}</b>{" "}
                  {ui("Ausgabe-Credits pro 1.000 Tokens")}
                  <br />
                  {m.base_credits}
                  {ui(" Credits je Aufruf")}
                </p>
              )}
              <p>
                {t("Modellfähigkeiten: ", "Model capabilities: ")}
                {m.capabilities?.checked_at
                  ? t("Anbieterkatalog · ", "Provider catalog · ") +
                    new Date(m.capabilities.checked_at).toLocaleString(
                      localeTag,
                    )
                  : t("nicht erkannt", "not detected")}
              </p>
              <div
                className={
                  ["unavailable", "unlisted"].includes(m.check_status ?? "")
                    ? "error-box"
                    : "form-note"
                }
                role="status"
                style={{ display: "block" }}
              >
                {t("Verbindungscheck: ", "Connection check: ")}
                {m.check_status === "available"
                  ? t(
                      "Erreichbar; Modell im Katalog",
                      "Reachable; model listed",
                    )
                  : m.check_status === "unavailable"
                    ? t(
                        "Nicht erreichbar oder Zugang abgelehnt",
                        "Unreachable or access denied",
                      )
                    : m.check_status === "unlisted"
                      ? t(
                          "Modell nicht im Anbieterkatalog – Auswahl prüfen",
                          "Model absent from provider catalog – check selection",
                        )
                      : m.check_status === "unsupported"
                        ? t(
                            "Anbieter unterstützt keinen prüfbaren Modellkatalog",
                            "Provider has no supported model catalog",
                          )
                        : m.check_status === "checking"
                          ? checking
                            ? t("Prüfung läuft", "Checking")
                            : t(
                                "Prüfung nicht abgeschlossen – erneut prüfen",
                                "Check did not finish – check again",
                              )
                          : t("Noch nicht geprüft", "Not checked yet")}
                <br />
                {m.checked_at &&
                  new Date(m.checked_at).toLocaleString(localeTag)}
                <small>
                  {m.monitor_enabled
                    ? t(
                        " · Automatisch alle 24 Stunden",
                        " · Automatically every 24 hours",
                      )
                    : t(
                        " · Automatische Prüfung aus",
                        " · Automatic checks off",
                      )}
                </small>
                {m.active && wait > 0 && (
                  <p>
                    {t("Nächste manuelle Prüfung in ", "Next manual check in ")}
                    {modelCheckCountdown(wait)}.{" "}
                    {t(
                      "Das vorhandene Ergebnis wird wiederverwendet; keine weitere Anbieteranfrage.",
                      "The existing result is reused; no additional provider request.",
                    )}
                  </p>
                )}
              </div>
              <div className="button-row">
                {state && (
                  <button
                    className={
                      state.workspace.default_model_id === m.id
                        ? "primary"
                        : "secondary"
                    }
                    disabled={
                      state.workspace.default_model_id === m.id || !m.active
                    }
                    onClick={() =>
                      void save("default-model", { modelId: m.id }).catch((e) =>
                        setError(e.message),
                      )
                    }
                  >
                    {state.workspace.default_model_id === m.id ? (
                      <>
                        <Check size={16} />
                        {ui("Standard")}
                      </>
                    ) : (
                      ui("Als Standard wählen")
                    )}
                  </button>
                )}
                {(admin || m.workspace_id) && (
                  <>
                    <button
                      className="secondary"
                      disabled={busy || !m.active || wait > 0}
                      onClick={() => void action(m, "check")}
                    >
                      <RefreshCw size={15} />
                      {checking
                        ? t("Prüfung läuft", "Checking")
                        : wait > 0
                          ? t("Prüfen in ", "Check in ") +
                            modelCheckCountdown(wait)
                          : t("Jetzt prüfen", "Check now")}
                    </button>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => setRemoving(m)}
                    >
                      <Trash2 size={15} />
                      {t("Entfernen", "Remove")}
                    </button>
                  </>
                )}
                {(admin || m.workspace_id) && (
                  <button
                    className="secondary"
                    aria-label={ui("{0} bearbeiten", [m.name])}
                    onClick={() => edit(m)}
                  >
                    <Settings2 size={15} />
                    {ui("Bearbeiten")}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {!models.length && (
        <div className="empty">
          <h3>{ui("Noch kein Modell eingerichtet")}</h3>
          <p>
            {ui(
              "Verbinde einen eigenen API-Zugang oder lege als Administrator ein Betreiber-Angebot an.",
            )}
          </p>
        </div>
      )}
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      <p className="form-note">
        {t(
          "Der Verbindungscheck ruft nur den Modellkatalog ab und erzeugt keine KI-Antwort. Er bestätigt weder verfügbares Guthaben noch die erfolgreiche Textgenerierung. Ausführung durch verbundene Worker; manuelle Prüfung höchstens alle fünf Minuten.",
          "Connection checks only request the model catalog and generate no AI answer. They do not confirm remaining provider credit or successful generation. Connected workers perform checks; manual checks at most every five minutes.",
        )}
      </p>
      {removing && (
        <section
          className="panel settings-panel"
          role="dialog"
          aria-label={t("Modell entfernen", "Remove model")}
        >
          <h2>{removing.name}</h2>
          <p>
            {t(
              "Modell entfernen und gespeicherten API-Schlüssel löschen? Verbrauchshistorie bleibt erhalten. Wähle anschließend für betroffene Workspaces und Agenten ein anderes Modell. Offene Aufträge müssen zuerst beendet werden.",
              "Remove model and erase its saved API key? Usage history is retained. Select another model for affected workspaces and agents afterwards. Finish open tasks first.",
            )}
          </p>
          <div className="button-row">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void action(removing, "remove")}
            >
              {t("Modell entfernen", "Remove model")}
            </button>
            <button className="secondary" onClick={() => setRemoving(null)}>
              {ui("Abbrechen")}
            </button>
          </div>
        </section>
      )}
      {editing !== undefined && (
        <section className="panel settings-panel">
          <h2>
            {editing
              ? ui("{0} bearbeiten", [editing.name])
              : ui("Modell hinzufügen")}
          </h2>
          <form onSubmit={submit} key={editing?.id ?? "new"}>
            <div className="form-grid">
              <Field title={ui("Anzeigename")}>
                <input
                  name="name"
                  value={identity.name}
                  onChange={(e) =>
                    setIdentity({ ...identity, name: e.target.value })
                  }
                  required
                  maxLength={150}
                />
              </Field>
              <Field title={ui("KI-Anbieter")}>
                <input
                  name="provider"
                  value={identity.provider}
                  onChange={(e) =>
                    setIdentity({ ...identity, provider: e.target.value })
                  }
                  placeholder={ui("Anbieter oder eigener Modellserver")}
                  required
                  maxLength={150}
                />
              </Field>
              <Field title={ui("API-Basisadresse")}>
                <input
                  name="endpoint"
                  type="url"
                  defaultValue={editing?.endpoint}
                  placeholder="https://anbieter.example/v1"
                  required
                />
              </Field>
              <Field title={ui("API-Schlüssel")}>
                <input
                  name="key"
                  type="password"
                  autoComplete="new-password"
                  placeholder={
                    editing
                      ? ui("Leer = bisherigen Schlüssel behalten")
                      : ui("Bei lokalen Modellen ggf. leer")
                  }
                  maxLength={2000}
                />
              </Field>
              <ModelCapabilityFields
                model={editing}
                admin={admin}
                onSelect={(m) => {
                  setIdentity({
                    name: m.name.slice(0, 150),
                    provider: m.provider.slice(0, 150),
                  });
                  setSelection(m);
                }}
                onInvalidate={() => setSelection(null)}
              />
              <Field
                title={t(
                  "Zeitlimit pro Modellaufruf (Sekunden)",
                  "Time limit per model call (seconds)",
                )}
              >
                <input
                  name="request_timeout_seconds"
                  type="number"
                  min={30}
                  max={maxModelTimeoutSeconds}
                  step={1}
                  defaultValue={
                    editing?.request_timeout_seconds ??
                    defaultModelTimeoutSeconds
                  }
                  required
                />
                <small>
                  {t(
                    "Standard: 10 Minuten. Agenten können einen vorübergehend fehlgeschlagenen Modellaufruf einmal innerhalb des Auftragsbudgets wiederholen.",
                    "Default: 10 minutes. Agents may retry one temporarily failed model call within the task budget.",
                  )}
                </small>
              </Field>
            </div>

            {admin && (
              <ModelPricingFields
                model={editing}
                selection={selection}
                plans={plans}
              />
            )}
            <label className="check-row">
              <input
                name="monitor_enabled"
                type="checkbox"
                defaultChecked={editing?.monitor_enabled ?? true}
              />
              {t(
                "Automatischer Verbindungscheck alle 24 Stunden (ohne Textgenerierung)",
                "Automatic connection check every 24 hours (no text generation)",
              )}
            </label>
            <label className="check-row">
              <input
                name="streaming"
                type="checkbox"
                defaultChecked={editing?.streaming ?? true}
              />
              {ui("Antworten streamen (falls der Anbieter dies unterstützt)")}
            </label>
            <label className="check-row">
              <input
                name="active"
                type="checkbox"
                defaultChecked={editing?.active ?? true}
              />
              {ui("Modell aktivieren")}
            </label>
            <div className="button-row">
              <button className="primary" disabled={busy}>
                {busy ? ui("Wird gespeichert …") : ui("Modell speichern")}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => edit(undefined)}
              >
                {ui("Abbrechen")}
              </button>
            </div>
          </form>
        </section>
      )}
    </>
  );
}
