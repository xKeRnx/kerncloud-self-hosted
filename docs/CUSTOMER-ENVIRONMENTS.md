# Kundenumgebungen, geschützter Zugang und Laufzeitabrechnung

## Im lokalen System

`http://localhost:3100/environments` ist das Kundenportal für Browser und Entwicklungsumgebung. Kunden können freie Plan-Plätze selbst buchen, starten, stoppen, neu aufsetzen und entfernen. Die Kontingente gelten über alle Workspaces eines Kontos. Die Dateien bleiben beim Stoppen erhalten; Neuaufsetzen und Entfernen löschen das Arbeitsvolume nach Bestätigung mit dem Umgebungsnamen.

Im Adminpanel unter **Pläne** stehen die neuen Felder: gebuchte Plätze, gleichzeitig laufende Umgebungen, enthaltene Laufzeit-Minuten und erlaubte Vorlagen-IDs. Voreinstellungen für diese lokale Erweiterung:

| Plan     | Plätze | Gleichzeitig | Laufzeit-Minuten je Zeitraum |
| -------- | -----: | -----------: | ---------------------------: |
| Explorer |      0 |            0 |                            0 |
| Starter  |      1 |            1 |                          300 |
| Business |      3 |            2 |                         1200 |

Bestehende Planpreise und KI-Credits wurden nicht angehoben oder gekürzt. Die neuen Kontingente sind im Adminpanel veränderbar. Ein kostenloses Konto kann keine Container buchen; für einen lokalen Test kann der Betreiber im bestehenden Bereich „Konto-Pläne & Testguthaben zuweisen“ einen Testplan zuweisen. Das erzeugt keine Zahlung.

Unter **Server & Container** werden Kundenbuchungen pro Server freigegeben. Zusätzlich braucht der Connector `INFRA_ALLOW_COMMANDS=true`, eine konfigurierte Relay-Verbindung und ein vorhandenes Relay-Image. Der Host meldet diese Fähigkeit im Inventar. CPU-/RAM-Budgets und die Zahl gleichzeitig laufender Umgebungen begrenzen die Zuteilung. Ein Zugangs-Relay wird mit 0,5 CPU und 128 MiB je Umgebung mitgezählt. Laufende Ressourcenzuteilungen verwenden die gespeicherte Job-Vorlage; spätere Vorlagenänderungen dürfen keine zusätzliche Kapazität vortäuschen.

Für die vorhandene lokale Installation setzt `node --env-file=.env --env-file=.env.infrastructure --import tsx scripts/setup-customer-environments.ts` das Hostbudget auf zwei gleichzeitig laufende Umgebungen, vier CPUs und 2560 MiB; dabei werden keine Konten oder Pläne umgestellt. Der vorhandene Connector muss mit `INFRA_ALLOW_COMMANDS=true` neu gestartet werden.

Die lokale Docker-VM hat derzeit etwa 4 GiB RAM und sechs CPUs. Deshalb ist das lokale Kundenbudget bewusst kleiner als die gesamte VM. Ein Plan-Platz ist keine Garantie, dass auf einem ausgelasteten Host sofort Kapazität frei ist. Weitere Docker-Hosts können über die vorhandene Serverregistrierung ergänzt werden.

## Agenten verwenden die Umgebungen

Datei-, Terminal- und sichtbare Browserwerkzeuge sind umgesetzt. Zugriff je Umgebung und Agent freigeben: [AGENT-CONTAINERS.md](AGENT-CONTAINERS.md). Neue Freigaben sind standardmäßig leer. Ein eigenes werkzeugfähiges Modell bleibt erforderlich.

## Wie der geschützte Zugang funktioniert

Jede Umgebung öffnet sich in einem eigenen Browser-Origin, lokal beispielsweise `http://<Umgebungs-ID>.localhost:3200`. Die Plattform läuft weiterhin auf Port 3100. Inhalte aus Editor oder Browser erhalten dadurch keinen Zugriff auf den Konto-Origin der SaaS-Anwendung.

Der Öffnen-Button verlangt eine angemeldete Sitzung und den richtigen Workspace. Er erzeugt ein einmaliges, 45 Sekunden gültiges Ticket. Der Gateway tauscht es gegen ein hostgebundenes HttpOnly-Zugangscookie mit maximal acht Stunden Laufzeit. Es bleibt an die ursprüngliche Plattform-Sitzung und die konkrete Container-Generation gebunden. Abmelden, Kontosperre, 2FA-bedingter Sitzungswiderruf, Stoppen, Neuaufsetzen, fehlende Planberechtigung und leeres Guthaben sperren den Zugang. WebSocket-Verbindungen werden spätestens bei der nächsten Statusprüfung nach ungefähr zwei Sekunden beendet.

HTTP und WebSockets werden über ein separates Relay je Umgebung transportiert. Dieses Relay läuft ohne Docker-Socket, Hostverzeichnisse oder erhöhte Rechte. Es erhält ausschließlich den Zugang zu dieser einen Umgebung. Der privilegierte Infrastruktur-Connector bleibt beim Betreiber. Die Web-App vermittelt keine beliebigen Ziel-URLs; das Relay kann nur den fest zugeordneten Container erreichen. Browser- und Editor-Passwörter werden intern verwendet und müssen dem Kunden nicht mehr angezeigt werden.

Der Gateway begrenzt einzelne HTTP-Uploads auf 16 MiB und einzelne WebSocket-Nachrichten auf 16 MiB. Größere Arbeiten lassen sich im Editor beispielsweise über Git bearbeiten. Gestreamte HTTP-Antworten sind auf 64 MiB begrenzt. Bei Stopps werden bestehende Verbindungen widerrufen; bereits heruntergeladene Dateien bleiben natürlich beim Nutzer.

## Abrechnung

Laufzeitguthaben ist vollständig von KI-Credits getrennt. Eine normale Betriebsminute verbraucht standardmäßig eine Laufzeit-Minute. Der Betreiber kann an einer Vorlage einen anderen Minutenfaktor einstellen; der Kunde sieht ihn vor Buchung und Start. Ein geänderter Starttarif muss durch eine aktuelle Ansicht bestätigt werden.

Beim Start wird die erste angefangene Minute atomar reserviert. Nach bestätigtem Containerstart wird daraus Verbrauch. Bei einem eindeutig fehlgeschlagenen Start oder einer bestätigten Entfernung ohne Start wird die Reservierung zurückgegeben. Unklare Ausgänge bleiben gesperrt und müssen abgeglichen werden. Weitere angefangene Minuten werden vorausbezahlt. Gestoppte Umgebungen verbrauchen keine neuen Minuten. Ab einer Stoppanforderung werden keine weiteren Minuten berechnet; das physische Stoppen folgt durch den zugeordneten Connector. Bereits angefangene Minuten werden nicht anteilig zurückgebucht.

Plan-Minuten werden zuerst verwendet. Bei echten Abonnements erneuern sie sich ausschließlich durch eine bestätigte Planrechnung, nicht durch einen Browseraufruf oder eine Monatsgrenze im Client. Gekaufte Minuten bleiben erhalten. Ein Planwechsel berücksichtigt bereits verbrauchte Minuten; ein Downgrade darf keine verbrauchte Zeit neu gutschreiben. Lokale Testzuweisungen verwenden ausdrücklich als Test markierte Kontingente pro UTC-Kalendermonat.

Bei leerem Guthaben, entfallener Planberechtigung, offener Zahlungsklärung oder längerer Unterbrechung der Zustandsprüfung wird der Kundenzugang gesperrt und ein Stoppauftrag eingestellt. Ist ein Host nicht erreichbar, kann die Plattform das physische Ende des Containers erst nach Wiederverbindung bestätigen. Es werden keine unbegrenzten Nachberechnungen für unklare Ausfallzeiten erzeugt.

Der Administrator verwaltet Laufzeitpakete und Guthabenkorrekturen im Bereich **Server & Container → Containerabrechnung**. Ein Beispielpaket mit 300 Minuten für 5 € ist vorbereitet und zunächst deaktiviert. Der Kauf benötigt aktiviertes Stripe, eine passende EUR-Price-ID und einen zum Produkt passenden Betrag. Der Nachkauf nutzt Checkout im Zahlungsmodus und aktiviert die Stripe-Rechnungserstellung.

Die Gutschrift folgt ausschließlich nach gültiger Webhook-Signatur und erneuter Prüfung der tatsächlichen Checkout-Position: Bestellung, Konto, Kunde, Preis, Währung, Menge und Zahlungsstatus müssen übereinstimmen. Doppelte Ereignisse schreiben ein Paket nicht doppelt gut. Erstattungen buchen entsprechende Minuten zurück; bereits verbrauchte, erstattete Minuten werden als offene Korrektur geführt. Zahlungsklärungen sperren weitere Nutzung. Rechnungen erscheinen nach den entsprechenden Stripe-Rechnungsereignissen im vorhandenen Rechnungsbereich. Betreiberkorrekturen sind als solche markiert und erzeugen keine Rechnung.

Diese Installation hat weiterhin keine aktiven Stripe-Zugangsdaten. Es wurden keine realen Zahlungen ausgelöst. Der signierte Webhook, die positionsgeprüfte Gutschrift und Erstattungen sind mit lokalen Ereignis-Fixtures geprüft; ein echter Stripe-Testcheckout ist erst mit einem eingerichteten Testkonto möglich.

## Weitere eigene Server und HTTPS

Lokal startet der Gateway zusammen mit der App:

```powershell
docker compose --profile infrastructure up -d --no-build --scale worker=2 app worker infrastructure gateway
```

Die mitgelieferte lokale Compose-Datei verbindet Zugangs-Relays mit `ws://gateway:3200/_relay` im eigenen Docker-Netz. Dieser lokale Transport wird nicht ins Internet veröffentlicht. Der Browserzugang ist auf Loopback-Port 3200 gebunden.

Für einen öffentlichen Betrieb eine eigene Umgebungs-Basisdomain mit Wildcard-DNS vorsehen, zum Beispiel `environments.example.net`. In der Plattform-/Gateway-Umgebung setzen:

```dotenv
PUBLIC_URL=https://cloud.example.com
PUBLIC_ENVIRONMENT_URL=https://environments.example.net
ACME_EMAIL=operator@example.com
```

Auf jedem entfernten Docker-Connector:

```dotenv
PLATFORM_URL=https://cloud.example.com
INFRA_ALLOW_COMMANDS=true
INFRA_RELAY_IMAGE=registry.example.com/kerncloud:<geprüfte-version>
INFRA_RELAY_URL=wss://{environment}.environments.example.net/_relay
```

`{environment}` wird durch die konkrete Umgebungs-ID ersetzt. Öffentliche Relay-Verbindungen verlangen WSS. Für entfernte Hosts kein lokales `INFRA_RELAY_NETWORK` setzen; dieses zusätzliche Netz ist ausschließlich die Verbindung zum Gateway derselben lokalen Docker-Installation. Das Relay-Image muss auf dem jeweiligen Host vorhanden sein.

`compose.environment-https.yaml` und `deploy/Caddyfile.environments` ergänzen HTTPS mit automatischen Zertifikaten. Caddy fragt den Gateway vor der Ausstellung, ob die konkrete laufende Umgebungsdomain zugelassen ist. Zuerst DNS, freigegebene Ports 80/443, Betreiber-E-Mail und die beiden öffentlichen URLs konfigurieren. Dann den Compose-Zusatz auf dem vorgesehenen Server einsetzen. Es wurde kein öffentlicher Server gestartet und kein Zertifikat für eine fremde Domain angefordert.

Die Selbstbuchung verwendet Docker-Hosts; dazu zählen auch eigene Docker-Hosts auf AWS-VMs. Der frühere ECS/Fargate-Adapter bleibt eine Betreiberintegration mit separat vorbereiteten Taskdefinitionen. Fargate-Selbstbuchung und automatisches AWS-Provisionieren sind nicht Bestandteil dieses lokalen Docker-Ablaufs.

## Agenten stoppen

Oben im Workspace steht **Alle Agenten stoppen**. Das sperrt neue Aufträge, pausiert laufende Aufträge und entzieht aktive Worker-Leases. **Workspace fortsetzen** setzt nur die Aufträge fort, die durch diesen Workspace-Stopp pausiert wurden. Zuvor manuell pausierte Aufträge und einzeln gestoppte Agenten bleiben gestoppt.

Jede Agentenkarte hat einen eigenen Stopp-/Fortsetzen-Schalter. Andere Agenten können weiterarbeiten. Gestoppte Agenten bekommen keine neuen Aufgaben und werden nicht als Delegationsziel angenommen. Laufende Modellanfragen werden über ein Abbruchsignal beendet. Bereits ausgelöste externe Aktionen können nicht rückgängig gemacht werden; unterbrochene MCP-Aufrufe bleiben deshalb im Journal und benötigen eine Prüfung, statt automatisch wiederholt zu werden. Bereits entstandener Modellverbrauch kann beim Anbieter weiter kostenpflichtig sein.

Agentensteuerung und Containersteuerung sind unabhängig: Ein gestoppter Agent lässt einen bewusst gestarteten Editor weiterlaufen. Dessen Laufzeit stoppt der Kunde auf der Umgebungsseite.

## Betriebsgrenzen

Für den Internetbetrieb zusätzlich die tatsächliche Domain, Stripe-Testabnahme, Sicherungen, Aufbewahrung für gestoppte Arbeitsvolumes, Host-/Festplattenquoten und den Umgang mit fremdem Kundencode festlegen. Docker-Container teilen den Kernel; der Gateway ist keine VM-Sicherheitsgrenze. Es gibt keine automatische Volumenlöschung nach einer Kündigung. Diese technischen Änderungen bestätigen keine rechtliche oder sicherheitstechnische Produktionsabnahme.
