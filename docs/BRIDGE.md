# KeRnCloud Bridge 0.1.2 - lokale Vorabversion

Die Bridge verbindet einen Kunden-Rechner über ausgehende HTTPS-Anfragen mit einem KeRnCloud-Workspace. Es werden keine Router-Ports geöffnet. HTTP ist nur für die ausdrücklich lokale Entwicklungsadresse localhost/127.0.0.1 erlaubt.

## Installation

- Windows x64: Das Setup herunterladen und starten. Es installiert nur für deinen angemeldeten Benutzer, ohne Administratorrechte. Im Assistenten Startmenüeinträge, Desktop-Verknüpfung und optionalen Autostart auswählen; Autostart ist standardmäßig aus. Beim ersten Installieren lässt sich der Zielordner wählen. Updates verwenden den vorhandenen Ordner. Danach bei Bedarf die App über Startmenü oder Desktop öffnen.
- Linux x64: Für Debian/Ubuntu das `.deb`-Paket im Softwarecenter öffnen oder mit `sudo apt install ./kerncloud-bridge-0.1.2-linux-amd64.deb` installieren. Danach KeRnCloud Bridge im Anwendungsmenü starten. Andere Distributionen können alternativ das portable ZIP verwenden: entpacken, `chmod +x Start-Bridge.sh`, dann `./Start-Bridge.sh`. Eine grafische Sitzung und die von Electron benötigten Systembibliotheken sind erforderlich. Für sicheren Schlüsselspeicher einen laufenden Secret Service/Keyring einrichten. Die App verweigert das Speichern von Zugangsdaten bei ungeschütztem basic_text-Backend. Nicht mit `--no-sandbox` starten. Bei fehlenden Sandbox-Voraussetzungen die Distribution nach deren Anleitung konfigurieren.
- macOS: ZIP für Apple Silicon oder Intel entpacken, `KeRnCloud Bridge.app` nach Programme verschieben und dort öffnen. Bei Bedarf die App aus Programme ins Dock ziehen. Ein nativer DMG-Build ist vorbereitet, wird aber erst nach Erstellung und Prüfung auf einem Mac angeboten. Diese Vorabversion ist nicht signiert/notarisiert. Gatekeeper kann sie blockieren; Schutzmechanismen nicht pauschal deaktivieren. Für eine breite Kundenauslieferung sind Developer-ID-Signierung, Notarisierung und Tests auf einem Mac noch notwendig.

Die Pakete enthalten Electron 45.0.0 und dessen Lizenzhinweise. Unterstützte Betriebssystemversionen richten sich zusätzlich nach dieser Electron-Version. Alle Pakete sind als lokale Vorschau gekennzeichnet. Die Plattformpaketierung ist keine Bestätigung, dass die App auf jedem Zielsystem bereits praktisch getestet wurde.

## Autostart, Verknüpfungen und Deinstallation

- Autostart ist freiwillig. Auch beim Start mit Windows/Linux öffnet sich die Bridge pausiert; eine Anmeldung ist keine Freigabe neuer Aktionen.
- Windows: Den Autostart später unter „Start & Verknüpfungen“ in der App ändern. Für Desktop-/Startmenüeinträge das Setup erneut ausführen und die Auswahl anpassen. Deinstallieren über Windows-Einstellungen > Apps > Installierte Apps oder den Startmenüeintrag. Das Setup beendet eine laufende Bridge nicht zwangsweise; die App zuerst schließen.
- Linux: Autostart in der App unter „Start & Verknüpfungen“ einschalten oder abschalten. Eine zusätzliche Desktop-Datei kann dort auf Wunsch erstellt werden; die Oberfläche kann eine Bestätigung zum Starten verlangen. Das Debian-Paket über das Softwarecenter oder sudo apt remove kerncloud-bridge entfernen. Benutzerbezogene Autostart-/Desktop-Einträge vorher in der App abschalten bzw. entfernen.
- macOS: Die unsignierte Vorschau verwaltet keine Anmeldeobjekte automatisch. Diese bei Bedarf in Systemeinstellungen > Allgemein > Anmeldeobjekte verwalten. Zum Entfernen die geschlossene App aus Programme entfernen und eigene Dock-/Anmeldeeinträge entfernen.
- Deinstallation entfernt das Programm und vom Windows-Setup erstellte Verknüpfungen, aber keine Verbindungseinstellungen oder Aktionsjournale im Benutzerprofil. Selbst hinzugefügte Dateien im Installationsordner werden nicht rekursiv gelöscht. Bei endgültiger Trennung das Gerät zuerst in der Webapp widerrufen.

## Verbinden

1. In KeRnCloud: „Verbindungen & Umgebungen → Bridge & Geräte“ öffnen. Der Workspace-Eigentümer benötigt ein aktives Abo mit Connector-Plätzen. Docker-Connector und Bridge teilen sich die kontoweite Geräteobergrenze.
2. Einen Verbindungsschlüssel mit Name, Ablaufdatum, expliziten Projekten, Agenten und Fähigkeiten erstellen. Keine Projekt-/Agentenauswahl bedeutet keinen Zugriff.
3. App öffnen. Die öffentlich erreichbare HTTPS-Adresse deiner KeRnCloud-Installation, Gerätename und einmaligen Schlüssel eingeben. Bei lokaler Entwicklung `http://localhost:3100` verwenden. Der Schlüssel darf nicht in Chat, Aufträge oder Screenshots kopiert werden.
4. Lokale Grenzen in der App einstellen und speichern. Ordner per Dateiauswahl wählen und mit Alias benennen. Lese-/Schreibrechte getrennt setzen. Nur benötigte Netzwerk-Origins mit genauem Protokoll und Port eintragen.
5. „Verbindung fortsetzen“ anklicken. Neue lokale Rechte sind nur am Gerät erteilbar. Die Webapp darf diese Rechte zusätzlich einschränken. Der Agent sieht freigegebene Aliasse, Ziele und feste Programmkennungen; keine vollständige Dateisystemfreigabe.

## Funktionen und Grenzen

- Dateien: relative Pfade in ausgewählten Ordnern; Links und Pfadwechsel außerhalb der Freigaben sind gesperrt. Textdateien bis 60 KB; Ordnerlisten bis 200 Einträge. Vorhandene Dateien benötigen den Hash der zuvor gelesenen Version. Vor dem Überschreiben entsteht eine lokale `.kerncloud-backup-…`-Sicherung im selben Ordner. Wiederherstellung durch den Kunden: pausieren, aktuelle Datei sichern, Sicherung zurückkopieren. Externe Aktionen werden dadurch nicht rückgängig gemacht.
- Browser: eigenes Browserprofil ohne Zugriff auf dein persönliches Profil, ohne Node-Zugriff und ohne automatische Downloads. Nur lokal erlaubte Netzwerkziele. Schreibende HTTP-Anfragen benötigen zusätzlich eine schreibfähige Zielfreigabe. Anmeldung erfolgt bei Bedarf durch dich im separaten Browser. Keine Passwortfelder durch Agenten ausfüllen; Zugangsdaten nicht im Auftrag übergeben.
- Netzwerk: HTTP(S) zu genau erlaubten Origins; keine automatischen Weiterleitungen, keine freie VPN-/Subnetzfreigabe. Link-Local-/Cloud-Metadaten-Ziele werden blockiert. Maximale Antwort 60 KB, Zeitlimit 12 Sekunden. Derzeit keine frei konfigurierbaren Authentifizierungsheader; bestehende authentifizierte Browser-Sitzungen können über den separaten Browser verwendet werden.
- Programme: nur manuell ausgewählte absolute Programmpfade mit lokal festgelegter Argumentliste. Agenten übergeben nur einen Alias. Keine Shells/Interpreter mit allgemeinen Befehlen freigeben. Ausgabe begrenzt, Zeitlimit 15 Sekunden. Programme besitzen die Rechte des angemeldeten Betriebssystembenutzers; dies ist keine zusätzliche Betriebssystem-Sandbox.
- Desktop: jede Aktion benötigt die exakte Web-Freigabe UND eine lokale Bestätigung. Bildaufnahme unterstützt aktuell genau einen Bildschirm. Windows unterstützt Klicks und Tastatureingaben. Linux-Eingaben benötigen X11 und `/usr/bin/xdotool`; Wayland-Eingaben sind nicht implementiert. macOS unterstützt Bildschirmaufnahme, Tastatur und Mausklicks über Betriebssystem-Schnittstellen nach Systemfreigabe; praktische Tests auf einem Mac stehen noch aus. Der separate Browser ist die bevorzugte Alternative.

## Datenschutz und Zugriff

Die lokale App prüft eigene Grenzen vor jeder Aktion. Web-Tokens sind keine Freigabe für beliebige Ordner, Programme oder das ganze Firmennetz. Dateien, gelesene Texte, Browserausgaben, Netzwerkantworten und explizit freigegebene Screenshots können an die Plattform und an das gewählte KI-Modell gehen. Lokale Ausführung bedeutet keinen vollständig lokalen KI-Betrieb.

Lokale Zugangsdaten und Freigaben werden mit Electron safeStorage im Betriebssystem-Schlüsselspeicher geschützt. Das lokale Aktionsjournal liegt im App-Benutzerdatenordner und enthält Ergebnisse für die sichere Wiederaufnahme; es wird nicht bei jeder Aktion neu ausgeführt. Diese lokalen Daten sind entsprechend als Kundendaten zu schützen. Ein Betriebssystemkonto mit erweiterten Rechten oder kompromittierter Rechner liegt außerhalb dieser App-Isolation.

In KeRnCloud stehen Aktionen beim zugehörigen Auftrag/Agenten. Die Geräteübersicht zeigt Status und Kennungen. Betreiber-Support erhält durch die Bridge keinen automatischen Zugang; allgemeiner Supportmodus ist für Bridge-Schlüssel und Gerätesteuern gesperrt.

## Pausieren, Widerruf und Tokenpflege

- „Sofort pausieren“ stoppt neue lokale Aufrufe. Bereits ausgeführte Schreib-/Netzwerkaktionen können nicht zurückgenommen werden. Laufende kurze Dateiaktionen können noch abschließen.
- Nach Neustart oder Verbindungsfehler bleibt die App pausiert. Erst Status und Ergebnis prüfen, dann bewusst fortsetzen.
- Web-Pause sperrt neue Cloud-Aufträge. Eine offline befindliche Maschine kann dadurch nicht physisch bedient oder abgeschaltet werden.
- Token bearbeiten: Name, Ablauf, Projekt-/Agenten-/Fähigkeitsgrenzen ändern. Ausstehende Aktionen werden beendet bzw. als unklar markiert.
- Token neu erstellen: alte Gerätezugangsdaten sofort ungültig, neuer einmaliger Schlüssel; App neu verbinden. Das bestehende Gerät behält seine Gerätekennung.
- Widerrufen: keine weiteren Geräteanfragen. Löschen entfernt den Token aus der aktiven Übersicht und trennt das Gerät; der Aktionsverlauf bleibt erhalten.
- Unklares Ergebnis: Die Bridge speichert einen lokalen Ausführungsbeleg und wiederholt eine begonnene Aktion nicht automatisch. Vor einer neuen Aktion Zustand lokal prüfen. Kostenlimits und Freigaben des Auftrags bleiben unabhängig davon bestehen.

## Aktualisierung und Betrieb

Keine automatische Aktualisierung in 0.1.2. Updates aus deinem vertrauenswürdigen KeRnCloud-Download beziehen, SHA-256 mit der Downloadliste vergleichen, App pausieren und beenden. Windows: neues Setup ausführen; bestehende Verbindungen bleiben erhalten. Debian/Ubuntu: das neue Paket installieren. Portable Pakete: Programmdateien ersetzen. Zugangsdaten nicht in das Installationsverzeichnis legen. Vor öffentlichem Vertrieb: alle Zielsysteme testen, Pakete signieren/notarisieren und einen signierten Updatekanal einrichten. Eine vollständige Offline-KI und allgemeine Fernwartung sind damit nicht zugesagt.

Unklare Geräteaktionen können nach lokaler Zustandsprüfung in „Bridge & Geräte → Letzte Geräteaktionen → Zustand geprüft“ mit einem Prüfvermerk abgeschlossen werden. Das führt keine Aktion erneut aus. Weitere verändernde Aktionen derselben Aufgabe bleiben bis dahin gesperrt; erlaubte Leseaktionen können bei der Prüfung helfen. Normale, vor Ausführung erkannte Parameter-/Freigabefehler bleiben korrigierbar.
