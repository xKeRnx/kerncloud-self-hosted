# Firmenprofil, Mailserver und Rechtstextvorlagen

Stand der Recherche: 20.10.2026. Die Anwendung bleibt eine lokale Testumgebung. Die deutschen und englischen Vorlagen sind anpassbare Entwürfe für einen in Deutschland sitzenden SaaS-Anbieter. Sie sind keine verbindliche Einzelfallprüfung oder Zusage rechtlicher Wirksamkeit.

## Einrichtung

1. **Administration → Firma & Stammdaten**: vollständiger rechtlicher Name (beim Einzelunternehmen der Vor- und Nachname des Inhabers), ladungsfähige Anschrift, Kontakt, Rechtsform und gegebenenfalls Register, Vertretung und öffentliche Identifikationsnummern. Die normale Steuernummer bleibt aus öffentlichen Platzhaltern ausgeschlossen und wird nur für das private Rechnungsprofil verwendet. Deutschland und Kleinunternehmerregelung sind vorbelegt und änderbar, soweit technisch angeboten.
2. Tatsächliches Hosting, Empfänger einschließlich SMTP, Zahlungsdienst, KI und OAuth, Länder/Transfergarantien, Löschfristen einschließlich Backups und zuständige Aufsichtsbehörde ergänzen. Ein lokaler Container oder BYOK verhindert nicht automatisch Datenübermittlungen an das Modell. Erforderliche AV-Verträge und eine Dienstleisterliste müssen dem tatsächlichen Betrieb entsprechen.
3. **Administration → Mailserver**: SMTP-Host, Port, STARTTLS oder SMTPS, Benutzer, Passwort und Absender. Dazu öffentliche Plattform-URL in der Betreiberkonfiguration, Absenderdomain, SPF/DKIM/DMARC und tatsächliche Postfachzustellung einrichten. Die Verbindungsprüfung sendet keine Mail. Mailannahme durch SMTP ist keine Zustellgarantie. Fehlgeschlagene oder unbestätigte Sendungen prüfen; keine ungeprüfte Wiederholung.
4. **Administration → Rechtstexte**: je Seite und Sprache eine Vorlage in den Richtext-/HTML-Editor einsetzen. Firmendaten werden über eine öffentliche Platzhalter-Allowlist eingebunden. Ergänzungen und Vertragsabläufe prüfen, dann veröffentlichen. Fehlende Felder oder Platzhalter verhindern die Veröffentlichung einer Vorlage. Vorhandene individuelle Texte werden nicht ungefragt ersetzt. Firmenänderungen versionieren verknüpfte Texte und archivieren deren bisherigen gerenderten Stand; unvollständige neue Angaben setzen betroffene Veröffentlichungen auf Entwurf.
5. **Administration → Vertragserklärungen**: Kündigungen und Widerrufe zeitnah bearbeiten. Öffentliche Formulare benötigen keinen Login, speichern Eingangszeit und Erklärung und stellen einen Download bereit. Bestätigungen an den Verbraucher und Benachrichtigungen an den Betreiber werden verschlüsselt zum Versand vorgemerkt. Eine dokumentierte Bearbeitung beendet kein Stripe-Abo und löst keine Erstattung aus. Vertragszuordnung und finanzielle Abwicklung bleiben tatsächlich durchzuführen; der Zugang der Erklärung wird dadurch nicht verschoben.

## Rechnungen

Das Firmenprofil kann privat exportiert und als ausdrücklich gekennzeichnetes Rechnungsmuster heruntergeladen werden. Neue Stripe-Kunden/Buchungen übernehmen die Ausstellerangaben einschließlich des passenden Kleinunternehmerhinweises in die Rechnungsfußzeile. Bei aktiviertem Stripe und vollständigem Rechnungsprofil stellen Firmenänderungen außerdem Aktualisierungen der Rechnungsfußzeilen vorhandener Stripe-Kunden in eine Warteschlange. Verbundene Worker führen sie idempotent und nacheinander aus; der Status erscheint im Firmenbereich. Nach einem Fehler Konfiguration prüfen und das Profil erneut speichern. Veraltete, noch nicht ausgeführte Versionen werden übersprungen. Das ersetzt nicht die korrekten rechtlichen Aussteller- und Steuerdaten im Stripe-Konto. Bestehende Stripe-Rechnungen werden nicht verändert. Geschenkbelege speichern ihren damaligen öffentlichen Ausstellerstand und bleiben eigenständige 0-EUR-Belege, keine Steuerrechnungen. Eine E-Rechnungserzeugung in XRechnung/ZUGFeRD wird hierdurch nicht implementiert.

Worker verarbeiten Mail und Rechnungsprofil-Aufträge in einem separaten Wartungsaufruf, auch wenn ihre Agentenplätze belegt sind. Das ersetzt keine Überwachung der Worker-Verfügbarkeit oder tatsächlichen Mailzustellung.

Vor Live-Verkäufen prüft der Server auf vollständige Firmendaten, notwendige veröffentlichte Texte, dokumentierte Prüfung des Bestellablaufs und aktivierten SMTP-Versand. Diese Prüfungen beweisen keine Rechtskonformität. Vorvertragliche Informationen, korrekte Bestellschaltfläche, Vertragsbestätigung auf dauerhaftem Datenträger, Widerrufsbelehrung, tatsächliche Kündigungen/Erstattungen, Barrierefreiheitsanforderungen, Auftragsverarbeitung und internationale Verkäufe müssen für das konkrete Angebot geprüft und gegebenenfalls weiter umgesetzt werden. Insbesondere wird keine Verbraucherzustimmung zum sofortigen Leistungsbeginn fingiert und kein pauschaler Ausschluss des Widerrufsrechts angenommen.

## Primärquellen

- [§ 5 DDG – Anbieterkennzeichnung](https://www.gesetze-im-internet.de/ddg/__5.html)
- [Art. 13 DSGVO – Informationspflichten](https://eur-lex.europa.eu/legal-content/DE/TXT/?uri=CELEX:32016R0679)
- [§ 312k BGB – Kündigungsschaltfläche](https://www.gesetze-im-internet.de/bgb/__312k.html)
- [§ 356a BGB – elektronische Widerrufsfunktion](https://www.gesetze-im-internet.de/bgb/__356a.html)
- [Art. 246a § 1 EGBGB – Verbraucherinformationen](https://www.gesetze-im-internet.de/bgbeg/art_246a__1.html)
- [§ 34a UStDV – Kleinunternehmerrechnungen](https://www.gesetze-im-internet.de/ustdv_1980/__34a.html)
- [Europäische Kommission – Einstellung der OS-Plattform](https://consumer-redress.ec.europa.eu/site-relocation_en)
- [Stripe – Kunden-Rechnungseinstellungen](https://docs.stripe.com/api/customers/update#update_customer-invoice_settings)

Die Vorlagen enthalten keinen veralteten Link zur seit Juli 2025 eingestellten OS-Plattform. Die Erklärung zur Verbraucherstreitbeilegung wird erst aus der vom Betreiber tatsächlich gewählten und geprüften Angabe erzeugt.
