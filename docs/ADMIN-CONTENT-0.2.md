# Website, Sprachen, Seiten und Analytics

## Analytics

`/admin/analytics` lädt sofort einen rollierenden 24-Stunden-Zeitraum mit stündlicher Gruppierung. Drei Vergleichskarten zeigen gleichzeitig 24 Stunden, 30 Tage und 365 Tage. Ein Klick lädt die entsprechende Detailauswertung. Eigene Zeiträume, Gruppierung, Botfilter und Aktualisieren bleiben verfügbar. Stundenabfragen sind auf 31 Tage beschränkt.

Die Vergleichskarten blenden vermutete Bots aus. Aufrufe, aktive Konten und Klicks basieren auf Einwilligung; Registrierungen werden unabhängig davon aus dem aktuellen Kontobestand gezählt. Das ist keine Besucher-Vollerfassung. Eine kürzere Aufbewahrung bedeutet unvollständige längere Zeiträume: gelöschte Rohdaten werden nicht wiederhergestellt. Die UI zeigt die Frist und diese Einschränkung ausdrücklich an.

## Sprachen

`/admin/languages`: Deutsch und Englisch aktivieren/deaktivieren und eine aktive Standardsprache festlegen. Bestehende Installationen starten mit beiden Website-Sprachen und Deutsch als Standard. Eine explizite Auswahl über `?lang=en` bzw. `?lang=de` setzt ein separates Präferenz-Cookie, unabhängig von der optionalen Analyse. Unbekannte und deaktivierte Sprachen fallen auf die aktive Standardsprache zurück. Die HTML-Sprache und Startseiten-Metadaten folgen der wirksamen Sprache.

Übersetzt: öffentliche Landingpage, Produktvorschau, Preiseinheiten, Anmeldung/Registrierung, Workspace, Konto und Betreiberkonsole einschließlich Formularen und Meldungen, lokale technische Datenschutzhinweise, Footer und Cookie-Dialog. Beim ersten Besuch wird die Browsersprache ausgewertet; eine manuelle Auswahl bleibt vorrangig gespeichert. Eigene Inhalte werden nicht maschinell verändert. [Details und Prüfung](LANGUAGES.md).

`/admin/legal`: Rechtstexte getrennt je Sprache pflegen und veröffentlichen. Vorhandene deutsche Klartexte und Versionshistorien bleiben erhalten. Die englischen Texte müssen vom Betreiber bereitgestellt werden. Fehlen sie, erscheint ein englischer Hinweis, gegebenenfalls mit Link auf die veröffentlichte deutsche Version. Es werden keine Rechtstexte erfunden oder als geprüft ausgegeben. Eine Änderung der deutschen oder englischen Datenschutzerklärung erneuert die Version für optionale Analyse-Einwilligungen.

## Eigene Seiten

`/admin/pages`: Inhaltsseiten unter `/p/<slug>` erstellen. Pro Sprache gibt es Titel, Beschreibung, Veröffentlichung und bis zu 30 sortierbare Text-, Hinweis- und Link-Abschnitte. Textabschnitte nutzen denselben Richtext-/HTML-Editor mit bereinigter Vorschau wie Rechtstexte. Link-Abschnitte erlauben lokale Ziele und HTTP(S)-Adressen. Maximal 100 Seiten, 200.000 Inhaltszeichen je Sprachversion.

Linkpositionen sind einzeln wählbar: Website-Kopfzeile, Footer und Workspace-Sidebar. Die Reihenfolge ist einstellbar. Nur veröffentlichte Versionen aktivierter Sprachen erhalten Links. Seiten ohne Linkposition bleiben per Direktlink erreichbar, wenn veröffentlicht. Archivieren entfernt alle Links und öffentlichen Zugriffe, erhält aber Inhalte. Revisionen bleiben gespeichert; konkurrierendes Speichern einer veralteten Version wird abgewiesen. Öffentlich werden nur veröffentlichte Inhalte ausgegeben, keine fremdsprachigen Entwürfe. Diese erste Version ist ein Abschnitt-Baukasten, kein frei positionierbarer Design-Editor; Skripte, Einbettungen und externe HTML-Bilder werden entfernt.

Inhalte liegen versioniert in `settings`; es ist keine Datenmigration bestehender Kundenkonten nötig. `admin/*` bleibt serverseitig auf Administratoren beschränkt.

## Planpreise und Kalkulation

Die echten lokalen Planpreise und Kontingente wurden nicht verändert: Explorer 0 €, Starter 19 €/100.000 Credits, Business 49 €/500.000 Credits. Es ist noch kein Plattform-Modell eingerichtet. Deshalb gibt es noch keine validierte Marge aus tatsächlichem Providerverbrauch.

Unter `/admin/plans` steht ein Kalkulator. Modell-Einkauf pro Million Input-/Output-Tokens, Umrechnung USD/EUR, Credit-Tarife, Betrieb/Support je Kunde, Zahlungsgebühren und enthaltener Umsatzsteueranteil sind ausdrückliche Annahmen. Modell-Tarife können übernommen werden; die Einkaufspreise müssen dazu passend eingegeben werden. Der Rechner speichert und verändert keine Planpreise oder Abrechnungstarife.

Kostenobergrenze des Tokenverbrauchs bei vollständiger Guthabennutzung:

`Credits × max(Input-Einkauf-EUR / (1000 × Input-Credit-Tarif), Output-Einkauf-EUR / (1000 × Output-Credit-Tarif))`

Positiver Einkauf bei einem Credit-Tarif von null hat keine endliche Deckung. Der Grundpreis je Modellaufruf und Rundung können den Tokenverbrauch senken und werden für diese konservative Obergrenze ignoriert. Zusätzliche Werkzeuge, Sonderpreise, bezogene Leistungen und variable Betriebs-/Supportkosten sind gesondert zu kalkulieren. Der verbleibende Betrag ist kein Unternehmensgewinn. Servergebühren müssen je nach aktiver Kundenzahl verteilt werden, insbesondere bei kleiner Kundenzahl können sie deutlich höher als die Beispielannahme sein.

Beispiel: 1.000 Credits pro 1.000 Tokens bedeutet **ein Credit pro Token**. 500.000 Credits sind dann 500.000 Tokens, keine 500.000 Agentenaufgaben. Bei Sonnet 4.6 Standardpreisen von 3 USD Input / 15 USD Output pro Million Tokens wären 500.000 ausschließlich generierte Tokens 7,50 USD reiner Modelleinkauf. Damit sind die vorhandenen Preise nicht schon wegen der Credit-Menge zwangsläufig zu niedrig. Teure Modelle benötigen entsprechende Tarife; Aufträge verbrauchen mit jedem Schritt erneut Kontext-Tokens.

Business liefert fünfmal so viele Credits für rund 2,58-mal den Preis: etwa 48 % weniger Erlös pro Credit. Vor Verkauf sollte bewusst entschieden werden, ob dieser Mengenrabatt gewollt ist. Beispielsweise 29 €/100.000 und 79 €/300.000 Credits wären eine zu prüfende Alternative mit mehr Servicepuffer, keine bereits umgesetzte Preisänderung. Bezahlbare BYOK-Nutzung, verwaltete KI und später dedizierte Rechenumgebungen sollten separat kalkuliert werden.

Geprüfte Primärquellen, 19. Oktober 2026: [Anthropic API-Preise](https://platform.claude.com/docs/en/about-claude/pricing), [Stripe Preise für Standard-EWR-Karten](https://stripe.com/de/pricing). Der Beispiel-Wechselkurs ist keine Live-Abfrage. Abrechnung bleibt lokal deaktiviert; es wurden keine Zahlungen ausgelöst.
