"use client";
import { api } from "./api-client";
import { useEffect, useRef, useState } from "react";
import { useLanguage } from "./language";
import type { ModelOffering } from "@/src/core/types";
import {
  allowedReasoning,
  applyCapabilityLimits,
  type ModelCapabilities,
} from "@/src/core/model-capabilities";
import { maxOutputTokens, defaultOutputTokens } from "@/src/core/model-limits";
import {
  filterProviderModels,
  type ProviderModel,
} from "@/src/core/provider-catalog";
export function ModelCapabilityFields({
  model,
  admin,
  onSelect,
  onInvalidate,
}: {
  model: ModelOffering | null;
  admin: boolean;
  onSelect?: (model: ProviderModel) => void;
  onInvalidate?: () => void;
}) {
  const { t, localeTag } = useLanguage();
  const limited = model ? applyCapabilityLimits(model) : null;
  const root = useRef<HTMLDivElement>(null),
    sequence = useRef(0),
    catalogSequence = useRef(0),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [modelId, setModelId] = useState(model?.model ?? ""),
    [models, setModels] = useState<ProviderModel[] | null>(null),
    [query, setQuery] = useState(""),
    [catalogSelected, setCatalogSelected] = useState(""),
    [catalogBusy, setCatalogBusy] = useState(false),
    [catalogNotice, setCatalogNotice] = useState("");
  const filtered = filterProviderModels(models ?? [], query);
  const [caps, setCaps] = useState<ModelCapabilities>(
      model?.capabilities ?? {},
    ),
    [manual, setManual] = useState(!!model && !model.capabilities?.checked_at),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [context, setContext] = useState(
      String(limited?.context_window_tokens ?? ""),
    ),
    [output, setOutput] = useState(
      String(limited?.max_output_tokens ?? defaultOutputTokens),
    ),
    [effort, setEffort] = useState(model?.reasoning_effort ?? "auto"),
    [automatic, setAutomatic] = useState(
      model?.auto_reasoning_effort ?? "provider_default",
    );
  const choices = allowedReasoning(caps, !manual),
    maxContext = Math.min(8388608, caps.context_window_tokens ?? 8388608),
    maxOut = Math.min(
      maxOutputTokens,
      caps.max_output_tokens ?? maxOutputTokens,
      caps.context_window_tokens ?? Infinity,
    );
  const applyCapabilities = (c: ModelCapabilities, available: boolean) => {
    setCaps(c);
    if (available) setManual(false);
    if (c.context_window_tokens)
      setContext(String(Math.min(c.context_window_tokens, 8388608)));
    else if (available) setContext("");
    if (c.max_output_tokens || c.context_window_tokens)
      setOutput((old) =>
        String(
          Math.min(
            Number(old) || defaultOutputTokens,
            c.max_output_tokens ?? maxOutputTokens,
            c.context_window_tokens ?? Infinity,
          ),
        ),
      );
    const valid = allowedReasoning(c, true);
    if (available || !manual) {
      setEffort((old) =>
        ["auto", "provider_default", ...valid].includes(old)
          ? old
          : "provider_default",
      );
      setAutomatic((old) =>
        old === "provider_default" || valid.includes(old)
          ? old
          : "provider_default",
      );
    }
  };
  const credentials = () => {
    const form = root.current?.closest("form");
    if (!form) return null;
    const f = new FormData(form);
    return {
      id: model?.id,
      endpoint: String(f.get("endpoint") ?? ""),
      engine_kind: String(f.get("engine_kind") ?? "openai-chat"),
      ...(!model || f.get("replace")
        ? { key: String(f.get("key") ?? "") }
        : {}),
    };
  };
  const loadCatalog = async () => {
    clearTimeout(timer.current);
    sequence.current++;
    setBusy(false);
    const body = credentials();
    if (!body?.endpoint) {
      setCatalogNotice(
        t(
          "Bitte zuerst die API-Basisadresse eingeben.",
          "Enter the API base address first.",
        ),
      );
      return;
    }
    const version = ++catalogSequence.current;
    setCatalogBusy(true);
    setCatalogNotice("");
    setModels(null);
    setCatalogSelected("");
    try {
      const result = await api(
        admin ? "admin/models/catalog" : "models/catalog",
        body,
      );
      if (version !== catalogSequence.current) return;
      if (result.status !== "available") {
        setCatalogNotice(
          result.status === "unsupported"
            ? t(
                "Der Anbieter liefert keinen unterstützten Modellkatalog. Modell-ID manuell eingeben.",
                "This provider does not offer a supported model catalog. Enter the model ID manually.",
              )
            : t(
                "Katalog nicht erreichbar. API-Adresse, Schlüssel und Berechtigungen prüfen; die manuelle Eingabe bleibt möglich.",
                "Catalog unavailable. Check API address, key and permissions; manual entry remains available.",
              ),
        );
        return;
      }
      setModels(result.models);
      setQuery("");
      setCatalogNotice(
        result.partial
          ? t(
              "Der Anbieter liefert eine Teilliste. Nicht aufgeführte Modell-IDs können manuell eingetragen werden.",
              "The provider returned a partial list. Unlisted model IDs can be entered manually.",
            )
          : result.models.length
            ? ""
            : t(
                "Der Anbieter hat keine Modelle zurückgegeben.",
                "The provider returned no models.",
              ),
      );
    } catch (e) {
      if (version === catalogSequence.current)
        setCatalogNotice((e as Error).message);
    } finally {
      if (version === catalogSequence.current) setCatalogBusy(false);
    }
  };
  const chooseModel = (id: string) => {
    const entry = models?.find((m) => m.id === id);
    if (!entry) return;
    clearTimeout(timer.current);
    sequence.current++;
    setBusy(false);
    setModelId(entry.id);
    setCatalogSelected(entry.id);
    onSelect?.(entry);
    applyCapabilities(entry.capabilities, true);
    setNotice(
      t(
        "Modell-ID und gemeldete Fähigkeiten übernommen.",
        "Model ID and reported capabilities applied.",
      ),
    );
  };
  const detect = async () => {
    clearTimeout(timer.current);
    const form = root.current?.closest("form");
    if (!form) return;
    const f = new FormData(form),
      endpoint = String(f.get("endpoint") ?? ""),
      id = String(f.get("model") ?? "");
    if (!endpoint || !id) return;
    const version = ++sequence.current;
    setBusy(true);
    setNotice("");
    try {
      const result = await api(
        admin ? "admin/models/discover" : "models/discover",
        {
          id: model?.id,
          endpoint,
          engine_kind: String(f.get("engine_kind") ?? "openai-chat"),
          model: id,
          ...(!model || f.get("replace")
            ? { key: String(f.get("key") ?? "") }
            : {}),
        },
      );
      if (version !== sequence.current) return;
      const c: ModelCapabilities = result.capabilities ?? {};
      applyCapabilities(c, result.status === "available");
      setNotice(
        result.status === "available"
          ? t(
              "Katalog geprüft. Nicht gemeldete Fähigkeiten bleiben unbekannt.",
              "Catalog checked. Unreported capabilities remain unknown.",
            )
          : t(
              "Keine verlässlichen Modellmetadaten abrufbar. Zugang und Modell-ID prüfen oder Werte manuell eintragen.",
              "No reliable model metadata available. Check access and model ID, or enter values manually.",
            ),
      );
    } catch (e) {
      if (version === sequence.current) setNotice((e as Error).message);
    } finally {
      if (version === sequence.current) setBusy(false);
    }
  };
  useEffect(() => {
    const form = root.current?.closest("form");
    if (!form) return;

    const changed = (e: Event) => {
      if (
        ["endpoint", "model", "key", "replace", "engine_kind"].includes(
          (e.target as HTMLInputElement).name,
        )
      ) {
        clearTimeout(timer.current);
        sequence.current++;
        setCaps({});
        setCatalogSelected("");
        onInvalidate?.();
        setNotice("");
        setBusy(false);
        if ((e.target as HTMLInputElement).name !== "model") {
          catalogSequence.current++;
          setModels(null);
          setQuery("");
          setCatalogBusy(false);
          setCatalogNotice("");
        }
      }
    };
    const blurred = (e: Event) => {
      if (
        !manual &&
        ["endpoint", "model", "key", "replace", "engine_kind"].includes(
          (e.target as HTMLInputElement).name,
        )
      ) {
        clearTimeout(timer.current);
        timer.current = setTimeout(() => void detect(), 400);
      }
    };
    form.addEventListener("input", changed);
    form.addEventListener("focusout", blurred);
    return () => {
      clearTimeout(timer.current);
      sequence.current++;
      form.removeEventListener("input", changed);
      form.removeEventListener("focusout", blurred);
    };
  }, [manual]);
  useEffect(
    () => () => {
      catalogSequence.current++;
    },
    [],
  );
  const selectedPrices = models?.find((m) => m.id === modelId)?.prices;
  const effortOptions = (auto: boolean) => (
    <>
      {auto && (
        <option value="auto">
          {t("Automatisch (Modellprofil)", "Automatic (model preset)")}
        </option>
      )}
      <option value="provider_default">
        {t("Anbietervorgabe", "Provider default")}
      </option>
      {choices.map((v) => (
        <option key={v} value={v}>
          {v}
        </option>
      ))}
      {!["auto", "provider_default", ...choices].includes(
        auto ? effort : automatic,
      ) && (
        <option disabled value={auto ? effort : automatic}>
          {t(
            "Bisheriger Wert nicht unterstützt – neu wählen",
            "Previous value unsupported — choose again",
          )}
        </option>
      )}
    </>
  );
  return (
    <>
      <div className="provider-model-picker" ref={root}>
        {model && (
          <label className="check-row">
            <input name="replace" type="checkbox" />
            {t(
              "Schlüssel ersetzen (auch zum Leeren; bei neuer API-Adresse erforderlich)",
              "Replace key (also to clear it; required for a new API address)",
            )}
          </label>
        )}
        <div className="provider-model-heading">
          <div>
            <strong>
              {t(
                "Modell aus dem Anbieterkatalog wählen",
                "Choose a model from the provider catalog",
              )}
            </strong>
            <p>
              {t(
                "API-Adresse und bei Bedarf Schlüssel oben eingeben. Die Suche benötigt keine KI-Aufrufe.",
                "Enter the API address and, if needed, key above. Searching requires no AI calls.",
              )}
            </p>
          </div>
          <button
            type="button"
            className="secondary"
            disabled={catalogBusy}
            onClick={() => void loadCatalog()}
          >
            {catalogBusy
              ? t("Modelle werden geladen …", "Loading models …")
              : t("Modelle vom Anbieter laden", "Load provider models")}
          </button>
        </div>
        {catalogNotice && <p role="status">{catalogNotice}</p>}
        {models !== null && models.length > 0 && (
          <div className="provider-model-results">
            <label className="field">
              <span>{t("Modelle durchsuchen", "Search models")}</span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("Name oder Modell-ID …", "Name or model ID …")}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.preventDefault();
                }}
              />
            </label>
            <p aria-live="polite">
              {filtered.length} / {models.length} {t("Modelle", "models")}
              {filtered.length > 100
                ? t(
                    " · erste 100 Treffer, Suche eingrenzen",
                    " · first 100 matches, narrow your search",
                  )
                : ""}
            </p>
            {filtered.length ? (
              <label className="field">
                <span>{t("Modell auswählen", "Select model")}</span>
                <select
                  size={Math.min(6, filtered.length + 1)}
                  value={
                    filtered.slice(0, 100).some((m) => m.id === catalogSelected)
                      ? catalogSelected
                      : ""
                  }
                  onChange={(e) => chooseModel(e.target.value)}
                >
                  <option value="" disabled>
                    {t("Modell wählen …", "Choose a model …")}
                  </option>
                  {filtered.slice(0, 100).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name === m.id ? m.id : m.name + " · " + m.id}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p>
                {t(
                  "Keine passenden Modelle gefunden.",
                  "No matching models found.",
                )}
              </p>
            )}
            <small>
              {t(
                "Die Auswahl übernimmt ID und gemeldete Fähigkeiten. Der Katalog bestätigt weder Guthaben noch erfolgreiche Textgenerierung.",
                "Selection applies the ID and reported capabilities. The catalog does not confirm balance or successful text generation.",
              )}
            </small>
          </div>
        )}
        {selectedPrices && !admin && (
          <p>
            {t("Gemeldeter Einkauf: ", "Reported purchase price: ")}
            {selectedPrices.input_per_million ??
              t("unbekannt", "unknown")} /{" "}
            {selectedPrices.output_per_million ?? t("unbekannt", "unknown")}{" "}
            {selectedPrices.currency}{" "}
            {t(
              "je 1 Mio. Eingabe-/Ausgabe-Tokens; ",
              "per 1M input/output tokens; ",
            )}
            {selectedPrices.request ?? t("unbekannt", "unknown")}{" "}
            {selectedPrices.currency}{" "}
            {t(
              "je Aufruf. Abrechnung erfolgt durch deinen Anbieter.",
              "per request. Your provider handles billing.",
            )}
          </p>
        )}
        <label className="field">
          <span>{t("Modell-ID", "Model ID")}</span>
          <input
            name="model"
            required
            maxLength={200}
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
          />
          <small>
            {t(
              "Wird bei der Auswahl ausgefüllt; für Anbieter ohne Katalog auch manuell bearbeitbar.",
              "Filled in on selection; also editable manually for providers without a catalog.",
            )}
          </small>
        </label>
      </div>
      <div className="form-note" style={{ gridColumn: "1 / -1" }}>
        <div>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => void detect()}
          >
            {busy
              ? t("Wird erkannt …", "Detecting …")
              : t("Modellfähigkeiten erkennen", "Detect model capabilities")}
          </button>
          <label className="check-row">
            <input
              type="checkbox"
              checked={manual}
              onChange={(e) => {
                setManual(e.target.checked);
                if (!e.target.checked) {
                  const valid = allowedReasoning(caps, true);
                  if (!["auto", "provider_default", ...valid].includes(effort))
                    setEffort("provider_default");
                  if (!["provider_default", ...valid].includes(automatic))
                    setAutomatic("provider_default");
                }
              }}
            />
            {t(
              "Fehlende Angaben manuell ergänzen (nicht verifiziert)",
              "Enter missing values manually (unverified)",
            )}
          </label>
          <input
            type="hidden"
            name="detect_capabilities"
            value={manual ? "false" : "true"}
          />
          <p>
            {t(
              "Nur Katalogabfrage, keine Textgenerierung. Änderungen an API-Adresse, Modell-ID oder Schlüssel erfordern eine neue Erkennung.",
              "Catalog request only, no text generation. Changes to API address, model ID or key require fresh detection.",
            )}
          </p>
          <p>
            {caps.checked_at
              ? t(
                  "Quelle: Anbieterkatalog · geprüft ",
                  "Source: provider catalog · checked ",
                ) + new Date(caps.checked_at).toLocaleString(localeTag)
              : t(
                  "Noch keine bestätigten Modellfähigkeiten.",
                  "No confirmed model capabilities yet.",
                )}
          </p>
          {notice && <p role="status">{notice}</p>}
        </div>
      </div>
      <label className="field">
        <span>
          {t(
            "Kontextfenster (Tokens, optional)",
            "Context window (tokens, optional)",
          )}
        </span>
        <input
          name="context_window_tokens"
          type="number"
          min={1}
          max={maxContext}
          value={context}
          onChange={(e) => setContext(e.target.value)}
        />
        <small>
          {caps.context_window_tokens
            ? t("Gemeldete Obergrenze: ", "Reported maximum: ") +
              caps.context_window_tokens
            : t(
                "Nicht gemeldet. Leeres Feld verwendet nur ein internes App-Budget, keine erkannte Anbietergrenze.",
                "Not reported. An empty field uses only an internal app budget, not a detected provider limit.",
              )}
        </small>
      </label>
      <label className="field">
        <span>
          {t("Ausgabe-Tokenlimit pro Aufruf", "Output token limit per call")}
        </span>
        <input
          name="max_output_tokens"
          type="number"
          required
          min={1}
          max={maxOut}
          value={output}
          onChange={(e) => setOutput(e.target.value)}
        />
        <small>
          {caps.max_output_tokens
            ? t("Gemeldete Obergrenze: ", "Reported maximum: ") +
              caps.max_output_tokens
            : t(
                "Ausgabelimit nicht gemeldet. Die App-Grenze ist kein Nachweis der Modellgrenze.",
                "Output maximum not reported. The app limit does not confirm the model limit.",
              )}{" "}
          {t(
            "Reasoning-Tokens können zum Ausgabebudget zählen. Auftragslimits gelten zusätzlich.",
            "Reasoning tokens may count towards the output budget. Task limits apply in addition.",
          )}
        </small>
      </label>
      <label className="field">
        <span>{t("Denkaufwand des Modells", "Model reasoning effort")}</span>
        <select
          name="reasoning_effort"
          value={effort}
          onChange={(e) => setEffort(e.target.value)}
        >
          {effortOptions(true)}
        </select>
        <small>
          {caps.reasoning_efforts === null ||
          caps.reasoning_efforts === undefined
            ? t(
                "Erlaubte Denkstufen nicht gemeldet. Ohne manuelle Bestätigung wird nur die Anbietervorgabe verwendet.",
                "Allowed effort levels not reported. Without manual confirmation, only provider defaults are used.",
              )
            : t(
                "Auswahl auf gemeldete Denkstufen begrenzt; manuelle Auswahl hat Vorrang vor dem Sparprofil.",
                "Choices are limited to reported effort levels; manual selection overrides the economical preset.",
              )}
        </small>
      </label>
      <label className="field">
        <span>
          {t(
            "Sparsame Automatik für dieses Modell",
            "Economical automatic preset for this model",
          )}
        </span>
        <select
          name="auto_reasoning_effort"
          value={automatic}
          onChange={(e) => setAutomatic(e.target.value)}
        >
          {effortOptions(false)}
        </select>
        <small>
          {t(
            "Gilt bei Denkaufwand Automatisch. Niedrigere Stufen können Tokens sparen. Feste Token- und Credit-Limits bleiben verbindlich.",
            "Applies to Automatic reasoning effort. Lower levels may save tokens. Fixed token and credit limits remain binding.",
          )}
        </small>
      </label>
    </>
  );
}
