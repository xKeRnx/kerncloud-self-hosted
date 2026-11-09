# Monatliche Kontingente

Aktive, manuell freigeschaltete und verschenkte Abonnements erhalten das konfigurierte Plan-Kontingent bei Aktivierung und danach automatisch am ersten Tag jedes UTC-Kalendermonats. Bei Ablauf exakt zu diesem Monatsanfang gibt es für den neuen Monat keine Zuteilung. Ein Datum innerhalb des Monats begrenzt die Gültigkeit der enthaltenen Hosting-Minuten auf dieses Datum. Freischaltung und Geschenkplan gelten ohne anteilige Kürzung für den laufenden Monat.

KI-Credits werden hinzugefügt; ungenutzte Credits bleiben nach der bestehenden Guthabenlogik erhalten, bis zur bisherigen Kontogrenze von 100 Millionen Credits. Plan-Minuten werden erneuert statt addiert. Nachgekaufte und einzeln geschenkte Minuten bleiben erhalten; offene Laufzeitkorrekturen werden zuerst ausgeglichen. Einmalige Geschenk-Credits und -Minuten werden nicht monatlich erneut vergeben.

Stripe-Abos erhalten ihre Kontingente weiterhin über bestätigte bezahlte Monatsrechnungen. Die neue Kalenderautomatik ist für Stripe-Konten gesperrt, damit keine zusätzliche kostenlose Zuteilung erfolgt. Fehlgeschlagene Zahlungen, deaktivierte Pläne, gesperrte Nutzer und abgelaufene oder nicht aktive Zugänge werden nicht automatisch versorgt. Der Entwicklungsstatus local_test behält seine getrennte bisherige Test-Minutenlogik; für reguläre und Geschenk-Abos wird active verwendet.

Der Abgleich läuft über Worker-Wartung und den Docker-Healthcheck, auch ohne Kundenbesuch. Außerdem wird er vor Kontoanzeige, Statistik, Modellverarbeitung und Laufzeitnutzung für das betreffende Konto ausgeführt. Nach einem Ausfall wird das aktuelle Kontingent nachgeholt; frühere verpasste Monate werden nicht als Guthaben angesammelt. Ohne laufende App findet kein Abgleich statt.

Eine Datenbankzeilensperre und der eindeutige Schlüssel Konto/UTC-Monat verhindern Doppelbuchungen über Worker, App-Instanzen, manuelle Abgleiche und Planwechsel hinweg. Ein Planwechsel oder eine erneute Freischaltung im bereits gebuchten Monat erhöht das Monatskontingent nicht erneut. Die bestehende Geschenkfunktion kann ausdrücklich zusätzliche einmalige Kulanz buchen. Stripe-Zuteilungen bleiben getrennt durch Rechnungs-ID geschützt.

Jede neue Monatszuteilung erscheint im Credit- bzw. Laufzeitkonto und im Audit-Protokoll. Automatische Freischaltungen und Geschenke erzeugen weder Zahlung noch Steuerrechnung oder E-Mail. Bei Verkürzung oder Verlängerung des Zugangs wird die Gültigkeitsgrenze des laufenden Kontingents angepasst, ohne Guthaben neu zu vergeben.

Die Migration 16 erweitert lediglich die vorhandene Zuteilungstabelle um Quelle und Gültigkeitsende. Bereits gebuchte Monatskontingente bleiben wirksam und werden nicht nochmals gebucht. Tests mit simulierten Monatswechseln laufen ausschließlich in kerncloud_test; die Hauptinstanz verwendet die echte Uhrzeit.
