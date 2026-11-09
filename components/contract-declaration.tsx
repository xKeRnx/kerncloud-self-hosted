"use client";
import { useState } from "react";
import { api } from "./api-client";
import { useLanguage } from "./language";
export function ContractDeclaration({
  kind,
  operator,
  email,
}: {
  kind: "cancel" | "withdraw";
  operator: string;
  email: string;
}) {
  const { t } = useLanguage();
  const cancel = kind === "cancel";
  const [values, setValues] = useState({
      name: "",
      email: "",
      contract: "",
      terminationType: "ordinary",
      requestedEnd: "",
      reason: "",
    }),
    [review, setReview] = useState(false),
    [result, setResult] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [id] = useState(() => crypto.randomUUID());
  const field = (
    key: keyof typeof values,
    label: string,
    type = "text",
    required = false,
  ) => (
    <label className="field">
      <span>{label}</span>
      <input
        type={type}
        value={values[key]}
        required={required}
        maxLength={key === "contract" ? 1000 : 254}
        onChange={(e) => setValues({ ...values, [key]: e.target.value })}
      />
    </label>
  );
  return (
    <section className="panel settings-panel">
      <h1>
        {cancel
          ? t("Verträge hier kündigen", "Cancel contracts here")
          : t("Vertrag widerrufen", "Withdraw from contract")}
      </h1>
      <p>
        {t("Empfänger: ", "Recipient: ")}
        {operator || t("KeRnCloud-Betreiber", "KeRnCloud operator")}
        {email && ` · ${email}`}
      </p>
      <p>
        {t(
          "Kein Login erforderlich. Es wird nicht offengelegt, ob ein Konto oder Vertrag zu einer E-Mail besteht.",
          "No sign-in required. This form does not disclose whether an email matches an account or contract.",
        )}
      </p>
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      {result ? (
        <>
          <h2>{t("Erklärung eingegangen", "Statement received")}</h2>
          <pre className="contract-statement">{result.statement}</pre>
          <p>
            {t(
              "Die Eingangsbestätigung wurde für den E-Mail-Versand vorgemerkt. Speichere zusätzlich diesen Nachweis. Der Betreiber bearbeitet die Vertragszuordnung, das Vertragsende und gegebenenfalls eine Erstattung.",
              "Your acknowledgement has been queued for email. Save this receipt as well. The operator will process contract identification, termination and any refund.",
            )}
          </p>
          <button
            className="secondary"
            onClick={() => {
              const u = URL.createObjectURL(
                new Blob([result.statement], {
                  type: "text/plain;charset=utf-8",
                }),
              );
              const a = document.createElement("a");
              a.href = u;
              a.download = `kerncloud-${kind}-${result.id}.txt`;
              a.click();
              URL.revokeObjectURL(u);
            }}
          >
            {t("Nachweis herunterladen", "Download receipt")}
          </button>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError("");
            if (!review) {
              setReview(true);
              return;
            }
            setBusy(true);
            void api("contracts/declarations", { id, kind, ...values })
              .then(setResult)
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          {!review ? (
            <div className="form-grid">
              {field(
                "name",
                t("Vollständiger Name", "Full name"),
                "text",
                true,
              )}
              {field(
                "email",
                t(
                  "E-Mail für die Eingangsbestätigung",
                  "Email for acknowledgement",
                ),
                "email",
                true,
              )}
              {field(
                "contract",
                t(
                  "Vertrag / Bestellnummer / eindeutig bezeichnete Leistung",
                  "Contract / order reference / clearly identified service",
                ),
                "text",
                true,
              )}
              {cancel && (
                <>
                  <label className="field">
                    <span>
                      {t("Art der Kündigung", "Type of cancellation")}
                    </span>
                    <select
                      value={values.terminationType}
                      onChange={(e) =>
                        setValues({
                          ...values,
                          terminationType: e.target.value,
                        })
                      }
                    >
                      <option value="ordinary">
                        {t("Ordentlich", "Ordinary")}
                      </option>
                      <option value="extraordinary">
                        {t("Außerordentlich", "Extraordinary")}
                      </option>
                    </select>
                  </label>
                  {field(
                    "requestedEnd",
                    t(
                      "Gewünschtes Vertragsende (leer = nächstmöglich)",
                      "Requested contract end (empty = earliest possible)",
                    ),
                  )}
                  <label className="field">
                    <span>
                      {t(
                        "Kündigungsgrund (bei außerordentlicher Kündigung)",
                        "Reason (for extraordinary cancellation)",
                      )}
                    </span>
                    <textarea
                      value={values.reason}
                      required={values.terminationType === "extraordinary"}
                      maxLength={2000}
                      onChange={(e) =>
                        setValues({ ...values, reason: e.target.value })
                      }
                    />
                  </label>
                </>
              )}
            </div>
          ) : (
            <>
              <h2>{t("Deine Erklärung prüfen", "Review your statement")}</h2>
              <dl className="customer-dates">
                <dt>{t("Name", "Name")}</dt>
                <dd>{values.name}</dd>
                <dt>E-Mail</dt>
                <dd>{values.email}</dd>
                <dt>{t("Vertrag", "Contract")}</dt>
                <dd>{values.contract}</dd>
                {cancel && (
                  <>
                    <dt>
                      {t("Art / gewünschtes Ende", "Type / requested end")}
                    </dt>
                    <dd>
                      {values.terminationType} ·{" "}
                      {values.requestedEnd ||
                        t("nächstmöglich", "earliest possible")}
                    </dd>
                    <dt>{t("Grund", "Reason")}</dt>
                    <dd>{values.reason || "–"}</dd>
                  </>
                )}
              </dl>
              <p>
                {cancel
                  ? t(
                      "Mit „jetzt kündigen“ gibst du deine Kündigungserklärung ab.",
                      "Clicking “Cancel now” submits your cancellation statement.",
                    )
                  : t(
                      "Mit „Widerruf bestätigen“ gibst du deine Widerrufserklärung ab.",
                      "Clicking “Confirm withdrawal” submits your withdrawal statement.",
                    )}
              </p>
              <button
                type="button"
                className="text-button"
                onClick={() => setReview(false)}
              >
                {t("Angaben korrigieren", "Correct details")}
              </button>
            </>
          )}
          <button className="primary" disabled={busy}>
            {busy
              ? t("Wird übermittelt …", "Submitting …")
              : review
                ? cancel
                  ? t("jetzt kündigen", "Cancel now")
                  : t("Widerruf bestätigen", "Confirm withdrawal")
                : t("Angaben prüfen", "Review details")}
          </button>
        </form>
      )}
    </section>
  );
}
