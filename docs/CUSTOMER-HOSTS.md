# Eigene Kunden-Rechner

Unter **Browser & Entwicklungsumgebungen → Eigene Rechner & Ausführungsorte** kann ein zahlender Kunde Linux Docker Engine oder Docker Desktop mit Linux-Containern verbinden. Das Einrichtungspaket enthält den Connector, Quelltexte, Dockerfiles für neue Browser-/Entwicklungsumgebungen und einen privaten, nur für diesen Rechner und dieses Kundenkonto gültigen Schlüssel. Es enthält keinen Plattform-Worker-Schlüssel und keine Datenbank- oder Betreiber-Zugangsdaten. Der Server speichert nur den Schlüsselhash. Das Paket ist vertraulich; nach Verlust eine neue Einrichtung erzeugen und damit den alten Schlüssel ersetzen.

Paket entpacken und im Paketordner ausführen:

```sh
docker compose --profile images build
docker compose up -d connector
```

Die Images werden aus dem mitgelieferten Quelltext lokal gebaut. Der vertrauenswürdige Connector benötigt den lokalen Docker-Socket. Das ist ein weitreichender lokaler Verwaltungszugriff; [Docker beschreibt die Sicherheitsgrenze des Daemons](https://docs.docker.com/engine/security/protect-access/). Der Socket wird weder im Internet freigegeben noch in die Browser-/Entwicklungscontainer gemountet. Die eigentlichen Arbeitsumgebungen laufen als UID 1000 mit schreibgeschütztem Root-Dateisystem, begrenzter CPU/RAM-Nutzung und eigenen Arbeitsvolumes. Der Connector akzeptiert nur die bekannten KeRnCloud-Images und bearbeitet seine mit einer eindeutigen Hostkennung markierten Ressourcen. Bereits vorhandene beliebige Kundencontainer werden nicht übernommen.

Der Connector verwendet das vorhandene Docker-Bridge-Netz. Arbeitsumgebungen erhalten kleine /28-Netze aus `INFRA_DOCKER_SUBNET_POOL` (Standard `10.240.0.0/16`). Vor der Anlage werden bestehende Docker-Netze auf Überschneidung geprüft. Der Kunde kann den Bereich in `.env.connector` ändern, etwa bei Konflikten mit einem Firmen-/VPN-Netz. Vorhandene fremde Netze werden nicht entfernt.

## Auswahl pro Workspace

Der Kunde markiert die erlaubten eigenen Rechner und kann KeRnCloud-Hosting unabhängig davon aktivieren oder ausschalten. Mehrere eigene Rechner und eine Kombination mit Hosting sind möglich. Die Auswahl begrenzt die Agentenliste und wird vor Ausführung, während einer laufenden Aktion und bei Ergebnisannahme serverseitig geprüft. Abwahl widerruft noch laufende Aktionen; bereits ausgelöste Wirkungen können bestehen bleiben.

Jede Umgebung wird beim Anlegen ausdrücklich einem Ort zugeordnet. Ein ausgefallener Rechner führt zu einer Fehlermeldung bzw. einem Wartezustand. Es gibt keinen automatischen Wechsel zu einem anderen Rechner oder zur Cloud und keine automatische Verschiebung von Dateien. Agenten benötigen zusätzlich eine Freigabe für Dateien, Befehle oder Browsersteuerung; die Rechnerauswahl allein vergibt diese Rechte nicht.

Lokale und gehostete Umgebungsplätze werden getrennt über alle Workspaces des Kontos gezählt. Lokale Umgebungen verwenden eigene Hardware und verbrauchen keine verkauften Hosting-Minuten. Die Plattform-Kontingente für Modellaufrufe und gleichzeitig laufende Agentenaufgaben gelten auch für eigene KI und eigene Rechner. Cloud-Hosting verwendet weiterhin die vorhandenen Laufzeitkontingente und Guthabenregeln.

## Daten und Zugang

Dateien und Prozesse liegen im eigenen Container. Steuerdaten, Inventar, Chat, gelesene Inhalte, Werkzeugausgaben und ausdrücklich gespeicherte Ergebnisse werden weiterhin durch KeRnCloud verarbeitet und können als Modellkontext zum gewählten KI-Anbieter gelangen. Diese Funktion ist kein vollständig lokaler oder Ende-zu-Ende-verschlüsselter KI-Betrieb. Die Ausführungsort-Auswahl ist keine Zusage, dass keinerlei Inhalte die Hardware verlassen.

Der geschützte Browser-/Editorzugang und die Agentensteuerung verwenden den bestehenden ausgehenden Relay-Kanal. Für öffentliche Installationen müssen `PUBLIC_URL` und `PUBLIC_ENVIRONMENT_URL` auf korrekte HTTPS-Domains zeigen; der Relay nutzt WSS. Die Umgebung braucht eine getrennte Origin. Die lokale Testkonfiguration verwendet bewusst `host.docker.internal` und die lokalen Ports der Plattform/des Gateways.

**Trennen** widerruft den Connector-Schlüssel und sperrt den Cloud-Zugang. Ein offline befindlicher Rechner lässt sich damit nicht physisch stoppen; seine Container gegebenenfalls lokal prüfen und stoppen. Deaktivierte Verbindungen behalten ihren Planplatz und können mit neuer Einrichtung wieder aktiviert werden. Vor Kontolöschung müssen Umgebungen über den bestehenden Ablauf entfernt werden. Der Datenexport enthält eigene Rechner, Standortauswahl und Modellschritt-Nutzung, aber keine Connector- oder Relay-Schlüssel.

Start/Stopp erhält die Dateien. Neuaufsetzen und Entfernen verwenden die vorhandene Namensbestätigung. Abgebrochene oder unbestätigte externe Operationen werden nicht still erneut ausgeführt. Der Kunde sollte den konkreten Ressourcenstatus prüfen, bevor ein unklarer Vorgang fortgesetzt wird.
