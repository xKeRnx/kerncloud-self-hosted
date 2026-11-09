# Kundenverwaltung

Unter **Administration → Kunden** stehen Suche, Status-/Planfilter und eine paginierte Liste bereit. Details sind nach Übersicht, Zugang/Support, Abo/Geschenke und Verlauf gegliedert. Aktionen benötigen eine Begründung; Änderungen an Zugang, Rollen, Guthaben und Kontaktdaten zusätzlich das eigene Admin-Passwort und gegebenenfalls einen frischen 2FA-Code. Bei rein externem Admin-Login gilt die vor höchstens zehn Minuten bestätigte Anmeldung, zusätzlich zur eingerichteten 2FA. Administratoren ändern ihr eigenes Passwort im Profil. Bootstrap-Admin-Adressen werden hier nicht verändert.

## Einladungen und Passwörter

Einladungen erstellen ein inaktives Kundenkonto. Der Kunde aktiviert es selbst, bestätigt die Datenschutzhinweise und legt ein Passwort fest. Reset-/Einladungslinks sind zufällig, einmalig, 30 Minuten gültig und serverseitig nur gehasht gespeichert. Der Token steht im URL-Fragment; die Reset-Seite entfernt dieses aus der Browseradresse. Manuelle Links werden nur bei ihrer Erzeugung angezeigt. Ein neuer Link widerruft den alten. Abgelaufene oder gesperrte Konten können nicht durch einen alten Link aktiviert werden.

Direkt gesetzte Passwörter müssen mindestens zwölf Zeichen haben. Standardmäßig muss der Kunde sie nach dem Login ändern, bevor er Workspace-Daten erhält. Alte Sitzungen, offene Reset-Links und Supportzugänge werden widerrufen. Passwortänderungen schalten vorhandene 2FA nicht aus. Eine gesonderte 2FA-Notfallrücksetzung verlangt die genaue Kunden-E-Mail und eine administrative Begründung. Sie ersetzt keine eigene Prüfung der Kundenidentität.

## SMTP

Der aufklappbare Mailbereich konfiguriert SMTP mit STARTTLS oder SMTPS. Zugangsdaten werden verschlüsselt gespeichert; Konfigurationsabfragen geben das Passwort nicht zurück. Eine Verbindungsprüfung authentifiziert am Mailserver, verschickt aber keine Testmail. Unverschlüsseltes SMTP ist nur bei explizit erlaubten lokalen Endpunkten und einem Loopback-Host verfügbar.

Ausgehende Reset-Mails liegen kurzzeitig verschlüsselt in einer Warteschlange. Verbundene KeRnCloud-Worker verarbeiten diese über die Plattform. Pro Mail wird genau ein Versandversuch beansprucht. Bei einem unbestätigten Ergebnis erfolgt keine automatische Wiederholung; ein neuer Reset-Link kann erzeugt werden. Erfolgreich angenommene Nachrichten verlieren ihren gespeicherten Inhalt. „sent“ bedeutet SMTP-Annahme, keine garantierte Postfachzustellung. Mailmetadaten werden nach 30 Tagen bereinigt. Auf der produktiven Installation müssen öffentlicher HTTPS-Link, Absenderdomain, SMTP-Anmeldung und tatsächliche Zustellung eingerichtet und geprüft werden. Ohne Konfiguration wird kein echter Mailversand behauptet. SMTP-Optionen orientieren sich an der [Nodemailer-Dokumentation](https://nodemailer.com/smtp); Reset-Prinzipien an der [OWASP-Empfehlung](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).

## Supportzugang

Der eigene Admin-Login bleibt erhalten. Ein zusätzliches, an diese Admin-Sitzung gebundenes Supportticket gilt maximal 15 Minuten. Standard ist Lesemodus. Optional kann der Admin Workspace-Arbeit bearbeiten; neue Aufträge können dann vorhandene Kundenkontingente verbrauchen. Zahlungsaktionen, Kontosicherheit, Zugangsschlüssel, neue Verbindungen und Datenlöschung bleiben in beiden Modi serverseitig gesperrt. Der Support darf keine fremden Workspaces auswählen. Sichtbarer Banner, Start/Ende und Schreibaktionen machen den Zugang nachvollziehbar. Ein Widerruf der Admin-Elternsitzung widerruft den Supportzugang. Auch ein abgelaufener oder ungültiger Supportmodus kann über den Banner verlassen werden. Der verbleibende Cookie ist nach Ticketablauf ausschließlich ein Hinweis zum Beenden, kein weiter gültiger Kundenzugang.

## Laufzeiten, Geschenke und Kulanz

KeRnCloud-Zugangsfristen werden serverseitig für Modellaufrufe, laufende Leases und Kundenumgebungen geprüft. Bestehende Daten, Konto und Belege bleiben zugänglich. Ein früher abgelaufener Dienst wird bei einer Verlängerung nicht still mit unbekannten externen Aktionen fortgesetzt.

Manuelle Plan-/Statusänderungen erzeugen keine Zahlung oder Rechnung. Stripe-Plan und Stripe-Zahlungsstatus werden nicht lokal überschrieben. Aktueller Stripe-Abrechnungszeitraum und eine gemeldete Kündigung werden aus Webhooks übernommen. Eine zusätzliche lokale Zugangsfrist ändert **keine Stripe-Abbuchung**; echte Kündigung und Zahlungsplan werden weiterhin separat bei Stripe verwaltet. Ein neues aktives Stripe-Abo ersetzt vorherige Geschenk-/Testfristen, sofern kein ausdrückliches manuelles Zugangslimit gesetzt wurde.

Geschenke und Kulanz werden als unveränderliche 0-EUR-Buchungen mit stabiler Buchungs-ID erfasst. Wiederholungen derselben Anfrage verdoppeln das Guthaben nicht; eine geänderte Anfrage mit gleicher ID wird abgewiesen. Planfreischaltung, einmalige KI-Credits und Laufzeit-Minuten sind getrennt. Geschenkpläne benötigen ein zukünftiges Ende; aktive Stripe-Pläne können dadurch nicht überschrieben werden. Bestehende Monatsaufrufkontingente werden nicht zurückgesetzt. Positive Laufzeitgutschriften gleichen zunächst vorhandene Laufzeitschulden aus. Negative Korrekturen dürfen den verfügbaren Saldo nicht unter null bringen.

Standardmäßig entsteht keine Kundenrechnung. Optional kann ein separater Geschenk-/Kulanzbeleg heruntergeladen werden. Er zeigt 0,00 EUR, enthält keine ausgewiesene Umsatzsteuer und ist ausdrücklich **keine Steuerrechnung, keine Rechnungskorrektur und keine steuerliche Gutschrift**. Bestehende Rechnungen werden nicht verändert. Eine echte Korrektur bezahlter Stripe-Rechnungen ist ein anderer Vorgang; siehe [Stripe Credit Notes](https://docs.stripe.com/invoicing/credit-notes). Die tatsächliche steuerliche Behandlung des konkreten Betriebs muss gesondert geprüft werden.

Interne Notizen erscheinen nicht im gewöhnlichen Kundendashboard. Der eigene Datenauszug enthält jedoch die zum Konto gespeicherten Verwaltungsnotizen, Supportzugriffe, kostenlosen Buchungen und Mailmetadaten; niemals Passwort-Hashes, Reset-Token, SMTP-Passwörter oder Sitzungsschlüssel. Die Umsetzung ersetzt keine rechtliche Prüfung des realen SaaS-Betriebs.
