# Signierte Bridge-Releases für KeRn-WS

Herausgeber-Metadaten: **KeRn-WS**, Einzelunternehmen, <https://kern-ws.com>, <support@kern-ws.com>.
Der Zertifikatsanbieter prüft die rechtliche Identität. Bei einem Einzelunternehmen kann der vollständige Name des Inhabers Teil des Zertifikatsnamens sein. `expectedSubject` und die Apple-Identität müssen deshalb exakt den tatsächlich ausgestellten Zertifikaten entsprechen. Der Markenname allein ist kein Identitätsnachweis.

Diese Pipeline ist vorbereitet. Es wurde noch kein öffentlich vertrauenswürdiges Zertifikat hinterlegt und keine Signatur für Kunden erstellt. Die bisher angebotenen Vorschaupakete bleiben unverändert.

## Gemeinsame Einrichtung

Im Ordner `bridge-app`:

1. `npm ci` installiert die bereits festgeschriebenen Build-Abhängigkeiten.
2. `signing.example.json` nach `.signing/config.json` kopieren und die Felder des gewünschten Systems ausfüllen. Alternativ `BRIDGE_SIGNING_CONFIG` auf eine lokale JSON-Datei setzen.
3. Zertifikate und Geheimnisse im Betriebssystem-Zertifikatsspeicher, Schlüsselbund oder geschützten CI-Speicher einrichten. Die JSON-Datei enthält nur Referenzen, öffentliche Identitätsangaben und Fingerprints. Passwörter, Tokens und private Schlüssel werden dort abgewiesen.
4. Mit `npm run signing:check -- windows`, `macos` oder `linux` die Konfiguration prüfen. Diese Prüfung erstellt keine Signatur und bestätigt noch keine erfolgreiche Anmeldung beim Anbieter.
5. Für einen echten Signierlauf `BRIDGE_RELEASE_MODE=signed` setzen und den jeweiligen Release-Befehl ausführen. Ohne diese ausdrückliche Auswahl bleiben die bisherigen Build-Befehle Vorschau-Builds. Ein Signierfehler führt immer zum Abbruch; es gibt keinen automatischen Rückfall auf unsignierte Pakete.

`.signing/`, private Zertifikatsdateien und `dist-signing/` sind aus Git, dem Anwendungs-Dockerkontext und den App-Paketen ausgeschlossen. Private Schlüssel bleiben außerhalb des App-Quellordners. Das Zertifikat selbst muss nicht in die KeRnCloud-Web-App oder ein Adminformular hochgeladen werden. Nur der Release-Rechner benötigt Signierberechtigungen.

Ergebnisse entstehen pro Build in `dist-signing/<system>/<version>/build-.../`. `release.json` wird erst nach bestandenen Prüfungen geschrieben und enthält finale SHA-256-Werte, Größe, Herausgeber und die genaue Art des Signaturnachweises. Es werden keine Dateien automatisch ins Internet hochgeladen oder in die bisherigen öffentlichen Downloads übernommen. Neue Releases bekommen eine neue Versionsnummer; bereits veröffentlichte Archive niemals überschreiben. Die PDF-Anleitungen vor einem Release aktualisieren und rendern.

## 1. Windows

Benötigt: Windows-Buildrechner, Node.js, NSIS 3.08 oder neuer und das Windows-SDK-SignTool. Für Azure zusätzlich die offiziellen Artifact Signing Client Tools einschließlich Dlib und .NET Runtime. `BRIDGE_MAKENSIS` kann auf `makensis.exe` zeigen; sonst wird es aus PATH geladen.

### Variante A: Microsoft Artifact Signing

In `windows` setzen:

- `provider`: `azure`.
- `signtool`: absoluter Pfad zum offiziellen x64-SignTool.
- `expectedSubject`: vollständiger erwarteter Zertifikats-Subject, wie ihn Windows anzeigt, einschließlich aller DN-Felder.
- `azure.endpoint`, `azure.account`, `azure.profile`: freigeschaltetes **Public Trust**-Profil. Private Trust ist für Kundendownloads ungeeignet.
- `azure.dlib`: Pfad zur passenden x64-Artifact-Signing-DLL.
- `timestampUrl`: Microsoft-Zeitstempeldienst ist vorbelegt.

Die Identitätsprüfung erledigt der Inhaber im Azure-Portal. Für ein deutsches Einzelunternehmen muss Microsoft den Organisationsweg akzeptieren; die vorbereitete Integration setzt keine Zulassung voraus. Auf dem Release-Rechner per Azure CLI anmelden oder eine eng begrenzte CI-Identität mit der Rolle **Artifact Signing Certificate Profile Signer** für dieses Profil verwenden. Kein Client-Secret gehört in das Repository. Die Microsoft-Dlib verwendet die eingerichtete Azure-Authentifizierung.

### Variante B: Zertifikat im Windows-Speicher

- `provider`: `certificate-store`.
- SignTool-Pfad und `expectedSubject` wie oben setzen.
- `certificateStore.thumbprint`: exakt der 40-stellige SHA-1-Zertifikat-Fingerprint zur Auswahl; die Dateisignatur selbst verwendet SHA-256.
- `store`: `My`; `machineStore`: `false` für den aktuellen Benutzer, sonst `true`.
- `timestampUrl`: RFC-3161-Dienst des Zertifikatsanbieters, z.B. dessen HTTPS-Endpunkt.

Der Zertifikatsanbieter richtet den privaten Schlüssel im unterstützten Hardware-/Cloud-Schlüsselspeicher ein. Die Pipeline nimmt keine PFX-Datei oder deren Passwort als Kommandozeilenargument entgegen. Vorhandene PFX/P12-Dateien nur nach Vorgabe des Anbieters lokal importieren.

PowerShell, im Ordner `bridge-app`:

```powershell
$env:BRIDGE_RELEASE_MODE = 'signed'
npm run signing:check -- windows
npm run release:windows
```

Die App wird frisch gepackt; EXE-, DLL- und native NODE-Dateien werden signiert. NSIS signiert den Uninstaller vor dem Einbetten über `!uninstfinalize`; jeder Fehler stoppt den Compiler. Danach werden Setup und Portable-ZIP erzeugt. SignTool prüft die Vertrauenskette; Windows prüft zusätzlich Subject, gegebenenfalls Thumbprint und Zeitstempel. Erst dann wird der Release-Nachweis geschrieben. Es wird niemals ein Signierkennwort in eine Shell-Kommandozeile eingebaut.

Eine Signatur garantiert keine sofortige SmartScreen-Reputation. Der neue Herausgeber kann anfangs weiterhin Warnungen sehen. Normale Windows-/Unternehmensrichtlinien bleiben wirksam.

## 2. macOS

Benötigt: Mac mit Xcode und Command Line Tools, Apple-Developer-Mitgliedschaft sowie **Developer ID Application**-Zertifikat mit privatem Schlüssel im Schlüsselbund. Für unsere DMG-Verteilung ist kein Developer ID Installer-Zertifikat erforderlich; dieses wäre für ein künftiges PKG relevant.

In `macos` setzen:

- `identity`: vollständige Identität, z.B. `Developer ID Application: <verifizierter Name> (<TEAM-ID>)`.
- `teamId`: zehnstellige Apple-Team-ID; muss zur Identität passen.
- `keychain`: optionaler Pfad zu einem eigenen Build-Schlüsselbund außerhalb des Quellordners.
- `notaryProfile`: vorher lokal gespeichertes Notarytool-Zugangsdatenprofil.
- `notaryKeychain`: optionaler Schlüsselbund dieses Profils.

Die Notarisierungsanmeldung einmal interaktiv speichern:

```sh
xcrun notarytool store-credentials "kern-ws-bridge-notary"
```

Die Abfrage direkt im Terminal mit den bei Apple vorgesehenen Zugangsdaten beantworten. Alternativ unterstützt Notarytool geschützte App-Store-Connect-API-Zugangsdaten im Schlüsselbund. Keinen privaten API-Schlüssel ins Projekt kopieren. Den gewählten Profilnamen in der lokalen JSON-Datei hinterlegen.

```sh
export BRIDGE_RELEASE_MODE=signed
npm run signing:check -- macos
npm run release:macos
```

Der Build erstellt Apple-Silicon- und Intel-Apps. Electron Packager signiert die verschachtelten Komponenten mit Hardened Runtime. Codesign prüft Integrität, Team-ID, Developer ID und Zeitstempel. Die App wird notarisiert und das Ticket angeheftet; Gatekeeper muss sie akzeptieren. Danach werden die DMGs erstellt, signiert, ebenfalls notarisiert und mit angeheftetem Ticket geprüft. Nur `Accepted` erzeugt einen Release-Nachweis. Sicherheitsabfragen für Dateien, Bildschirm, Bedienungshilfen usw. werden nicht umgangen. Dieser echte Ablauf kann erst auf einem Mac mit gültigem Konto vollständig geprüft werden.

## 3. Linux: signiertes APT-Repository

Benötigt: Linux-Rechner mit `gpg`, `gpgv`, `dpkg-deb` und `dpkg-scanpackages` (Paket `dpkg-dev`). Den eigenen Release-Schlüssel außerhalb des App-Quellordners mit GnuPG erstellen und schützen; vorhandene Schlüssel können weiterverwendet werden. Ein Passwort wird über gpg-agent entsperrt, nicht per Kommandozeile oder JSON übergeben.

In `linux` setzen:

- `fingerprint`: vollständiger primärer OpenPGP-Fingerprint, keine kurze Schlüssel-ID.
- `gnupgHome`: optionaler externer GnuPG-Ordner.
- `repositoryUrl`: tatsächliche HTTPS-Adresse des später veröffentlichten Repositorys. `https://kern-ws.com/downloads/bridge/apt` ist nur der vorbereitete Zielpfad und noch kein veröffentlichter Dienst.
- `suite`, `component`, `validDays`: `stable`, `main`, 14 Tage sind vorbelegt. Abgelaufene Release-Metadaten vor Ablauf erneut signieren und veröffentlichen.

Das Debian-Paket zuerst mit den bestehenden Vorschau-Builds erstellen. Es muss dieselbe Version wie package.json enthalten:

```sh
npm run build:installers
export BRIDGE_RELEASE_MODE=signed
npm run signing:check -- linux
npm run release:linux -- /absoluter/pfad/kerncloud-bridge-<version>-linux-amd64.deb
```

Die Pipeline erstellt Packages/Packages.gz und zeitlich begrenzte Release-Metadaten mit SHA-256, signiert Release.gpg und InRelease und prüft beide mit gpgv gegen den exakt konfigurierten öffentlichen Schlüssel. `signed:false` beim DEB bleibt bewusst erhalten: APT authentifiziert die Repository-Metadaten samt Paket-Hashes; es entsteht keine eingebettete DEB-Signatur.

Der erzeugte Ordner `apt/` wird erst bei einem später ausdrücklich freigegebenen Deployment vollständig unter `repositoryUrl` veröffentlicht. Kunden erhalten den öffentlichen Schlüssel mit separat prüfbarem Fingerprint und die erzeugte Deb822-Datei. Den verifizierten öffentlichen Schlüssel nach `/usr/share/keyrings/kern-ws-archive-keyring.gpg` und die Sources-Datei nach `/etc/apt/sources.list.d/kern-ws-bridge.sources` übernehmen. Danach funktionieren `apt update` und `apt install kerncloud-bridge` mit Repository-Authentifizierung. Kein `apt-key`, kein `trusted=yes`, kein Abschalten von Signaturprüfungen.

## Prüfung und Betrieb

- `npm test` im Bridge-Ordner prüft die lokalen Schutzregeln. Die zusätzlichen Signing-Tests verwenden ausschließlich eindeutig getrennte Fixtures.
- `node --test tests/signing-integration.test.cjs` auf einem Linux-Testrechner prüft einen echten, temporären GPG-Schlüssel, Paketindex und APT-Verifikation ohne Kundenkonto oder Veröffentlichung.
- Nach Einrichtung echter Konten: Windows-Signatur einschließlich eingebettetem Uninstaller auf einem frischen Windows-System und notarisierten Mac-Download auf einem Mac testen. Diese Prüfungen werden nicht durch Fixture-Tests ersetzt.
- Signierberechtigungen nur dem Release-Prozess geben. Keine Signierfunktion für Kundenagenten, Bridge-Geräte oder das Adminpanel bereitstellen.
- Erst nach bestandenen Plattformprüfungen die erzeugten Kandidaten samt finalen Prüfsummen in einen vollständigen neuen Download-Release übernehmen. Das ist ein eigener Veröffentlichungsschritt; diese Vorbereitung löst ihn nicht aus.

Offizielle Referenzen: [Microsoft Artifact Signing](https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-signing-integrations), [NSIS uninstfinalize](https://nsis.sourceforge.io/Docs/Chapter5.html), [Electron Code Signing](https://www.electronjs.org/docs/latest/tutorial/code-signing), [Apple Developer ID](https://developer.apple.com/developer-id/), [APT-Authentifizierung](https://manpages.debian.org/bookworm/apt/apt-secure.8.en.html).
