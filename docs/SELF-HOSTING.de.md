# Lokal installieren und betreiben

## Voraussetzungen

- Windows 10/11 mit WSL2 und Docker Desktop im Linux-Modus; macOS mit Docker Desktop; oder Linux mit Docker Engine und Compose v2.
- Node.js 22 oder neuer für den Quellcode-Schnellstart. Die Desktop-App verwendet ihre eigene Node-Laufzeit.
- Planungsgröße: 4 CPU-Kerne, 8 GB freier RAM, mindestens 20 GB freier Speicher. Builds, Browsercontainer und lokale KI-Modelle können erheblich mehr benötigen. Das ist keine gemessene Kapazitätsgarantie.
- Internet für den ersten Build, Paket-/Container-Downloads und gegebenenfalls externe KI-Anbieter. Ein lokales Modell kann anschließend ohne externe Modell-API verwendet werden.

Docker Desktop hat eigene Lizenzbedingungen. Abhängig von Unternehmensgröße und Einsatz kann dafür ein separates kostenpflichtiges Abo erforderlich sein; KeRnCloud lizenziert Docker nicht mit.

## Quellcode-Schnellstart

Das Repository herunterladen oder klonen, in den Ordner wechseln:

```sh
node scripts/self-host.mjs init
node scripts/self-host.mjs doctor
node scripts/self-host.mjs start
```

Ein `npm install` auf dem Host ist dafür nicht nötig. Der Build installiert die gesperrten Abhängigkeiten innerhalb von Docker. Anschließend http://localhost:3100/login öffnen. E-Mail und zufälliges Passwort stehen in der neu erzeugten privaten `.env` unter `ADMIN_EMAIL` und `ADMIN_PASSWORD`. Das Passwort nach der ersten Anmeldung im Profil ändern.

Alternativen: Windows `start-local.cmd`, Linux/macOS `sh start-local.sh`. Unterschiedliche Ports oder E-Mail vor dem ersten Start wählen:

```sh
node scripts/self-host.mjs init --port 4100 --gateway-port 4200 --email you@example.com
```

Jeder Installationsordner erhält einen eigenen Compose-Projektnamen und eigene Docker-Volumes. Ports müssen frei sein. Bei erneutem Start bleiben bestehende Schlüssel unverändert. Ein vorhandenes SaaS-`.env` wird ausdrücklich nicht umgewandelt. Bestehende Installationen separat sichern und nur über eine geplante Migration übernehmen.

## Modelle und erster Auftrag

1. Im Dashboard unter **Verbindungen & Umgebungen → KI-Modelle** den eigenen Anbieter hinzufügen.
2. Modellkatalog laden, passendes Modell wählen und feste Token-/Kostenlimits setzen. Tool-Unterstützung und Qualität hängen vom Modell ab.
3. Ein Projekt erstellen und einen überschaubaren Auftrag starten, zum Beispiel eine lokale HTML-Seite mit FAQ und Vorschau.
4. Fortschritt im Auftrag oder Agentenprotokoll verfolgen; Rückfragen und Freigaben im Postfach beantworten.
5. Ergebnis in der Vorschau prüfen und das Dateipaket herunterladen.

Für Ollama auf dem Host: aus dem App-Container `http://host.docker.internal:11434/v1` verwenden. Der eigene Modellserver muss entsprechend erreichbar sein. Ein localhost-Modell auf dem Host ist aus dem Container nicht automatisch unter `localhost` erreichbar. Der lokale Modus erlaubt private Endpoints; veröffentliche diese Konfiguration nicht ungeprüft im Internet.

## Zugriff und Plan

`DEPLOYMENT_MODE=self-hosted` ist eine serverseitige Installationsentscheidung. Neue Konten erhalten einen kostenlosen lokalen Plan mit eigenen Modellen, 50 Agenten, 100 Workspaces, bis zu 500 Modellschritten pro Auftrag und Ressourcenobergrenzen. Die administrativen Obergrenzen bleiben erhalten; dies ist kein Versprechen unbegrenzter Rechnerleistung. Feste Auftragsbudgets, Freigaben, Projektgrenzen und Sandbox-Regeln gelten unverändert.

Öffentliche Registrierung ist standardmäßig aus. Mitglieder über die Administration einladen, oder nach bewusster Entscheidung `ALLOW_REGISTRATION=true` setzen und den App-Container neu starten. Der Modus konvertiert keine vorhandenen Konten, Abos, Guthaben oder Rechnungen.

Lokale Installation benötigt kein KeRnCloud-Abo und keinen KeRnCloud-Lizenzserver. Eigene KI-Anbieter, Strom, Hardware und Drittanbieter bleiben separat. Bezahlte Cloud-Kontingente werden nicht vorgetäuscht. Container/Browser auf dem eigenen Rechner benötigen einen separat eingerichteten und freigegebenen lokalen Connector; die Bridge wird getrennt verwaltet. [Connector-Anleitung](CUSTOMER-HOSTS.md).

## Status, Stoppen, Backup, Update

```sh
node scripts/self-host.mjs status
node scripts/self-host.mjs logs
node scripts/self-host.mjs backup
node scripts/self-host.mjs stop
# Neuen freigegebenen Quellstand in denselben Ordner übernehmen, .env behalten:
node scripts/self-host.mjs update
```

`stop` erhält alle Volumes. `update` verweigert den Neustart bei noch offenen Aufträgen, erstellt zuerst Datenbank- und Objekt-Backups und behält die Schlüssel. Ein defekter Build beendet den Vorgang mit Fehler, statt einen erfolgreichen Start zu behaupten. **Kein `down -v`: Das würde die Daten löschen.** Updates von Datenbankschemata sind nicht automatisch rückwärtskompatibel.

Backups liegen unter `backups/`: PostgreSQL-Dump, Objektarchiv und Manifest. Die passende `.env` separat verschlüsselt sichern, insbesondere `ENCRYPTION_KEY`. Daten und verschlüsselte Zugangsdaten lassen sich ohne den passenden Schlüssel nicht vollständig wiederherstellen. Für konsistente Backups den Workspace pausieren und laufende Vorgänge abschließen; Datenbank und Objektarchiv sind keine gemeinsame atomare Momentaufnahme.

## Wiederherstellung in einer separaten Installation

Zielordner und `.env` aus dem passenden Backup wiederherstellen, Ports und `KERNCLOUD_COMPOSE_PROJECT` für die Testinstanz eindeutig setzen. Zunächst nur PostgreSQL und Objektspeicher starten. Dump per `pg_restore` in die leere Zieldatenbank einspielen, Objektarchiv in das neue Objektvolume entpacken. **Nicht gegen eine belegte Kundendatenbank testen.** Vor Arbeitsfreigabe Anmeldungen, Dateien, Entschlüsselung, Rechte und Auftragszustände prüfen. Konkrete Compose-Befehle immer mit `--env-file .env -f compose.self-hosted.yaml` ausführen.

## LAN / öffentlicher Server

Der Standard veröffentlicht ausschließlich Loopback-Ports. LAN, TLS-Reverse-Proxy, Egress-Regeln, E-Mail, Sicherungsstrategie und Mehrbenutzerbetrieb sind eine eigene Betreiberentscheidung. Eine Desktop-Installation öffnet keine Firewall und richtet keinen Fernzugriff ein. [Betriebscheckliste](OPERATIONS.md).

## Docker: Adresspool erschöpft

Wenn Docker meldet, dass alle vordefinierten Subnetze belegt sind, liegt das vor dem App-Start am lokalen Docker-Netzbestand. Nicht pauschal fremde Netzwerke oder Volumes löschen. Vorhandene Netzzuordnungen prüfen und mit dem Betreiber einen freien Bereich wählen oder Docker-Standardpools gezielt konfigurieren. Die Installationsprüfung auf dem Entwicklungsrechner musste dafür eigene isolierte Test-Subnetze verwenden; das ist keine Voraussetzung auf einem frischen Rechner.
