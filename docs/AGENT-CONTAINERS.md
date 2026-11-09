# Agenten in gebuchten Kundenumgebungen

Unter `/environments` eine Browser- oder Entwicklungsumgebung buchen und starten. In der jeweiligen Karte **Agenten-Zugriff** öffnen, gewünschte Rechte und Agenten auswählen und speichern. Neue Umgebungen haben zunächst keine Agentenfreigabe. Leere Rechte entziehen den Zugriff; die Auswahl „Alle Agenten dieses Workspaces“ gilt auch für später hinzugefügte Agenten.

- **Projektdateien**: UTF-8-Dateien unter `/home/runner/project` lesen, schreiben und ergänzen. Derselbe Projektordner ist im Code-Editor sichtbar. Pfade und Symlinks außerhalb des Projekts werden im Dateiwerkzeug abgewiesen.
- **Terminal**: Shell-Befehle als UID 1000, Git, Node/npm/npx und Python; Projektabhängigkeiten können im eigenen Homeverzeichnis installiert werden. Kein Docker-Socket, keine Hostverzeichnisse und keine Betreiber-Zugangsdaten. Terminalrechte erlauben innerhalb des eigenen Containers auch Dateiänderungen und Netzwerkzugriff.
- **Browser**: Der Agent steuert denselben sichtbaren Chromium-Desktop wie der Kunde über noVNC. Navigation, Tabs, Seitentext, Elemente mit Referenzen, Klicken, Ausfüllen, Tastatur und Scrollen. Die Steuerung verwendet [Playwright über CDP](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp); CDP bleibt an Loopback innerhalb des Browsercontainers gebunden. Bestehende Browser-Sitzungen können verwendet werden. Automatisches Lösen von CAPTCHAs oder eine Umgehung von Anmeldesperren wird nicht angeboten.

Beispielauftrag: „Nutze meine freigegebene Entwicklungsumgebung, lege eine kleine Node-Anwendung an, teste sie und berichte über Änderungen und Testergebnis.“ Für Browseraufgaben die Browserumgebung und die konkrete Website bzw. lokale Testseite nennen. Ein angebundenes Modell mit Werkzeugaufrufen ist weiterhin erforderlich. Zugeordnete Auftragsdateien können die Agenten mit `read_attachment` lesen und in das Projekt übernehmen; Git-Repositories können im Terminal geklont werden, soweit die Umgebung den nötigen Netzwerkzugang und die vom Kunden bereitgestellten Repository-Rechte hat.

## Ablauf und Stopp

Die Plattform prüft Workspace, Agentenauswahl, einzelne Rechte, aktive Task-Lease, Agenten-/Workspace-Stopp, Container-Generation, Hostzustand und die vorhandene Laufzeit-/Planberechtigung. Gestoppte Umgebungen werden nicht selbst gestartet: Der Kunde startet sie im Portal und sieht dort den Minutenverbrauch. Eine Buchung oder ein Modellaufruf erteilt keine Containerrechte.

Werkzeugaktionen werden dauerhaft protokolliert und je Umgebung nacheinander ausgeführt. Bestätigte Wiederholungen derselben Werkzeug-ID liefern das gespeicherte Ergebnis. Nicht bestätigte Aktionen bleiben zur Prüfung gesperrt; sie werden nach einem Absturz nicht automatisch erneut ausgeführt. Unter **Agenten-Aktivität** stehen laufende Aktionen und die letzten Ergebnisse. Das JSON-Datenexport enthält Rechte, Aktionen und Ergebnisse ohne interne Leases oder Zugriffstokens. Arbeitsvolumes sind gesondert zu sichern; das JSON ersetzt keinen Export der Containerdateien.

Workspace-/Agenten-Stopp oder Entzug der Freigabe bricht laufende Terminalbefehle einschließlich normaler Kindprozesse ab. Bereits ausgelöste Browser-/Netzwerkwirkungen können nicht zurückgenommen werden. Vom Projekt eigens gestartete, unabhängige Hintergrunddienste können weiterlaufen; **Container stoppen** beendet die gesamte Umgebung. Containerzeit und KI-Credits bleiben getrennt. Ein Agenten-Stopp stoppt nicht automatisch den gebuchten Editor oder Browser.

Ein einzelner Befehl läuft höchstens 30 Sekunden, mit begrenzter Ausgabe. Dateilesen ist auf 16.000 Zeichen pro Abschnitt und Dateien bis 2 MB begrenzt; ein Schreibaufruf auf 100.000 Zeichen. Browser liefern begrenzte DOM-/Textauszüge, keine Bildanalyse für reine Canvas-Oberflächen. Root-Pakete und weitere Sprachwerkzeuge ergänzt der Betreiber im Image. Diese Grenzen verhindern, dass ein einzelner Modellschritt unbegrenzt Ressourcen oder Kontext verbraucht.

## Images, Server und bestehende Umgebungen

```powershell
docker compose -f compose.environments.yaml build
docker compose build app
docker compose --profile infrastructure up -d --no-build --scale worker=2 app worker infrastructure gateway
```

Die Vorlagen verwenden jetzt `kerncloud-browser:0.3` und `kerncloud-development:0.3`. Der Browser wechselt von Firefox zu Chromium, damit sichtbare Oberfläche und Agentensteuerung dieselbe Sitzung nutzen. Bestehende benutzerdefinierte Images werden nicht überschrieben. Alte laufende Container werden nicht automatisch ersetzt: Dateien vorher sichern und anschließend bewusst neu aufsetzen; das Neuaufsetzen löscht ihr Arbeitsvolume. Ein Firefox-Profil wird nicht automatisch in Chromium übertragen.

Der nicht privilegierte Controller ist nur im eigenen Container-Netz erreichbar und benötigt einen je Umgebung und Generation abgeleiteten Zugang. Der Zugangs-Relay übermittelt ausschließlich die von der Plattform freigegebenen, protokollierten Aktionen an seinen fest zugeordneten Controller. Der Kunde erhält dadurch keinen Connector- oder Docker-Zugang. Andere Docker-Hosts nutzen dieselben Images und die vorhandene WSS-Relay-Anbindung. ECS/Fargate-Werkzeuge sind noch nicht angeschlossen.

Vor öffentlichem Betrieb bleiben die vorhandenen Anforderungen an fremden Kundencode, Host-/Speicherquoten, Egress und Backups bestehen. Chromium läuft hier innerhalb der Docker-Grenze mit deaktivierter eigener Chromium-Sandbox; Docker-Container ersetzen keine VM-Isolation. Das bestätigt keine Produktions- oder Rechtsabnahme.

## Lokale Abnahme

21 Unit-Tests, 21 Integrationstests unter Windows und im Linux-Image. Geprüft: fremde Workspaces und Agenten, getrennte Fähigkeiten, Entzug der Freigabe, gespeicherte Wiederholung, laufende Aktionen und Stopp mit ungültiger alter Lease. Reale Docker-Abnahme mit tatsächlichem HTTP-Worker und klar gekennzeichneter, skriptgesteuerter Modell-Fixture: Datei schreiben/lesen, Node-Test ausführen, Pfadüberschreitung ablehnen und ein Formular im sichtbaren Chromium ausfüllen/absenden. Ein tatsächlich gestarteter `sleep`-Befehl wurde vor seiner verzögerten Dateiänderung beendet. Keine externen Modellkosten oder echten Kundencontainer verwendet.

Desktop und Mobilansicht des Freigabeformulars wurden in eigenen Chrome-Profilen auf der getrennten Test-App kontrolliert. [Browserprotokoll](BROWSER-QA-AGENT-TOOLS.json). Sicherung vor Migration 8: `backups/kerncloud-2026-10-20T05-50-53-749Z-117247.dump`.
