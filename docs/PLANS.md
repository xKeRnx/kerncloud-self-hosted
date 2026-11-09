# Begrenzte lokale Planvorlagen

Migration 12 ändert ausschließlich die unveränderten lokalen Standardpläne ohne Stripe-Preis-ID. Individuelle oder bereits mit Stripe konfigurierte Preispläne werden nicht automatisch neu bepreist. Bestehende Guthaben, Dateien und Benutzer werden nicht reduziert oder gelöscht. Es werden keine externen Stripe-Produkte angelegt und keine Abonnements abgeschlossen.

| Kontingent | Starter · 19 € | Pro · 49 € | Business · 99 € |
|---|---:|---:|---:|
| Workspaces | 1 | 3 | 10 |
| Agenten je Workspace | 3 | 6 | 12 |
| Modellaufrufe je Auftrag | 30 | 60 | 100 |
| Modellaufrufe je Kalendermonat (UTC) | 300 | 1.500 | 5.000 |
| Gleichzeitige Agentenaufgaben pro Konto | 1 | 2 | 4 |
| Enthaltene KI-Credits | 50.000 | 150.000 | 400.000 |
| Eigene Kunden-Rechner | 1 | 2 | 5 |
| Lokale Umgebungsplätze | 1 | 3 | 10 |
| Gleichzeitig lokal laufend | 1 | 2 | 4 |
| Gehostete Plätze | 0 | 1 | 2 |
| Gleichzeitig gehostet | 0 | 1 | 2 |
| Hosting-Minuten je Zeitraum | 0 | 60 | 300 |

Explorer bleibt eine begrenzte Demo mit eigener KI, einem Workspace, 30 Modellaufrufen pro Kalendermonat und ohne neue Kunden-/Hosting-Umgebungen. Bestehende Agenten und Workspaces werden bei einer Limitänderung nicht automatisch gelöscht.

Monatliche Modellaufrufe werden atomar pro Konto gezählt; sie gelten gemeinsam für alle Workspaces, BYOK und Plattform-KI. Ein begonnener Anbieteraufruf und eine automatische Wiederholung zählen jeweils als Aufruf. Kontingente werden beim Planwechsel nicht erneut auf null gesetzt. Bei Erschöpfung wartet die Aufgabe auf eine Prüfung; es gibt keinen stillen Mehrverbrauch und keine automatische Nachbelastung. Die Registrierung der Nutzung beginnt mit dieser Migration; frühere Aufrufe werden nicht rückwirkend als neues Kontingent belastet. Die Parallelitätsgrenze wird beim Worker-Claim über alle Workspaces geprüft.

KI-Credits sind keine feste Zahl von Tokens und kein fest zugesagter Eurobetrag. Eingabe, Ausgabe und Grundpreis werden je Modell im Betreiberkatalog berechnet. Eigene KI verbraucht keine Betreiber-KI-Credits, wohl aber Plattform-Modellaufrufe. Beim Hinzufügen eines teuren Modells muss sein Credit-Tarif die tatsächlichen Einkaufskosten abdecken. Ein großes Ausgabe-Maximum kann außerdem eine hohe vorläufige Reservierung benötigen. Unbekannter Verbrauch wird nicht als gemessene Tokenzahl ausgegeben; eine unklare Betreiber-Reservierung bleibt zur Prüfung erhalten.

## Kalkulation

Der Admin-Rechner berücksichtigt neben KI-Einkauf, Zahlungsgebühren und Support jetzt enthaltene Hosting-Minuten und Kosten je reserviertem Hosting-Platz. Eigene Kundenhardware erzeugt dort keine Hosting-Kosten. Die voreingestellten 0,01 €/Minute, 1 €/Platz und 5 €/Kunde sind ausdrücklich Rechenannahmen und keine garantierten Einkaufspreise. Für die eigene Installation müssen Last, Speicher, Backups, Traffic, Supportzeit und tatsächlich genutzte Anbieter eingesetzt werden. „Verbleibend“ ist kein Unternehmensgewinn.

Als vorhandenes Preisbeispiel bleibt Sonnet 4.6 mit 3 USD Eingabe / 15 USD Ausgabe je Million Tokens hinterlegt, am 20.10.2026 anhand der [offiziellen Anthropic-Preise](https://platform.claude.com/docs/en/about-claude/pricing) geprüft. Bei 0,95 EUR/USD und 1.000 Credits je 1.000 Tokens entsprechen 50.000 Credits höchstens ca. 0,71 € reinem Token-Einkauf unter diesen Annahmen, 150.000 ca. 2,14 € und 400.000 ca. 5,70 €. Das gilt nur für diese Tarife und Tokenarten; externe Werkzeuge, besondere Tarife und andere Modelle können teurer sein.

Alle neuen Kontingente sind im Adminpanel bearbeitbar. Hosting-Minuten bleiben getrennt nachkaufbar, sofern passende Produkte und echte Zahlungsintegration konfiguriert sind. Ein geänderter lokaler Preis aktualisiert kein bestehendes Stripe-Preisobjekt. Öffentlicher Verkauf und verbindliche Preise müssen separat in der jeweiligen Zahlungsinstallation eingerichtet und geprüft werden.
