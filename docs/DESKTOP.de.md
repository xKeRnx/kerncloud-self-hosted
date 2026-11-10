# Desktop-App: Windows, Linux und macOS

## Automatische App-Updates ab 0.38.3

Unter **App-Updates** prüft der Launcher beim Start und danach alle sechs Stunden die offizielle GitHub-Veröffentlichung. Passende Pakete werden automatisch geladen und kryptografisch geprüft. **Installieren & App neu starten** übernimmt das Update direkt. Ein bereits geladenes Update kann unter Windows/macOS beim nächsten App-Start installiert werden. Linux benötigt einen Klick und gegebenenfalls die Systemfreigabe. Die Automatik lässt sich ausschalten; manuelles Prüfen bleibt verfügbar. Ältere Launcher müssen einmal auf mindestens 0.38.3 aktualisiert werden.

Laufende Start-/Stop-/Backup-/Update-Aktionen blockieren die Installation. Container laufen beim Launcher-Update weiter. Konfiguration, Schlüssel, Datenbank, Dateien und Freigaben bleiben an ihrem bisherigen Speicherort. Eine neue Serverversion wird separat über **Lokalen Server aktualisieren** eingespielt; dabei wird vorher ein Datenbank-/Dateibackup erstellt. Interne Denkprozesse oder neue KI-Aufträge werden dafür nicht benötigt.

Die Veröffentlichung verwendet einen eigenen Ed25519-Signaturschlüssel, zeitlich begrenzte Metadaten, Versionsschutz und zwei Datei-Prüfsummen. Details zur Schlüsselverwaltung und Release-Automatik stehen in der [englischen Dokumentation](DESKTOP.md#publishing-app-updates).

Die neue **KeRnCloud Desktop-App** ist vom vorhandenen **KeRnCloud Bridge-Adapter** getrennt. Desktop startet/stoppt die eigene lokale Plattform. Bridge erteilt einem Agenten gezielt Zugriff auf ein freigegebenes Gerät.

## Was die App macht

- Lokale Plattform in einem eigenen Datenordner vorbereiten und per Docker Compose starten.
- Dashboard im isolierten App-Fenster öffnen.
- Status, Docker-Prüfung, Backups, Updates und Stoppen anbieten.
- Unter Windows/macOS optional die Desktop-App bei Anmeldung öffnen. Der Schalter startet nicht selbstständig neue KI-Aufträge.
- Geheimnisse, Datenbank und Dateien bei App-Updates oder Deinstallation erhalten.

Docker muss installiert und gestartet sein. Der erste Start baut die Container aus dem mitgelieferten Quellstand und benötigt Internet. Das ist noch kein vollständig offline vorinstalliertes Containerpaket. Die Dashboard-Webseite erhält weder Node.js-Zugriff noch Desktop-IPC. Freigaben und Anmeldung werden weiterhin serverseitig geprüft.

Die Desktop-Installation verwendet standardmäßig Port **43100** für das Dashboard und **43200** für das Gateway, damit sie neben einer Quellcode-Installation auf Port 3100 laufen kann. Die tatsächlich verwendete Adresse steht im Launcher.

## Aus dem Repository bauen

```sh
node scripts/desktop-payload.mjs
cd desktop-app
npm ci
node node_modules/electron/install.js
npm test
npm start
# Auf dem jeweiligen Zielbetriebssystem:
npm run build
```

| Plattform | Zielartefakte | Bau/Test |
| --- | --- | --- |
| Windows x64 | NSIS-Setup `.exe` | Windows-Runner oder lokaler Windows-Build |
| Linux x64/arm64 | `.AppImage`, `.deb` | Linux-Runner; GUI-Tests benötigen eine Desktop-Sitzung/Xvfb |
| macOS Intel/Apple Silicon | `.dmg`, `.zip` | macOS-Runner; Signierung/Notarisierung mit Apple-Konto |

Der Installer bietet ein Installationsverzeichnis und Verknüpfungen; Autostart ist zusätzlich in der App wählbar. Linux unterstützt den Autostart-Schalter nicht auf jedem Desktop zuverlässig; die Oberfläche zeigt ihn dort nicht an.

Die Plattformdaten liegen unter dem Electron-`userData`-Verzeichnis in `runtime/`. Typisch: Windows `%APPDATA%/KeRnCloud/runtime`, macOS `~/Library/Application Support/KeRnCloud/runtime`, Linux `~/.config/KeRnCloud/runtime`. Die Docker-Volumes sind davon getrennt. Der Datenordner enthält `.env` und Backups und gehört niemals in Git.

## Signierte Releases

Der manuell startbare Workflow `.github/workflows/desktop.yml` baut auf getrennten Windows-, Linux- und macOS-Runnern. Er veröffentlicht nichts automatisch. Der Modus `signed=true` verlangt passende Secrets und bricht ohne diese ab.

- Windows: `WIN_CSC_LINK` und `WIN_CSC_KEY_PASSWORD` als GitHub-Environment-Secrets. Für Hardware-/Cloud-Signierung den vorhandenen Signierdienst über einen separaten kontrollierten Hook anbinden.
- macOS: `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`. Developer-ID-Anwendungszertifikat verwenden.
- Linux: Desktop-Pakete lassen sich bauen; ein signiertes Paket-Repository benötigt zusätzlich eigenen GPG-Schlüssel, Repository und Freigabeprozess.

Ein gebautes Paket ist nicht automatisch signiert, notarisiert oder nativ getestet. Der Prüfbericht nennt den tatsächlich erreichten Stand. Fehlende Zertifikate werden nicht umgangen. Quellcode für dieselbe Version muss einem veröffentlichten Installer beiliegen oder verlinkt sein. [Lizenz](../LICENSE).

Automatische Desktop-Downloads/Updatefeeds werden erst nach Wahl des tatsächlichen Repositorys und nach signierter Release-Freigabe eingeschaltet. „Aktualisieren“ in der App aktualisiert den Backend-Quellstand, den das installierte Desktop-Paket mitbringt; es lädt keine ungeprüfte beliebige Quelle aus dem Internet.
