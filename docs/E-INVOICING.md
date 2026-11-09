# E-Rechnungen: Einrichtung und Grenzen

Stand: 20.10.2026. Lokale XRechnung- und ZUGFeRD/Factur-X-Erzeugung, ohne externen Dokumentendienst. Originale und Rechnungsdaten sind mandantengetrennt; gespeicherte Dokumente, Formate und Prüfberichte werden verschlüsselt. Dokumentdateien selbst sind für PDF/A unverschlüsselt und über authentifizierte Downloads verfügbar.

## Betrieb

1. Unter **Administration → Firma & Stammdaten** vollständige Ausstellerangaben, Kontakt inklusive Telefon und Steuernummer oder USt-IdNr. eintragen. Die normale Steuernummer wird nur auf Rechnungen und im privaten Rechnungsprofil verwendet. Sie ist kein öffentlicher Rechtstext-Platzhalter.
2. Aktuell unterstützte Fälle: Aussteller Deutschland, Empfänger Deutschland, EUR, inländische Dienstleistungen mit **Kleinunternehmerbefreiung nach § 19 UStG** oder **19 % Umsatzsteuer**. Steuerbefreite Positionen verwenden Kategorie E mit Befreiungsgrund, keine fingierte Umsatzsteuer-ID. Die Lieferantenkennung entspricht der vorhandenen steuerlichen Ausstellerkennung. Für öffentliche Auftraggeber muss die tatsächlich mitgeteilte Leitweg-ID als Käuferreferenz erfasst werden. Eine allgemeine Kontokennung ersetzt keine vom Auftraggeber geforderte Leitweg-ID.
3. Kunden pflegen unter **Rechnungen → Rechnungsempfänger** Name, Anschrift, E-Mail und Käuferreferenz. Änderungen gelten für neue manuelle Rechnungen. Stripe übernimmt verbindliche Empfängerdaten aus seinem eigenen Checkout/Kundenportal; Daten dort ebenfalls pflegen.
4. Unter **Administration → E-Rechnungen** Kundenkonto wählen, Leistungen, Nettopreise, Mengen, Zeitraum, Fälligkeit und Zahlungsanweisung eintragen. Eine PDF-Vorschau ist ausdrücklich ein Muster und wird nicht im Rechnungsarchiv ausgestellt. Die verbindliche Erstellung verlangt Admin-Nachweis, Begründung und erneute Empfängerbestätigung. Sie löst keine Zahlung aus und legt kein Abo an. Keine manuelle zweite Rechnung für einen bereits von Stripe fakturierten Umsatz ausstellen.
5. Verbundene Worker erzeugen und prüfen Dateien. Nur nach erfolgreicher Prüfung wechselt ein Dokument auf `issued`. Der Kunde kann anschließend **ZUGFeRD PDF** oder **XRechnung XML** herunterladen. Beide stammen aus demselben eingefrorenen Rechnungsdatensatz. Bei Fehlern bleibt der Download gesperrt; der Admin kann den Prüfbericht laden und unveränderte fehlgeschlagene Vorgänge bis zu fünfmal erneut prüfen. Ungültige Daten durch einen neuen Vorgang korrigieren, keine alten Rechnungsdaten umschreiben.

## Formate und Prüfung

- XRechnung **3.0.2**, CII-Syntax, KoSIT Validator **1.6.3**, Konfiguration **2026-08-31**. Schema- und Geschäftsregeln werden lokal geprüft.
- ZUGFeRD/Factur-X im vollständigen **EN 16931**-Profil: eingebettete `factur-x.xml`, zugehörige XMP-Metadaten und PDF/A-3. Mustang **2.26.0** kombiniert und validiert die Datei, einschließlich veraPDF-Prüfung des PDF/A-Teils und XML-Regelprüfung. Kein Minimal-/BASIC-WL-Profil.
- PDFKit mit eingebetteten Noto-Sans-Schriften erstellt die visuelle Darstellung. XML und PDF werden aus denselben Daten erzeugt; ihre fachliche Richtigkeit hängt von korrekten Stammdaten und Leistungsangaben ab.
- Nicht abbildbare Schriftzeichen werden erkannt und blockieren die Ausgabe, statt im PDF stillschweigend zu verschwinden. Derzeit wird die lateinische Noto-Sans-Abdeckung verwendet; zusätzliche Schriftsysteme benötigen passende geprüfte Schriften.
- Werkzeuge sind versioniert und per SHA-256 dokumentiert unter `vendor/einvoice/provenance.json`. Updates der Standards/Prüfwerkzeuge müssen bewusst mit Regressionstests erfolgen. Die Dateien werden nicht an öffentliche Online-Validatoren hochgeladen.
- Docker enthält Java. Die Ausgabeprüfung läuft jeweils einmal gleichzeitig, mit 256 MiB Java-Heap und Zeitlimits; mehrere Plattform-Worker erzeugen keine Doppelrechnung. Für Entwicklung außerhalb Docker wird zusätzlich eine funktionierende lokale Java-Laufzeit benötigt.

## Wechsel der Umsatzsteuerregelung

Die Firmenauswahl gilt für **neu vorbereitete** manuelle Rechnungen. Regelbesteuerung schlägt bei den unterstützten Leistungen 19 % auf die angegebenen Nettopreise auf. Bereits vorgemerkte oder ausgestellte Rechnungen behalten ihren ursprünglichen Aussteller, Steuerstand und Betrag. Ein Storno verwendet den Stand der Originalrechnung. Zeitpunkt und fachliche Voraussetzungen eines steuerlichen Wechsels sind vom Betreiber festzulegen. Preise, Brutto-/Nettoauszeichnung und Stripe Tax separat abstimmen; die Firmenauswahl ändert keine Stripe-Preise oder steuerliche Registrierung.

## Stripe

Signierte Invoice-Webhooks speichern einen Prüfauftrag mit den vollständigen übermittelten Rechnungsdaten und dem damaligen Firmenprofil. Unterstützte vollständige Inlandsrechnungen werden **mit derselben Stripe-Rechnungsnummer** ergänzt. Der Import verlangt passende Original-Fußzeile, vollständige Empfänger-/Positions-/Leistungsdaten und centgenaue Übereinstimmung von Netto, Steuer und Gesamtbetrag. Fehlende Positionen bei Pagination, abweichende Steuerfälle, Guthabensalden, Versand oder Gutschriften werden blockiert und im Adminpanel angezeigt. Es wird dann keine angeblich gültige Datei ausgegeben; die Stripe-Originalrechnung bleibt verfügbar. Es werden weder zusätzliche Zahlungen noch nachträgliche Änderungen der Originalrechnung ausgelöst. Bereits früher gespeicherte unvollständige Rechnungen werden nicht aus aktuellen Plandaten rekonstruiert.

Stripe-Gutschriften/Korrekturen sind über Stripe zu erstellen. Der lokale Vollstorno ist nur für manuell erzeugte Rechnungen verfügbar, einmal pro Ursprung, mit eigener Nummer und Originalreferenz. Eine Erstattung muss gesondert abgewickelt werden. Teilkorrekturen, internationale Umsatzsteuerfälle, OSS und Reverse Charge sind hier nicht implementiert.

## Aufbewahrung und Sicherung

Ausgestellte Rechnungen werden durch Datenbankregeln gegen nachträgliche Inhaltsänderung und normale Löschung geschützt. Die Mindestaufbewahrung wird bis zum Ende des achten Folgejahres vermerkt; längere gesetzliche oder verfahrensbedingte Fristen müssen zusätzlich berücksichtigt werden. Es gibt keine automatische Fristlöschung. Bei Kontolöschung wird die Kontozuordnung entfernt; die erforderlichen Belege bleiben nur im Betreiberarchiv zugänglich. Dies ersetzt kein vollständig geprüftes GoBD-Verfahren, Verfahrensdokumentation oder extern manipulationssicheres Archiv. Datenbank **und ENCRYPTION_KEY** müssen gesichert werden, sonst sind Dokumente nicht wiederherstellbar. Zugriffsberechtigungen und Rücksicherung regelmäßig prüfen.

## Primärquellen

- [KoSIT: geltender Standard und Komponenten](https://xeinkauf.de/xrechnung/)
- [KoSIT Prüfkonfiguration 2026-08-31](https://github.com/itplr-kosit/validator-configuration-xrechnung/releases/tag/v2026-08-31)
- [Mustang 2.26.0](https://github.com/ZUGFeRD/mustangproject/releases/tag/core-2.26.0)
- [FeRD: ZUGFeRD 2.5.2](https://www.ferd-net.de/publikationen-produkte/publikationen/detailseite/zugferd-252-deutsch)
- [§ 34a UStDV: Kleinunternehmerrechnungen](https://www.gesetze-im-internet.de/ustdv_1980/__34a.html)
- [§ 14b UStG: Aufbewahrung](https://www.gesetze-im-internet.de/ustg_1980/__14b.html)

Formatkonformität ersetzt keine Prüfung der tatsächlichen Steuer-, Leistungs- und Empfängerdaten. Testdateien in `output/pdf` sind ausdrücklich mit TESTDATEN gekennzeichnet und keine Rechnungen über einen realen Umsatz.
