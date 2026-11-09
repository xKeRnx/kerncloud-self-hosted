import { requestLanguage } from "@/src/server/request-language";
import { ensureDb } from "@/src/server/db";
export default async function Privacy() {
  await ensureDb();
  if ((await requestLanguage()) === "en")
    return (
      <main className="legal-page">
        <a href="/">← Back to KeRnCloud</a>
        <h1>Privacy notice for the local test environment</h1>
        <p>
          Updated 19 October 2026. This is a development environment on your
          computer. This technical description does not replace a privacy policy
          tailored to a public SaaS service.
        </p>
        <h2>Data processed</h2>
        <p>
          The application stores account details, encrypted provider
          credentials, agent settings, skills, connected services, tasks,
          messages, results, usage and administration logs. Passwords are hashed
          with scrypt. Sign-in requires an HttpOnly session cookie. A preference
          cookie remembers a deliberately selected website language.
        </p>
        <h2>AI providers and external services</h2>
        <p>
          Job content is sent to the configured AI provider and, where
          applicable, approved MCP services. For managed AI access, the operator
          chooses the provider. A local server location does not determine where
          external services process data.
        </p>
        <h2>Your controls</h2>
        <p>
          Signed-in users can export their data as JSON, change retention
          periods, choose whether to receive marketing updates and delete
          ordinary customer accounts. Deletion removes associated data from the
          active database. Backups require a separate documented deletion or
          cleanup process. Optional usage analytics needs consent and can be
          declined through Cookie settings.
        </p>
        <h2>Before public operation</h2>
        <p>
          The controller, contact details, legal bases, processing agreements,
          providers, processing locations, retention periods, data subject
          rights, security, payments and any international transfers must be
          established and reviewed for the actual service. This version does not
          provide email verification, password recovery or legally verified
          invoicing.
        </p>
        <h2>Contact</h2>
        <p>
          During local testing, contact the person operating this installation.
          Complete operator and contact information must be supplied before
          publication.
        </p>
      </main>
    );
  return (
    <main className="legal-page">
      <a href="/">← Zurück zu KeRnCloud</a>
      <h1>Datenschutzhinweise zur lokalen Testumgebung</h1>
      <p>
        Stand: 19. Oktober 2026. Dies ist eine Entwicklungsumgebung auf deinem
        Rechner. Diese Hinweise sind eine technische Beschreibung und ersetzen
        keine auf einen öffentlichen SaaS-Betrieb abgestimmte
        Datenschutzerklärung.
      </p>
      <h2>Verarbeitete Daten</h2>
      <p>
        Gespeichert werden Kontodaten, verschlüsselte Anbieter-Zugangsdaten,
        Agentenkonfigurationen, Skills, verbundene Dienste, Aufträge,
        Nachrichten, Arbeitsergebnisse, Nutzung und Verwaltungsprotokolle.
        Passwörter werden mit scrypt gehasht. Sitzungen verwenden ein
        HttpOnly-Cookie, das für die Anmeldung erforderlich ist. Eine gewählte
        Sprache wird in einem Präferenz-Cookie gemerkt. Bei aktivierter 2FA wird
        das Authenticator-Geheimnis verschlüsselt gespeichert;
        Wiederherstellungscodes werden nur gehasht hinterlegt. Externe
        Anmeldedienste speichern die Zuordnung ihrer bestätigten Identität zum
        Konto.
      </p>
      <h2>KI-Anbieter und externe Dienste</h2>
      <p>
        Bei einem Auftrag werden die dafür verwendeten Inhalte an den
        konfigurierten KI-Anbieter und gegebenenfalls an freigegebene
        MCP-Dienste übertragen. Bei verwaltetem KI-Zugang bestimmt der Betreiber
        den Anbieter. Die Auswahl eines lokalen Serverstandorts legt nicht
        automatisch die Verarbeitungsorte dieser Dienste fest.
      </p>
      <h2>Deine Kontrollen</h2>
      <p>
        Im angemeldeten Workspace stehen ein JSON-Datenexport, die Änderung der
        Aufbewahrungsfrist, eine freiwillige Marketing-Einstellung und die
        Löschung gewöhnlicher Kundenkonten zur Verfügung. Eine Kontolöschung
        entfernt zugehörige Daten aus der aktiven Datenbank. Backups müssen
        separat nach einem dokumentierten Ablauf gelöscht oder bereinigt werden.
      </p>
      <h2>Vor einem öffentlichen Betrieb</h2>
      <p>
        Verantwortlicher und Kontakt, Rechtsgrundlagen, Auftragsverarbeitung,
        Anbieter und Verarbeitungsorte, Aufbewahrungsfristen, Betroffenenrechte,
        Sicherheit, Zahlungsabwicklung und gegebenenfalls internationale
        Datenübermittlungen müssen konkret festgelegt und geprüft werden. Diese
        Version bietet keine E-Mail-Verifizierung, Passwort-Wiederherstellung,
        oder rechtsverbindliche Rechnungsstellung.
      </p>
      <h2>Kontakt</h2>
      <p>
        In der lokalen Testumgebung ist die Person, die diese Installation
        betreibt, dein Ansprechpartner. Vor Veröffentlichung müssen hier
        vollständige Betreiber- und Kontaktinformationen hinterlegt werden.
      </p>
    </main>
  );
}
