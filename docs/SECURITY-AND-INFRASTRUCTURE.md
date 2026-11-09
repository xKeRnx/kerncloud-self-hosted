# Kontoschutz und eigene Kundenumgebungen

Aktueller Docker-Kundenablauf mit Selbstbuchung, getrennten Zugangs-Origins und Minutenabrechnung: [CUSTOMER-ENVIRONMENTS.md](CUSTOMER-ENVIRONMENTS.md).

## Lokal verwenden

`http://localhost:3100/profile`: Authenticator-2FA mit lokal erzeugtem QR-Code und zehn einmaligen Wiederherstellungscodes. Zur Einrichtung ist das aktuelle Passwort nötig; bei Konten ohne lokales Passwort eine erneute Dienst-Anmeldung innerhalb von zehn Minuten. Änderungen an Passwort, Verknüpfungen und 2FA verlangen die entsprechenden Faktoren. Aktivieren oder Abschalten der 2FA beendet alte Sitzungen. Wiederherstellungscodes getrennt sichern; es gibt noch keine automatische Wiederherstellung per E-Mail.

`/admin/security`: Google, GitHub und Microsoft konfigurieren. Die Buttons erscheinen erst nach Freischaltung mit Client-ID und Secret. Die angezeigte Callback-Adresse exakt beim Anbieter hinterlegen. Für Microsoft eine Web-Anwendung registrieren, die Organisationskonten und persönliche Microsoft-Konten zulässt; Redirect URI `/api/auth/oauth/microsoft/callback`. Für Google eine Web-Client-Anwendung samt Consent-Screen, für GitHub eine OAuth App. Lokal HTTP über localhost, auf dem Server HTTPS. Betreiber müssen Datenschutzinformationen und Freigaben bei den Anbietern selbst ergänzen.

Die Implementierung nutzt Authorization Code, PKCE, einmaligen State, Nonce und geprüfte ID-Token-Signaturen für Google/Microsoft. Microsoft wird anhand von Tenant und Subject zugeordnet; E-Mail/UPN ist veränderliche Kontaktinformation. Eine gleiche E-Mail-Adresse verknüpft niemals automatisch bestehende Konten. Bereits angemeldet lassen sich Dienste im Profil mit Kontobestätigung verbinden und wieder trennen. Ein Dienst-Login umgeht aktivierte KeRnCloud-2FA nicht. Anbieter-Tokens werden nicht gespeichert; Client-Secrets und TOTP-Seeds sind verschlüsselt, Recovery-Codes und Session-Tokens gehasht.

## Docker Desktop und eigene Server

`/admin/infrastructure` zeigt registrierte Server, letzte Meldung, Containerzustand, Healthchecks, CPU/RAM und die vorhandenen Agenten-Worker. Der Betreiber-Connector meldet sich ausgehend bei KeRnCloud; die Web-App selbst erhält keinen Docker-Socket. CPU/RAM beziehen sich beim lokalen Docker Desktop auf dessen Linux-VM. Container ohne Healthcheck werden ausdrücklich so angezeigt. Aktualisierung alle 15 Sekunden, Servermeldungen ungefähr alle zehn Sekunden.

Lokale Registrierung: `npm run setup:infrastructure`. Das Skript erzeugt einmalig einen Server und speichert dessen Zugang in `.env.infrastructure`. Eine vorhandene Datei wird beibehalten. Start:

```powershell
docker compose --profile infrastructure up -d --no-build infrastructure
```

Der lokale Connector läuft zuerst nur zur Überwachung. Bereitstellung braucht **beide** Freigaben: `INFRA_ALLOW_COMMANDS=true` in `.env.infrastructure` und „Containeraktionen freigeben“ beim Server im Adminpanel. Nach Änderung der Datei den Connector mit `up -d --force-recreate infrastructure` neu starten. Freigabe erteilt nur der Betreiber. Kunden können keine Images, Hostmounts oder Docker-Befehle einspeisen.

Auf einem weiteren Linux-Server: KeRnCloud-Image in eine eigene Registry übertragen, im Adminpanel Server anlegen, das einmalig angezeigte Token sicher in `.env.infrastructure` speichern. `compose.infrastructure.yaml` auf den Server kopieren. Erforderlich:

```dotenv
PLATFORM_URL=https://cloud.example.com
INFRA_HOST_ID=<angezeigte ID>
INFRA_HOST_TOKEN=<einmalig angezeigtes Token>
INFRA_ALLOW_COMMANDS=false
# Freier privater /16-Bereich, der weder mit LAN/VPN noch Docker-Netzen kollidiert:
INFRA_DOCKER_SUBNET_POOL=10.240.0.0/16
```

`KERNCLOUD_IMAGE` in der Compose-Umgebung auf das veröffentlichte Image setzen; `docker compose -f compose.infrastructure.yaml up -d`. Danach erscheint der Server im Adminpanel. Den Docker-Socket niemals über einen offenen TCP-Port veröffentlichen. Dieser Connector ist ein privilegiertes Betreiberwerkzeug: Socket-Zugriff bedeutet Kontrolle über den Host. Für fremden Kundencode dedizierte Hosts/VMs einplanen; Container teilen den Host-Kernel.

Der optionale Subnetzpool wird in freie /28-Netze aufgeteilt, bestehende Docker-Subnetze werden geprüft. Lokal ist `10.240.0.0/16` konfiguriert, weil Docker Desktop seine Standardpools ausgeschöpft hatte. Bei anderen Netzwerken muss der Betreiber einen passenden freien Bereich wählen.

## Browser und Entwicklungsumgebung

Images einmal auf jedem vorgesehenen Docker-Host bauen oder aus der eigenen Registry bereitstellen:

```powershell
docker compose -f compose.environments.yaml build
```

Die Vorlagen sind unter „Container-Vorlagen“ vorhanden, zunächst gesperrt. Nach dem Build freigeben:

- **Browser**: Chromium Desktop über noVNC, 2 CPUs / 2048 MiB, Port 8080, Benutzer `kerncloud` und individuelles Passwort. Persistentes Chromium-Profil in `/home/runner/browser-profile`.
- **Entwicklungsumgebung**: Code Server mit Editor, Dateiverwaltung und Terminal, 1 CPU / 1024 MiB, Port 8080 und individuelles Passwort. Arbeitsdateien in `/home/runner/project`. Root-Pakete installiert der Betreiber ins Image; Projekte können eigene Abhängigkeiten im Homeverzeichnis ablegen.

Images laufen als UID/GID 1000, mit schreibgeschütztem Root-Dateisystem, ohne zusätzliche Linux-Capabilities und mit CPU/RAM/PID-Limits. Jede Umgebung erhält ein eigenes Netzwerk und benanntes Arbeitsvolume. Netzwerkzugriff wird pro Vorlage freigegeben; Browser/Editor erlauben ihn für ihre Arbeit. Image-Versionen/Digests und Updates kontrolliert der Betreiber.

Kunden buchen freigegebene Docker-Vorlagen unter `/environments` selbst, begrenzt durch Plan-Plätze, gleichzeitige Starts und Hostkapazität. Die manuelle Betreiberbereitstellung bleibt verfügbar. Der geschützte Öffnen-Button verwendet kurzlebige Einmaltickets und getrennte Zugangs-Origins. Kennwörter bleiben intern verschlüsselt und werden vom Relay verwendet.

Interne Containerports sind nur auf **127.0.0.1 des Container-Servers** veröffentlicht. Der Kundenzugang läuft über das authentifizierte HTTP-/WebSocket-Gateway und ein Relay je Umgebung; lokal auf Port 3200. Für öffentliche Hosts müssen die mitgelieferte HTTPS-Konfiguration, eigene DNS-Einträge und Zertifikate tatsächlich eingerichtet werden. Agenten können freigegebene Browser-/Terminal-/Dateiwerkzeuge verwenden; Einrichtung und Betriebsgrenzen: [AGENT-CONTAINERS.md](AGENT-CONTAINERS.md).

Stoppen/Starten erhält Arbeitsdaten. „Neu aufsetzen“ entfernt das Docker-Volume und erstellt einen frischen Container; „Entfernen“ löscht eigene Container, Volume und Netz. Beide Aktionen verlangen den vollständigen Umgebungsnamen. Unklare Ergebnisse werden gesperrt und über denselben Auftrag mit derselben Generation abgeglichen. Keine pauschale Docker-Bereinigung ausführen.

## AWS ECS/Fargate

Ein eigener Connector-Modus in `compose.infrastructure-aws.yaml` verwaltet ECS-Tasks mit Host-/Umgebungs-Tags, idempotentem RunTask und privaten Netzwerkschnittstellen. AWS-Zugänge bleiben beim Betreiber-Connector (IAM-Rolle/SDK-Kette), nicht in der Web-App. Es wurden keine AWS-Ressourcen angelegt oder kostenpflichtigen Aufrufe ausgeführt.

Vorher selbst anlegen: ECS-Cluster, Registry-Images, private Subnetze, Security Groups, passende Task-/Execution-Rollen, Logs und Taskdefinitionen. Der Connector benötigt gezielt List/Describe/Run/Stop/Tag-Berechtigungen und `iam:PassRole` nur für die vorgesehenen Rollen. Private Tasks brauchen Registry-/Log-Zugriff über passende VPC-Endpunkte oder NAT.

Zusätzlich zu Server-ID/-Token konfigurieren:

```dotenv
INFRA_MODE=aws_ecs
AWS_REGION=eu-central-1
AWS_ECS_CLUSTER=<Cluster-ARN>
AWS_ECS_SUBNETS=subnet-aaa,subnet-bbb
AWS_ECS_SECURITY_GROUPS=sg-aaa
AWS_ECS_TASK_DEFINITIONS={"aws-worker":"<Taskdefinition-ARN:Revision>"}
AWS_ECS_ENVIRONMENT_DEFINITIONS={"<Umgebungs-ID>":"<eigene Taskdefinition-ARN:Revision>"}
```

Eine passende Betreiber-Vorlage anlegen; CPU/RAM müssen genau zur Taskdefinition passen. Der Adapter verlangt FARGATE, awsvpc, nicht-root und read-only. EFS erfordert eine Taskdefinition und einen separaten Access Point je Kundenumgebung. AWS-Neuaufsetzen ersetzt Tasks, löscht jedoch keine EFS-Daten. Deren Löschung, Secrets, öffentliches Gateway und Verrechnung sind separat zu ergänzen. Die mitgelieferten Browser-/Editor-Webzugänge sind zunächst für Docker vorgesehen; AWS-Zugänge werden noch nicht automatisch eingerichtet.

AWS-Taskzustand wird gemeldet; direkte Task-CPU/RAM-Messwerte benötigen eine zusätzliche CloudWatch-Anbindung. Diese Version erstellt keine Cluster, VPCs oder IAM-Rollen per Klick. Reale AWS-End-to-End-Abnahme folgt erst mit einem eingerichteten Testkonto und Budget.

## Kosten und nächste Betriebsstufe

Containerplätze separat von Modell-Credits kalkulieren: reservierter RAM, CPU, Speichervolume, Laufzeit, Backups und ausgehender Traffic. Ein dauerhaft laufender Browser belegt schon etwa 2 GiB reservierten RAM. Zehn solcher Plätze passen nicht auf einen kleinen 4-GB-Server. Für das Monatsbudget zunächst wenige gleichzeitige Plätze, Ruhezeiten und Laufzeitkontingente anbieten. Plan-Kontingente, Nachkauf über Stripe und automatische Abschaltung bei fehlendem Guthaben sind angeschlossen. Eine Abschaltung nach bloßer Inaktivität ist nicht implementiert. Echte Stripe-Testzahlungen stehen mangels Zugangsdaten aus.

Vor öffentlichem Verkauf: Pflicht-2FA für Betreiber, geprüfte Kontowiederherstellung/E-Mail-Verifizierung, die öffentliche TLS-Konfiguration abnehmen, stärkere Sandbox-Grenzen, Backups, Speicherquoten pro Host/Kunde und externe Sicherheitsabnahme ergänzen. Rechtliche Veröffentlichung benötigt die tatsächlichen Unternehmensangaben und Verträge; neue Funktionen allein bestätigen keine DSGVO-Konformität.
