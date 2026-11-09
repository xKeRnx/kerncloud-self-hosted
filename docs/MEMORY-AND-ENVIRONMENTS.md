# Projektgedächtnis und spätere Arbeitsumgebungen

## Implementiertes Gedächtnis

Unter **Projektgedächtnis** werden Wissen, Entscheidungen, Arbeitspakete und Arbeitsvermerke je Workspace gespeichert. Einträge haben einen stabilen Schlüssel, aktuellen Arbeitsstand, zuständigen Agenten, Quellen/Belege, Versionsnummer und Zeitstempel. Nutzer können Einträge schützen und nach eigener Prüfung bestätigen. Agenten können keine Nutzerbestätigung vergeben und keine geschützten Angaben überschreiben.

Agenten erhalten einen begrenzten Indexauszug bei Aufgabenbeginn und vor weiteren Modellschritten. `search_memory`, `read_memory` und `write_memory` liefern aktuelle Daten. Volltexte werden gezielt gelesen; es wird keine komplette Chatgeschichte unbegrenzt an jeden Anbieter geschickt. Diese erste Suche verwendet PostgreSQL-Volltextsuche und Titelabgleich, keine externen Embeddings.

Geänderte Einträge benötigen ihre aktuelle Versionsnummer. Veraltete Schreibversuche werden abgelehnt. Ein als „in Arbeit“ übernommenes Arbeitspaket darf ein anderer Agent nicht über das Gedächtnis überschreiben. Unterschiedliche Schlüssel mit gleicher Bedeutung kann die erste Version nicht automatisch als identische Arbeit erkennen. Ein Modell muss bestehende Einträge tatsächlich prüfen und die vorgesehenen Werkzeuge verwenden; doppelte Arbeit lässt sich dadurch reduzieren, nicht generell ausschließen. Bei verwaisten Zuständigkeiten kann der Nutzer die Zuweisung ändern.

Beim Abschluss eines Auftrags wird aus den gespeicherten Aufgabenergebnissen ein unbestätigter Arbeitsvermerk erstellt bzw. aktualisiert. Geschützte oder manuell bearbeitete Vermerke werden dabei nicht überschrieben. Eine Modellantwort „gebaut“ ist kein Nachweis für vorhandenen Quellcode. Bei Reviews sind aktueller Commit, Dateien, Änderungen und tatsächliche Testprotokolle maßgeblich. Die lokale Version hat weiterhin keinen Codeausführungs- oder Browser-Sandboxdienst; importierte Repositories sind begrenzte Text-Snapshots.

Bis 100 Einträge je Workspace, 8.000 Zeichen je Inhalt, zehn vorherige Inhaltsversionen. Geschütztes und manuell gepflegtes Wissen bleibt bis zur bewussten Löschung erhalten. Automatische Arbeitsvermerke folgen der Workspace-Aufbewahrung, sofern sie nicht geschützt sind. Kontoexport umfasst Gedächtnis und vorhandene Versionen. Löschen eines Eintrags entfernt auch seine gespeicherten Versionen; Kontolöschung entfernt die zugehörigen Gedächtnisdaten. Backups brauchen weiterhin einen separaten Löschprozess.

**knowledge.md herunterladen** erzeugt eine lesbare Markdown-Ansicht des aktuellen Workspace-Gedächtnisses. Die Datenbank ist die gemeinsame Quelle für parallele Worker; getrennte Container schreiben nicht unkontrolliert dieselbe Textdatei.

Hermes verfolgt ein verwandtes Ziel mit MEMORY.md, USER.md und Projekt-Kontextdateien. Die konkrete Dateiaufteilung beschreibt die [offizielle Hermes-Dokumentation](https://hermes-agent.nousresearch.com/docs/user-guide/which-file-does-what).

## Geplante buchbare Umgebungen – noch nicht implementiert

Eine zusätzliche Umgebung kann später einem Workspace zugeordnet werden: Entwicklungsumgebung mit Git und Terminal, persönlicher Browser mit eigenem Profil oder Analyseumgebung mit Ghidra. Ghidra bietet einen [Headless-Modus](https://github.com/NationalSecurityAgency/ghidra/blob/master/Ghidra/RuntimeScripts/support/analyzeHeadlessREADME.md) für automatisierte Analysen; für eine grafische Oberfläche ist zusätzlich ein abgesicherter Desktop-Zugang im Browser erforderlich.

Vorgesehener Ablauf:

1. Nutzer wählt eine freigegebene Umgebung und ein Ressourcen-/Zeitbudget.
2. Ein gesonderter Runner startet sie auf einem passenden Ausführungsserver und bindet ausschließlich ihr Workspace-Volume ein.
3. Agenten greifen über eng begrenzte Werkzeuge auf Terminal, Browser oder Analysedienst zu. Die SaaS-App stellt weder Docker-Socket noch Host-Dateisystem für Kundencode bereit.
4. Ergebnisse, Dateien, Commit-IDs und echte Ausführungsprotokolle werden dem Auftrag zugeordnet; das Projektgedächtnis vermerkt den überprüfbaren Arbeitsstand.
5. Nutzer sieht Live-Ausgabe, Start/Stopp, Laufzeit und Verbrauch. Leerlauf-Stopp begrenzt Kosten; dauerhafter Betrieb ist ein gesondertes Angebot.

CPU, RAM, Speicher, Prozesse, Netzverkehr und Laufzeit müssen begrenzt werden. Docker setzt diese Grenzen nicht automatisch passend für Kundenumgebungen; siehe [Ressourcenlimits](https://docs.docker.com/engine/containers/resource_constraints/). Für beliebigen fremden Code ist die erforderliche Isolationsstärke gesondert zu prüfen, ggf. mit separaten VMs/MicroVMs. Pro-Workspace-Netze, kurzlebige Zugänge, geprüfte Images, kontrollierter ausgehender Verkehr und Backups gehören zur Runner-Implementierung.

Modell-Credits, gespeicherter Speicher und tatsächliche Umgebungs-Laufzeit sollten separat kalkuliert und im Adminpanel begrenzt werden. Eine genaue Preiszusage ist erst nach Ressourcenmessungen sinnvoll. Die Plattform kann Arbeit innerhalb einer freigegebenen Umgebung ermöglichen; auf dem privaten Rechner des Kunden benötigt sie einen ausdrücklich verbundenen lokalen Runner und entsprechende Berechtigungen.
