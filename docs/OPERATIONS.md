# Betrieb vor Veröffentlichung

## Lokale Grenzen

App und Datenbank sind ausschließlich auf Loopback veröffentlicht. Optionale eigene Nutzungsanalyse und Stripe sind standardmäßig deaktiviert; keine externen Werbetracker. Analyse erfasst erst nach Einwilligung begrenzte Nutzungsdaten. Details stehen in UPDATE-0.2.md. Die Anmeldung verwendet ein erforderliches Session-Cookie; die Workspace-Auswahl ein weiteres notwendiges Cookie. Provider-Schlüssel, Stripe-Schlüssel und MCP-Tokens sind mit AES-256-GCM verschlüsselt; `.env` und deren ENCRYPTION_KEY müssen getrennt von Datenbank-Backups sicher verwahrt werden. Ohne diesen Schlüssel können gesicherte Zugangsdaten nicht wiederhergestellt werden.

Die lokale Container-Selbstverwaltung und der geschützte HTTP-/WebSocket-Zugang sind umgesetzt. Konfiguration und offene Betriebsgrenzen: [CUSTOMER-ENVIRONMENTS.md](CUSTOMER-ENVIRONMENTS.md). Laufzeit-Minuten sind von KI-Credits getrennt; gestoppte Umgebungen belegen weiterhin Platz und Speicher.

## Vor echtem SaaS-Betrieb

- Verantwortlichen, Kontakt, Impressum, Vertragsgrundlagen, Preise/Steuern, Kündigung und Datenschutzerklärung konkret festlegen.
- Verträge zur Auftragsverarbeitung für Hosting, E-Mail, Modelle, Telefonie und weitere Dienste prüfen; Datenflüsse und Verarbeitungsorte dokumentieren.
- Zugangswiederherstellung, E-Mail-Verifizierung, verpflichtende Nutzung der vorhandenen MFA für Admins, Rate-Limits auf Netzwerkebene, getrennte Betreiberrollen und individuelle Worker-Identitäten implementieren.
- Externe Integrationen über eine kontrollierte Egress-Schicht führen. Privaten Netzwerkzugriff standardmäßig sperren; DNS-Rebinding und Weiterleitungen berücksichtigen.
- Zahlungszugänge erst nach Prüfung der implementierten signierten, idempotenten Webhooks mit einem echten Stripe-Testkonto aktivieren. Keine Berechtigungen aus Browser-Weiterleitungen ableiten. Rechnungs-/Steuerangaben, Verlängerung, Kündigung, Erstattung und Streitfälle gesondert abnehmen.
- Kundencode ausschließlich in gesondert geprüften Sandboxes ausführen; Mandantentrennung regelmäßig prüfen.
- Die stündlich über den Healthcheck angestoßene Aufbewahrungsbereinigung überwachen und vor größerem Betrieb durch einen dedizierten Scheduler ergänzen. Audit- und Finanzdaten benötigen definierte, getrennte Fristen und eine dokumentierte Rechtsgrundlage.
- Exportvollständigkeit und Löschung samt angebundenen externen Diensten prüfen. Dokumentieren, wann gelöschte Daten aus Backups verschwinden und wie ein Restore Löschungen erneut anwendet.
- Verschlüsselte Backups auf ein anderes System, getrennte Berechtigungen, Aufbewahrungsrotation, Überwachung fehlgeschlagener Sicherungen und dokumentierte Wiederherstellungstests einrichten.
- Incident-Response, Zuständigkeiten, Ausfallalarme und Bearbeitung von Betroffenenanfragen festlegen.

## Backup im lokalen Labor

`docker compose exec -T postgres pg_dump -U kerncloud -Fc kerncloud` erzeugt einen PostgreSQL-Dump auf stdout. Bei PowerShell kann binäre Ausgabe abhängig von der Version verändert werden. Für ein zuverlässiges lokales Backup den Dump zunächst im Container schreiben und anschließend mit `docker compose cp` kopieren. Ein Backup ist erst nach erfolgreichem Restore in eine separate Datenbank verifiziert.

Keine bereits laufende produktive Datenbank mit Testdaten, Test-Wiederherstellungen oder `down -v` überschreiben.
