import type { Company } from "./company.ts";
export type LegalKey =
  "impressum" | "datenschutz" | "agb" | "cookies" | "widerruf";
export const legalTemplateVersion = "2026-10-20";
export function legalTemplate(key: LegalKey, locale: "de" | "en", c: Company) {
  const en = locale === "en",
    p = (de: string, english: string) => `<p>${en ? english : de}</p>`,
    h = (de: string, english: string) => `<h2>${en ? english : de}</h2>`;
  const contact =
    p("{{company.identity}}", "{{company.identity}}") +
    p(
      "E-Mail: {{company.email}}<br>Telefon: {{company.phone}}<br>Website: {{company.website}}",
      "Email: {{company.email}}<br>Phone: {{company.phone}}<br>Website: {{company.website}}",
    );
  let content = "";
  if (key === "impressum")
    content =
      h("Angaben gemäß § 5 DDG", "Provider information under section 5 DDG") +
      contact +
      p("{{company.registration}}", "{{company.registration}}") +
      h("Verbraucherstreitbeilegung", "Consumer dispute resolution") +
      p("{{company.dispute}}", "{{company.dispute}}");
  if (key === "datenschutz")
    content =
      h(
        "1. Verantwortlicher und Datenschutzkontakt",
        "1. Controller and privacy contact",
      ) +
      contact +
      p(
        "Datenschutzanfragen: {{company.privacyEmail}}<br>{{company.dpo}}",
        "Privacy requests: {{company.privacyEmail}}<br>{{company.dpo}}",
      ) +
      h(
        "2. Website, Sicherheit und Konto",
        "2. Website, security and account",
      ) +
      p(
        "Beim Aufruf können technisch notwendige Verbindungsdaten, insbesondere IP-Adresse, Zeitpunkt, angeforderte Ressource und Fehlerdaten verarbeitet werden. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO, unser Interesse an einem sicheren und funktionsfähigen Dienst. Registrierung, Anmeldung, 2FA, Support und Vertragserfüllung verarbeiten Kontakt-, Authentifizierungs-, Profil- und Vertragsdaten auf Grundlage von Art. 6 Abs. 1 lit. b DSGVO. Administrativer Supportzugriff wird begrenzt und protokolliert.",
        "Technical connection data, including IP address, timestamp, requested resource and error data, may be processed to operate and secure the website under Article 6(1)(f) GDPR. Registration, sign-in, 2FA, support and performance of the contract use contact, authentication, profile and contract data under Article 6(1)(b) GDPR. Administrative support access is limited and logged.",
      ) +
      h(
        "3. Agenten, Dateien und verbundene Dienste",
        "3. Agents, files and connected services",
      ) +
      p(
        "Aufträge, Chats, Dateien, Projektgedächtnis und Werkzeugergebnisse werden für die beauftragte Leistung verarbeitet. Inhalte können an die ausgewählten KI-Anbieter, MCP-Dienste und freigegebenen Umgebungen übermittelt werden. Eigene API-Schlüssel oder lokale Container allein verhindern nicht, dass zur Modellverarbeitung ausgewählte Inhalte an einen KI-Anbieter gelangen. Externe Aktionen erfolgen im Umfang der erteilten Berechtigungen. Für personenbezogene Daten Dritter müssen Kunden eine Rechtsgrundlage besitzen; bei Auftragsverarbeitung ist vorab ein passender Vertrag nach Art. 28 DSGVO erforderlich.",
        "Tasks, chat, files, project memory and tool results are processed to perform the requested service. Content may be transmitted to selected AI providers, MCP services and authorised environments. Using your own API key or local containers does not by itself prevent selected content from being sent to an AI provider. External actions use the permissions granted. Customers must have a legal basis for third-party personal data and arrange an appropriate Article 28 GDPR processing agreement where required.",
      ) +
      h(
        "4. Hosting, Empfänger und internationale Übermittlungen",
        "4. Hosting, recipients and international transfers",
      ) +
      p("{{company.hosting}}", "{{company.hosting}}") +
      p("{{company.processors}}", "{{company.processors}}") +
      p("{{company.transfers}}", "{{company.transfers}}") +
      h(
        "5. Zahlungen und rechtliche Pflichten",
        "5. Payments and legal obligations",
      ) +
      p(
        "Bei kostenpflichtigen Buchungen werden notwendige Vertrags- und Zahlungsdaten durch den eingerichteten Zahlungsdienst verarbeitet. Wir speichern keine vollständigen Kreditkartendaten. Grundlage sind Art. 6 Abs. 1 lit. b DSGVO und für gesetzlich erforderliche Aufbewahrung Art. 6 Abs. 1 lit. c DSGVO. Kündigungs- und Widerrufserklärungen sowie ihre Bestätigungen werden zur Vertragsabwicklung und zum Nachweis verarbeitet.",
        "For paid orders, necessary contract and payment information is processed through the configured payment service. We do not store complete card details. Processing is based on Article 6(1)(b) GDPR and Article 6(1)(c) GDPR for statutory recordkeeping. Cancellation and withdrawal statements and confirmations are processed for contract administration and evidence.",
      ) +
      h(
        "6. Cookies, Sprache und optionale Analyse",
        "6. Cookies, language and optional analytics",
      ) +
      p(
        "Erforderliche Sitzungs- und Sicherheitsinformationen dienen der angeforderten Nutzung (§ 25 Abs. 2 Nr. 2 TDDDG; Art. 6 Abs. 1 lit. b bzw. f DSGVO). Eine manuelle Sprachauswahl wird als Präferenz gespeichert. Optionale Nutzungsanalyse erfolgt nur nach Einwilligung (§ 25 Abs. 1 TDDDG, soweit anwendbar; Art. 6 Abs. 1 lit. a DSGVO). Dabei können Seiten, freigegebene Klickziele, gekürzte Referrer-Hosts, ein Bot-Hinweis und bei angemeldeten Personen die Konto-ID gespeichert werden. Die Analyse speichert keine IP-Adressen oder vollständigen User-Agents. Die Einwilligung kann über die Cookie-Einstellungen mit Wirkung für die Zukunft widerrufen werden.",
        "Necessary session and security information supports the service requested (section 25(2)(2) TDDDG; Article 6(1)(b) or (f) GDPR). A manually selected language is saved as a preference. Optional analytics requires consent (section 25(1) TDDDG where applicable; Article 6(1)(a) GDPR). It can record pages, approved click targets, shortened referrer hosts, a bot indicator and signed-in account IDs. Analytics does not store IP addresses or full user-agent strings. Consent can be withdrawn for the future through cookie settings.",
      ) +
      h("7. Speicherdauer", "7. Retention") +
      p("{{company.retention}}", "{{company.retention}}") +
      h("8. Ihre Rechte und Beschwerden", "8. Your rights and complaints") +
      p(
        "Sie haben im gesetzlichen Umfang Rechte auf Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit und Widerspruch. Bei Verarbeitung aufgrund berechtigter Interessen können Sie aus Ihrer besonderen Situation widersprechen; gegen Direktwerbung jederzeit. Einwilligungen sind für die Zukunft widerrufbar. Kontoexport und Löschanfrage finden Sie im Datenschutzbereich Ihres Profils. Zur Prüfung der Identität können angemessene Rückfragen nötig sein. Sie können sich bei einer Datenschutzaufsicht beschweren, insbesondere an Ihrem Aufenthaltsort, Arbeitsplatz oder Ort des vermuteten Verstoßes. Zuständige Aufsicht des Betreibers:<br>{{company.authority}}<br>{{company.authorityUrl}}",
        "Subject to statutory conditions, you may request access, rectification, erasure, restriction, portability and object to processing. Where processing relies on legitimate interests, you may object based on your situation; objections to direct marketing are available at any time. Consent may be withdrawn for the future. Account export and deletion requests are available in your profile privacy area. Reasonable identity checks may be needed. You may complain to a supervisory authority, particularly in your place of residence, employment or the suspected infringement. The operator’s competent authority:<br>{{company.authority}}<br>{{company.authorityUrl}}",
      ) +
      h(
        "9. Bereitstellung von Daten und automatisierte Entscheidungen",
        "9. Data requirements and automated decisions",
      ) +
      p(
        "Ohne erforderliche Konto-, Sicherheits- und Vertragsdaten kann die vereinbarte Leistung nicht erbracht werden. Optionale Analyse ist freiwillig. KI-Ausgaben sind keine verbindlichen Entscheidungen über betroffene Personen. Eine Nutzung für ausschließlich automatisierte Entscheidungen mit rechtlicher oder ähnlich erheblicher Wirkung bedarf gesonderter Prüfung und darf nicht allein auf diesen allgemeinen Dienst gestützt werden.",
        "Required account, security and contract information is necessary to provide the agreed service. Analytics is optional. AI outputs are not binding decisions about individuals. Solely automated decisions producing legal or similarly significant effects require a separate assessment and must not rely solely on this general-purpose service.",
      );
  if (key === "agb")
    content =
      h("1. Anbieter und Geltungsbereich", "1. Provider and scope") +
      contact +
      p(
        "Diese Bedingungen gelten für die Nutzung von {{company.tradingName}} durch Verbraucher (§ 13 BGB) und Unternehmer (§ 14 BGB). Individuelle Vereinbarungen und zwingende Verbraucherrechte haben Vorrang.",
        "These terms apply to use of {{company.tradingName}} by consumers and business customers. Individual agreements and mandatory consumer rights take precedence.",
      ) +
      h(
        "2. Leistung, Registrierung und Vertragsschluss",
        "2. Service, registration and contract formation",
      ) +
      p(
        "Die Plattform ermöglicht die Zusammenarbeit KI-gestützter Agenten mit Workspaces, Dateien und freigegebenen Werkzeugen. Der gebuchte Tarif bestimmt Funktionen, Kontingente und zulässige Umgebungen. Ein Benutzerkonto allein bestellt noch kein kostenpflichtiges Abonnement. Vor einer kostenpflichtigen Bestellung werden Preis, Laufzeit und Leistungsumfang angezeigt. Eingaben können bis zur verbindlichen Bestätigung korrigiert werden. Die konkreten Vertrags- und Tarifbedingungen lauten:<br>{{company.serviceTerms}}",
        "The platform supports AI agents, workspaces, files and authorised tools. The selected plan determines features, allowances and permitted environments. Creating an account alone does not order a paid subscription. Price, term and scope are shown before a paid order; entries can be corrected before binding confirmation. The specific ordering and plan conditions are:<br>{{company.serviceTerms}}",
      ) +
      h(
        "3. Preise, Kontingente und Zusatzleistungen",
        "3. Prices, allowances and additional services",
      ) +
      p(
        "{{company.taxNotice}} Kostenpflichtige Zusatzleistungen erfordern eine gesonderte Bestellung oder vorherige Freigabe im vereinbarten Budget. KI-Credits, Modellaufrufkontingente, Containerplätze und Laufzeit-Minuten sind getrennte Größen. Verbrauch, Begrenzungen und etwaige Zusatzkosten werden im Tarif und vor der Buchung ausgewiesen. Bereits verbrauchte Monatskontingente werden durch Planwechsel oder Geschenke nicht automatisch zurückgesetzt. Eigene KI-Anbieter können unabhängig eigene Kosten berechnen. Gesetzliche Erstattungsrechte bleiben unberührt.",
        "{{company.taxNotice}} Paid extras require a separate order or prior authorisation within an agreed budget. AI credits, model-call allowances, environment slots and runtime minutes are distinct. Consumption, limits and additional charges are specified in the plan and before booking. Plan changes or gifts do not automatically reset used monthly allowances. Your own AI providers may charge separately. Statutory refund rights remain unaffected.",
      ) +
      h(
        "4. Berechtigungen und zulässige Nutzung",
        "4. Permissions and acceptable use",
      ) +
      p(
        "Kunden müssen zutreffende Kontaktdaten angeben, Zugangsdaten schützen und nur Inhalte sowie Systeme verwenden, zu deren Verarbeitung oder Nutzung sie berechtigt sind. Rechtswidrige Inhalte und Handlungen sowie Angriffe auf fremde Systeme sind untersagt. Vor externen Aktionen sind Berechtigungen, Budgets und gewünschte Grenzen festzulegen. Ein Stopp kann bereits ausgelöste externe Wirkungen nicht rückgängig machen; unklare Ausführungen müssen vor Wiederholung geprüft werden. Bei konkretem Missbrauch kann der erforderliche Zugriff verhältnismäßig eingeschränkt werden; der Kunde wird soweit rechtlich zulässig informiert.",
        "Customers must provide accurate contact information, protect credentials and use only content and systems they are authorised to process or access. Unlawful content, unlawful actions and attacks against third-party systems are prohibited. Define permissions, budgets and limits before external actions. Stopping execution cannot reverse actions already triggered; uncertain execution must be checked before retrying. Proven misuse may lead to proportionate access restrictions, with notice where legally permitted.",
      ) +
      h(
        "5. Ergebnisse, Rechte und Verfügbarkeit",
        "5. Results, rights and availability",
      ) +
      p(
        "KI-Ergebnisse können unzutreffend, unvollständig oder nicht exklusiv sein und müssen vor folgenreicher Verwendung geprüft werden. Rechte Dritter können betroffen sein. Kunden behalten ihre Rechte an eingebrachten Inhalten und räumen nur die für die vereinbarte Verarbeitung notwendigen Nutzungsrechte ein. Gesetzliche Rechte an digitalen Produkten, Mängelrechte, erforderliche Aktualisierungen und ausdrücklich vereinbarte Eigenschaften bleiben unberührt. Eine besondere Verfügbarkeitszusage gilt nur, wenn sie ausdrücklich vereinbart wurde.",
        "AI outputs may be inaccurate, incomplete or non-exclusive and require review before consequential use. Third-party rights may be affected. Customers retain rights in their inputs and grant only usage rights necessary to provide the agreed service. Statutory digital-product rights, remedies, necessary updates and expressly agreed characteristics remain unaffected. Specific availability commitments apply only when expressly agreed.",
      ) +
      h(
        "6. Laufzeit, Kündigung und Widerruf",
        "6. Term, cancellation and withdrawal",
      ) +
      p(
        "Es gelten die vor Bestellung angezeigten Laufzeiten und Kündigungsbedingungen. Kündigungen sind in Textform sowie über „Verträge hier kündigen“ möglich; außerordentliche Kündigungsrechte bleiben bestehen. Verbraucher finden ihre Widerrufsinformationen und das Musterformular auf der Seite „Widerruf“. Die Online-Funktion „Vertrag widerrufen“ ist ebenfalls zugänglich. Ein sofortiger Leistungsbeginn beseitigt das Widerrufsrecht nicht pauschal. Nach Vertragsende können Daten und Belege im gesetzlich oder vertraglich vorgesehenen Umfang exportiert werden; die Datenspeicherung richtet sich nach der Datenschutzerklärung.",
        "The terms and cancellation conditions shown before ordering apply. Contracts may be cancelled in text form or using the cancellation function. Rights to terminate for cause remain unaffected. Consumer withdrawal information and the model form are provided on the withdrawal page, together with an online withdrawal function. Starting service immediately does not automatically remove withdrawal rights. Data and receipts may be exported after termination as provided by law or contract; retention follows the privacy policy.",
      ) +
      h(
        "7. Haftung und zwingende Rechte",
        "7. Liability and mandatory rights",
      ) +
      p(
        "Wir haften unbeschränkt bei Vorsatz und grober Fahrlässigkeit, Verletzung von Leben, Körper oder Gesundheit sowie nach zwingenden gesetzlichen Haftungsvorschriften und übernommenen Garantien. Bei einfacher Fahrlässigkeit haften wir für die Verletzung wesentlicher Vertragspflichten, auf deren Erfüllung regelmäßig vertraut werden darf, begrenzt auf den vorhersehbaren vertragstypischen Schaden. Im Übrigen ist die Haftung bei einfacher Fahrlässigkeit ausgeschlossen, soweit gesetzlich zulässig. Zwingende Rechte von Verbrauchern, insbesondere für digitale Produkte, werden hierdurch nicht eingeschränkt.",
        "Liability is unlimited for intent, gross negligence, injury to life, body or health, mandatory statutory liability and assumed guarantees. For ordinary negligence involving essential contractual duties, liability is limited to foreseeable damage typical of the contract. Other ordinary-negligence liability is excluded only to the extent permitted by law. Mandatory consumer rights, including digital-product rights, are not restricted.",
      ) +
      h(
        "8. Änderungen, Recht und Streitbeilegung",
        "8. Changes, governing law and disputes",
      ) +
      p(
        "Vertragsänderungen bedürfen einer wirksamen Vereinbarung oder gesetzlichen Grundlage; Schweigen allein gilt nicht als Zustimmung. Es gilt deutsches Recht unter Wahrung zwingender Verbraucherschutzvorschriften des gewöhnlichen Aufenthaltsstaats. Gesetzliche Gerichtsstände bleiben unberührt. {{company.dispute}}",
        "Contract changes require a valid agreement or statutory basis; silence alone is not consent. German law applies subject to mandatory consumer protections in the consumer’s country of habitual residence. Statutory jurisdiction remains unaffected. {{company.dispute}}",
      );
  if (key === "cookies")
    content =
      h("Erforderliche Speicherung", "Necessary storage") +
      p(
        "Sitzungs-, Sicherheits- und Workspace-Cookies ermöglichen Anmeldung, 2FA und angeforderte Funktionen. Sie werden für diese Zwecke nach § 25 Abs. 2 Nr. 2 TDDDG eingesetzt; die Verarbeitung folgt Art. 6 Abs. 1 lit. b bzw. f DSGVO.",
        "Session, security and workspace cookies enable sign-in, 2FA and requested functionality under section 25(2)(2) TDDDG and Article 6(1)(b) or (f) GDPR.",
      ) +
      h("Sprache und Analyse", "Language and analytics") +
      p(
        "Eine ausdrücklich gewählte Sprache wird als Präferenz gespeichert. Optionale Nutzungsanalyse wird erst nach Einwilligung aktiviert. Auswahl und Version der Entscheidung werden lokal gespeichert. Die Auswahl kann jederzeit über „Cookie-Einstellungen“ geändert werden. Details zu Empfängern und Speicherdauer stehen in der Datenschutzerklärung.",
        "An expressly selected language is stored as a preference. Optional analytics starts only after consent. The decision and its version are stored locally and can be changed through cookie settings. The privacy policy describes recipients and retention.",
      ) +
      p(
        "Verantwortlich: {{company.legalName}}, {{company.address}}<br>{{company.privacyEmail}}",
        "Controller: {{company.legalName}}, {{company.address}}<br>{{company.privacyEmail}}",
      );
  if (key === "widerruf")
    content =
      h("Widerruf für Verbraucher", "Consumer withdrawal") +
      p(
        "Sie können einen im Fernabsatz geschlossenen Vertrag über diese digitale Dienstleistung innerhalb von 14 Tagen ab Vertragsschluss ohne Angabe von Gründen widerrufen. Informieren Sie {{company.legalName}}, {{company.address}}, E-Mail: {{company.email}}, eindeutig über Ihren Entschluss, zum Beispiel per E-Mail oder Brief. Die rechtzeitige Absendung Ihrer Erklärung wahrt die Frist. Alternativ steht die Online-Funktion „Vertrag widerrufen“ bereit; Sie erhalten eine elektronische Eingangsbestätigung mit Inhalt, Datum und Uhrzeit.",
        "You may withdraw from a distance contract for this digital service within 14 days of concluding the contract without giving reasons. Notify {{company.legalName}}, {{company.address}}, email: {{company.email}}, clearly of your decision, for example by email or letter. Sending your statement before the deadline is sufficient. You may also use the online withdrawal function and receive an electronic acknowledgement containing the statement, date and time.",
      ) +
      h("Folgen des Widerrufs", "Effects of withdrawal") +
      p(
        "Erhaltene Zahlungen werden unverzüglich, spätestens innerhalb von 14 Tagen ab Eingang Ihrer Widerrufserklärung zurückgezahlt. Die Rückzahlung erfolgt mit demselben Zahlungsmittel, sofern nicht ausdrücklich etwas anderes vereinbart ist, ohne Rückzahlungsgebühr. Wertersatz für bereits erbrachte Dienstleistungen fällt nur an, wenn die gesetzlichen Voraussetzungen, insbesondere ein ausdrückliches Verlangen nach vorzeitigem Leistungsbeginn und eine ordnungsgemäße Belehrung, erfüllt sind. Ein Erlöschen des Widerrufsrechts wird nicht allein durch die Anmeldung oder Nutzung angenommen.",
        "Payments received are refunded without undue delay and within 14 days after receipt of your withdrawal statement, using the original payment method unless expressly agreed otherwise and without a refund fee. Compensation for services already provided applies only where statutory conditions are met, including an express request to begin early and proper information. Signing in or using the service alone is not treated as extinguishing the withdrawal right.",
      ) +
      h("Muster-Widerrufsformular", "Model withdrawal form") +
      p(
        "An {{company.legalName}}, {{company.address}}, {{company.email}}:<br>Hiermit widerrufe ich den von mir abgeschlossenen Vertrag über folgende Dienstleistung: …<br>Bestellt am: …<br>Vertrags-/Bestellnummer: …<br>Name und Anschrift des Verbrauchers: …<br>Datum: …<br>Unterschrift (nur bei Mitteilung auf Papier): …<br>Die Verwendung dieses Formulars ist freiwillig.",
        "To {{company.legalName}}, {{company.address}}, {{company.email}}:<br>I hereby give notice that I withdraw from my contract for the following service: …<br>Ordered on: …<br>Contract/order reference: …<br>Consumer’s name and address: …<br>Date: …<br>Signature (only if submitted on paper): …<br>Use of this form is optional.",
      );
  return {
    key,
    locale,
    format: "html" as const,
    content,
    templateVersion: legalTemplateVersion,
    template: true,
    published: false,
    title: {
      impressum: en ? "Legal notice" : "Impressum",
      datenschutz: en ? "Privacy policy" : "Datenschutz",
      agb: en ? "Terms" : "AGB",
      cookies: "Cookies",
      widerruf: en ? "Withdrawal" : "Widerruf",
    }[key],
  };
}
