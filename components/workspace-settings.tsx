"use client";
import { selfHostedEdition } from "../src/core/edition";
import { AppearanceSettings } from "./workspace-appearance";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLanguage } from "./language";
import { adminGroups } from "../src/core/navigation";
const visibleAdminGroups = selfHostedEdition ? adminGroups.filter(g=>["customers","systems","security"].includes(g.id)).map(g=>g.id==="customers"?{...g,de:"Benutzer & Zugriff",en:"Users & access",items:["customers"]}:g) : adminGroups;
const adminLabels: Record<string, [string, string]> = {
  customers: selfHostedEdition ? ["Benutzer", "Users"] : ["Kunden", "Customers"],
  plans: ["Pläne", "Plans"],
  "self-hosted": ["Self-Hosted-Interessenten", "Self-hosted interest"],
  payments: ["Zahlungen", "Payments"],
  einvoices: ["E-Rechnungen", "E-invoices"],
  company: ["Firma & Stammdaten", "Company details"],
  contracts: ["Vertragserklärungen", "Contract statements"],
  provider: ["Plattform-KI", "Platform AI"],
  infrastructure: ["Server & Container", "Servers & containers"],
  mail: ["Mailserver", "Mail server"],
  site: ["Website", "Website"],
  pages: ["Eigene Seiten", "Custom pages"],
  languages: ["Sprachen", "Languages"],
  legal: ["Rechtstexte", "Legal texts"],
  analytics: ["Analyse", "Analytics"],
  marketing: ["Promotion", "Promotion"],
  security: ["Anmeldung & Sicherheit", "Sign-in & security"],
  audit: ["Audit-Protokoll", "Audit log"],
};
export function AdminNavigation({ sidebar = false }: { sidebar?: boolean }) {
  const { t } = useLanguage(),
    path = usePathname(),
    router = useRouter(),
    tab = path.split("/")[2] ?? "customers",
    group = visibleAdminGroups.find((g) => g.items.includes(tab)) ?? visibleAdminGroups[0];
  return sidebar ? (
    <div className="operator-navigation">
      <Link className="operator-back" href="/overview">
        ← {t("Zum Workspace", "Back to workspace")}
      </Link>
      <span className="nav-label">
        {t("BETREIBERKONSOLE", "OPERATOR CONSOLE")}
      </span>
      {visibleAdminGroups.map((g) => (
        <details
          className="sidebar-nav-group"
          key={g.id}
          open={g.id === group.id}
        >
          <summary>{t(g.de, g.en)}</summary>
          <nav aria-label={t(g.de, g.en)}>
            {g.items.map((key) => (
              <Link
                key={key}
                className={"nav-item" + (key === tab ? " active" : "")}
                aria-current={key === tab ? "page" : undefined}
                href={"/admin/" + key}
              >
                {t(...adminLabels[key])}
              </Link>
            ))}
          </nav>
        </details>
      ))}
    </div>
  ) : (
    <>
      <label className="operator-section-select">
        <span>{t("Adminbereich wählen", "Choose admin section")}</span>
        <select
          value={tab}
          onChange={(e) => router.push("/admin/" + e.target.value)}
        >
          {visibleAdminGroups.map((g) => (
            <optgroup key={g.id} label={t(g.de, g.en)}>
              {g.items.map((key) => (
                <option key={key} value={key}>
                  {t(...adminLabels[key])}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <nav className="operator-subnav" aria-label={t(group.de, group.en)}>
        <strong>{t(group.de, group.en)}</strong>
        {group.items.map((key) => (
          <Link
            key={key}
            className={key === tab ? "active" : ""}
            aria-current={key === tab ? "page" : undefined}
            href={"/admin/" + key}
          >
            {t(...adminLabels[key])}
          </Link>
        ))}
      </nav>
    </>
  );
}
export function SettingsHub({ state }: { state: any }) {
  const { t } = useLanguage();
  const own = state.workspace.owner_id === state.user.id,
    manage = ["owner", "admin"].includes(
      state.workspace.membership_role ?? "owner",
    );
  const groups = [
    {
      title: t("Mein Konto", "My account"),
      items: [
        [
          "/profile",
          t("Profil & Sicherheit", "Profile & security"),
          t(
            "Kontodaten, Anmeldung und Zwei-Faktor-Schutz.",
            "Account details, sign-in and two-factor protection.",
          ),
        ],
        [
          "/account/privacy",
          t("Datenschutz & Datenexport", "Privacy & data export"),
          t(
            "Einwilligungen, Aufbewahrung und Export.",
            "Consent, retention and export.",
          ),
        ],
        ...(own && !selfHostedEdition
          ? [
              [
                "/billing",
                t("Abo, Guthaben & Vertrag", "Plan, balance & contract"),
                t(
                  "Plan, Kontingente und Vertragsverwaltung.",
                  "Plan, allowances and contract management.",
                ),
              ],
              [
                "/invoices",
                t("Rechnungen & Gutschriften", "Invoices & credits"),
                t(
                  "Belege und E-Rechnungen herunterladen.",
                  "Download receipts and e-invoices.",
                ),
              ],
            ]
          : []),
      ],
    },
    {
      title: t("Diesen Workspace verwalten", "Manage this workspace"),
      items: [
        [
          "/workspaces",
          t("Workspaces", "Workspaces"),
          t(
            "Workspace wechseln oder einen weiteren anlegen.",
            "Switch workspace or create another.",
          ),
        ],
        [
          "/team",
          t("Mitglieder & Rollen", "Members & roles"),
          t(
            "Menschen einladen und ihre Zugriffsrechte verwalten.",
            "Invite people and manage their access.",
          ),
        ],
        [
          "/briefings",
          t("Benachrichtigungen & Briefings", "Notifications & briefings"),
          t(
            "Tagesübersichten und Ruhezeiten einstellen.",
            "Configure daily summaries and quiet hours.",
          ),
        ],
        ...(own
          ? [
              [
                "/settings/hosts",
                t("Eigene Rechner & Standorte", "Your hosts & locations"),
                t(
                  "Docker-Rechner verbinden und Ausführungsorte zulassen.",
                  "Connect Docker hosts and allow execution locations.",
                ),
              ],
            ]
          : []),
        ...(manage
          ? [
              [
                "/settings/budgets",
                t("Budgets & Ausweichmodelle", "Budgets & fallback models"),
                t(
                  "Standardlimits für neue Aufträge festlegen.",
                  "Set default limits for new tasks.",
                ),
              ],
            ]
          : []),
        [
          "/worklog",
          t("Arbeitsverlauf", "Work history"),
          t(
            "Ereignisse und Übergaben im gesamten Workspace.",
            "Events and handoffs across this workspace.",
          ),
        ],
      ],
    },
  ];
  return (
    <section className="settings-hub">
      <header className="workspace-page-heading">
        <div>
          <span className="scope-label">
            {t("KONTO & WORKSPACE", "ACCOUNT & WORKSPACE")}
          </span>
          <h1>{t("Einstellungen", "Settings")}</h1>
          <p>
            {t(
              "Persönliche Einstellungen und Workspace-Verwaltung an einem Ort.",
              "Personal settings and workspace administration in one place.",
            )}
          </p>
        </div>
      </header>
      <AppearanceSettings/>
      {groups.map((g) => (
        <section key={g.title}>
          <h2>{g.title}</h2>
          <div className="settings-card-grid">
            {g.items.map(([href, label, hint]) => (
              <Link className="panel settings-hub-card" key={href} href={href}>
                <strong>{label} →</strong>
                <p>{hint}</p>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </section>
  );
}
