"use client";
import { useLanguage } from "./language";
import { useEffect, useState } from "react";
import { api } from "./api-client";
export function AdminRuntimeBilling() {
  const { ui, localeTag } = useLanguage();

  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const load = () => api("admin/runtime").then(setData);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  async function save(body: unknown) {
    setBusy(true);
    setError("");
    try {
      await api("admin/runtime", body);
      await load();
      setNotice(ui("Laufzeitabrechnung gespeichert."));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!data) return <p>{error || ui("Laufzeitabrechnung wird geladen …")}</p>;
  return (
    <section className="panel settings-panel">
      <h2>{ui("Containerabrechnung & Laufzeitpakete")}</h2>
      <p>
        {ui(
          "In den Plänen legst du Plätze, gleichzeitige Umgebungen, enthaltene Minuten und erlaubte Vorlagen fest. Der Minutenfaktor steht an der jeweiligen Container-Vorlage. Laufzeitguthaben ist von KI-Credits getrennt.",
        )}
      </p>
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {[
        ...data.products,
        {
          id: "",
          name: "",
          minutes: 300,
          price_cents: 500,
          stripe_price_id: null,
          active: false,
        },
      ].map((p: any) => (
        <details key={p.id || "new"}>
          <summary>{p.name || ui("Neues Laufzeitpaket")}</summary>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void save({
                action: "product",
                id: f.get("id"),
                name: f.get("name"),
                minutes: Number(f.get("minutes")),
                price_cents: Math.round(Number(f.get("price")) * 100),
                stripe_price_id: f.get("stripe_price_id") || null,
                active: f.get("active") === "on",
              });
            }}
          >
            <div className="form-grid">
              {[
                ["id", ui("Paket-ID"), p.id],
                ["name", ui("Anzeigename"), p.name],
                [
                  "stripe_price_id",
                  ui("Stripe Price-ID"),
                  p.stripe_price_id ?? "",
                ],
              ].map(([name, label, value]) => (
                <label className="field" key={name}>
                  <span>{label}</span>
                  <input
                    name={name}
                    defaultValue={value}
                    required={name !== "stripe_price_id"}
                    readOnly={name === "id" && !!p.id}
                  />
                </label>
              ))}
              <label className="field">
                <span>{ui("Laufzeit-Minuten")}</span>
                <input
                  type="number"
                  name="minutes"
                  min={1}
                  max={1000000}
                  defaultValue={p.minutes}
                  required
                />
              </label>
              <label className="field">
                <span>{ui("Preis (€)")}</span>
                <input
                  type="number"
                  name="price"
                  min={0.01}
                  step="0.01"
                  defaultValue={p.price_cents / 100}
                  required
                />
              </label>
            </div>
            <label className="check-row">
              <input type="checkbox" name="active" defaultChecked={p.active} />
              {ui("Paket anbieten")}
            </label>
            <p className="form-note">
              {ui(
                "Stripe-Preis, Währung EUR und Paketpreis müssen übereinstimmen. Die Gutschrift folgt ausschließlich dem signierten Zahlungsereignis und einer geprüften Checkout-Position.",
              )}
            </p>
            <button className="primary" disabled={busy}>
              {ui("Paket speichern")}
            </button>
          </form>
        </details>
      ))}
      <details>
        <summary>{ui("Guthaben korrigieren / lokal testen")}</summary>
        <p>
          {ui(
            "Betreiberkorrekturen erzeugen keine Zahlung und keine Rechnung.",
          )}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void save({
              action: "grant",
              workspaceId: f.get("workspace"),
              seconds: Math.round(Number(f.get("minutes")) * 60),
            });
          }}
        >
          <label className="field">
            <span>{ui("Konto")}</span>
            <select name="workspace">
              {data.accounts.map((a: any) => (
                <option key={a.id} value={a.workspace_id}>
                  {a.email}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{ui("Minuten hinzufügen / abziehen")}</span>
            <input
              type="number"
              name="minutes"
              defaultValue={0}
              min={-1000000}
              max={1000000}
              required
            />
          </label>
          <button className="secondary" disabled={busy}>
            {ui("Korrektur buchen")}
          </button>
        </form>
      </details>
      <h3>{ui("Kontoguthaben")}</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{ui("Konto")}</th>
              <th>{ui("Plan-Minuten")}</th>
              <th>{ui("Gekauft")}</th>
              <th>{ui("Korrektur offen")}</th>
            </tr>
          </thead>
          <tbody>
            {data.accounts.map((a: any) => (
              <tr key={a.id}>
                <td>{a.email}</td>
                <td>{a.runtime_included / 60}</td>
                <td>{a.runtime_purchased / 60}</td>
                <td>{a.runtime_debt / 60}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
