# Prüfstand 0.37.0 · 09.11.2026

## Lokal durchgeführt

- Vollständiger Docker-Build aus dem bereinigten Checkout, ohne die bisherigen lokalen KeRnCloud-Spezial-Images vorauszusetzen.
- TypeScript-Prüfung und 135 bestehende Unit-Tests bestanden.
- Drei neue Installationsprüfungen: eigene Schlüssel je Installation, Wiederholung ohne Schlüsseländerung, Schutz vorhandener SaaS-Konfiguration und Ablehnung ungültiger Eingaben.
- Drei Desktop-Prüfungen: Navigation/Kommandogrenzen, Redaktion lokaler Geheimnisse und Autostart-Erkennung ohne nicht unterstützte Linux-API-Aufrufe.
- 201 bestehende Integrationstests im SaaS-Modus in einer getrennten `_test`-Datenbank bestanden. Ausschließlich lokale Protokoll-Fixtures, keine Aussage über einen echten externen KI-Auftrag.
- Frische Self-hosted-Instanz: ein Administrator, kostenloser aktiver Self-hosted-Plan, drei Agenten und zwei verbundene Worker. Keine Modellaufrufe, keine Plattform-Credits und keine Kosten beim KI-Anbieter.
- Öffentliche Registrierung serverseitig mit HTTP 403 gesperrt; Anmeldetoggle bei geschlossener Registrierung ausgeblendet.
- Tatsächliche Browser-Anmeldung und Dashboard geprüft; lokaler Plan sichtbar, keine Kündigungsbuttons im Footer.
- Datenbank- und Objektbackup erzeugt. Datenbank in einer zweiten `_test`-Datenbank wiederhergestellt und geprüft. Neustart erhält Konto, Agenten, Objektdatei und Konfiguration unverändert.
- Windows-NSIS-Setup, Linux-AppImage und Debian-Paket gebaut. Paketformate, Metadaten und Prüfsummen geprüft.
- Release-Hygienecheck, lokale README-Bild-/Dateilinks und getrenntes neues Git-Repository ohne Remote vorbereitet.

## Noch kein Nachweis für

- Native vollständige Windows-/Linux-Installation oder End-to-End-GUI-Abnahme auf Kundengeräten.
- macOS-Build, Notarisierung oder nativen macOS-Laufzeittest. Ein eigener Workflow für Intel und Apple Silicon ist vorbereitet.
- Signierte Desktop-Releases. Zertifikate/Konten fehlen; die gebauten lokalen Pakete sind Testartefakte.
- Produktive Cloud-Zahlungsabwicklung, Rechtssicherheit, Datenschutzkonformität, vollständige Dependency-Rechteprüfung oder Lastkapazität für eine bestimmte Nutzerzahl.

Die ursprüngliche lokale SaaS-Installation wurde nicht aktualisiert oder migriert. Öffentliche GitHub-Veröffentlichung, Registry-Upload und Release-Publishing wurden nicht ausgeführt.
