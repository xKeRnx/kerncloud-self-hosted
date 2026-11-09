"use client";
import { useWorkspaceAppearance } from "./workspace-appearance";
import type { ThemePreference } from "@/src/core/appearance";
import { KernCloudLogo } from "./kerncloud-logo";
import { BridgePanel } from "./bridge-panel";
import { CustomerHosts } from "./customer-hosts";
import { TaskWorkflow } from "./task-workflow";
import { ProjectResults } from "./project-results";
import { WorkspaceHome, WorkspaceWork } from "./workspace-home";
import { NewTaskForm } from "./new-task-form";
import { AdminNavigation, SettingsHub } from "./workspace-settings";
import { RuntimeInsights } from "./runtime-insights";
import { AgentInspector } from "./agent-inspector";
import { EnvironmentOverview } from "./environment-overview";
import {
  ProjectContext,
  WorkspaceProjects,
  WorkTimeline,
  OrganisationChart,
} from "./organisation-suite";
import { WorkAppsPanel, ProjectsPanel, QualityPanel } from "./workspace-suite";
import {
  TeamPanel,
  KnowledgePanel,
  BriefingPanel,
  EnvironmentBudgets,
} from "./workspace-collaboration";
import { mergePage } from "@/src/core/state-cursor";
import { ScalingStatus } from "./scaling-status";
import { DecisionInbox } from "./decision-inbox";
import { UsageDashboard } from "./usage-dashboard";
import { AutomationsPanel } from "./automations-panel";
import { RunProcesses } from "./run-processes";
import { WorkspaceNavigation } from "./workspace-navigation";
import { LocalUsers } from "./local-users";
import { AdminSelfHosted } from "./admin-self-hosted";
import { AdminCustomers, AdminMail } from "./admin-customers";
import { AdminCompany, AdminContracts } from "./admin-company";
import { AdminElectronicInvoices } from "./electronic-invoices";
import { RequiredPasswordChange } from "./password-recovery";
import { AccountBenefits } from "./account-benefits";

import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useRef,
  useEffect,
  useState,
  useId,
  cloneElement,
  isValidElement,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Blocks,
  BookOpen,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Code2,
  Coins,
  Command,
  FileText,
  FolderKanban,
  Gauge,
  LayoutDashboard,
  Loader2,
  Megaphone,
  MessageSquare,
  MoreHorizontal,
  Pause,
  Play,
  Plug,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Send,
  Server,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Users,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import type {
  Agent,
  Campaign,
  Connection,
  Event,
  Plan,
  Run,
  Skill,
  Snapshot,
  Task,
  User,
  Workspace,
} from "@/src/core/types";
import {
  api,
  selectWorkspace,
  selectProject,
  setProjectScope,
} from "./api-client";
import {
  RunPolicySettings,
  SkillReview,
  CheckpointPanel,
} from "./agent-safety";
import { ModelCatalog } from "./model-catalog";
import { MaterialsPanel, RunAttachments } from "./materials-panel";
import { TeamChat } from "./team-chat";
import { RunResults } from "./run-results";
import { MemoryPanel } from "./memory-panel";
import { AccountPanel, WorkspacesPanel, InvoicesPanel } from "./account-panel";
import { AccountMenu } from "./account-menu";
import { MfaLogin, SocialLogin, AdminLoginProviders } from "./login-security";
import {
  AdminInfrastructure,
  CustomerEnvironments,
} from "./infrastructure-panel";
import { AdminLanguages, AdminPages } from "./admin-content";
import { PlanCalculator } from "./plan-calculator";
import { CustomWorkspaceLinks } from "./custom-links";
import { LanguageSwitcher, useLanguage } from "./language";
import { AdminBusiness, AdminAnalytics } from "./admin-business";
import type { ModelOffering } from "@/src/core/types";
import {
  resolveWorkspacePath,
  workspacePaths,
  projectPath,
  projectViews,
  type WorkspaceView as View,
} from "@/src/core/navigation";
type Artifact = { id: string; run_id: string; name: string; content: string };
function runTitle(goal: string) {
  const line = goal.trim().split(/\r?\n/, 1)[0].replace(/\s+/g, " ");
  return line.length > 120 ? line.slice(0, 117).trimEnd() + "…" : line;
}
type State = Snapshot & {
  appearance?: {theme: ThemePreference; canSave: boolean};
  artifacts: Artifact[];
  ledger: { amount: number; reason: string; created_at: string }[];
};
type AdminState = {
  models: ModelOffering[];
  users: User[];
  workspaces: (Workspace & { email: string })[];
  plans: Plan[];
  campaigns: Campaign[];
  audit: {
    id: number;
    email: string;
    action: string;
    subject: string;
    created_at: string;
  }[];
  hosted: State["provider"];
  usage: { calls: number; tokens: string };
  billing: string;
};
const labels: Record<string, string> = {
  queued: "Bereit",
  running: "In Arbeit",
  waiting: "Wartet auf Team",
  input_required: "Rückfrage",
  paused: "Pausiert",
  completed: "Abgeschlossen",
  failed: "Fehlgeschlagen",
  canceled: "Abgebrochen",
  active: "Aktiv",
  suspended: "Gesperrt",
};
const viewLabels: Record<View, string> = {
  work: "Alle Aufträge",
  settings: "Einstellungen",
  hosts: "Eigene Rechner & Standorte",
  budgets: "Budgets & Ausweichmodelle",
  bridge: "Bridge & Geräte",
  projectSettings: "Projekteinstellungen",
  worklog: "Arbeitsverlauf",
  apps: "Verbundene Dienste",
  projects: "Projekte",
  timeline: "Plan & Timeline",
  organisation: "Agentenorganisation",
  routines: "Routinen",
  quality: "KI-Testlabor",
  team: "Team & Rollen",
  knowledge: "Projektsuche",
  briefings: "Briefings & Hinweise",
  decisions: "Entscheidungs-Postfach",
  memory: "Projektgedächtnis",
  chat: "Teamchat",
  files: "Dateien & Repositories",
  workspaces: "Workspaces",
  profile: "Dein Profil",
  invoices: "Rechnungen",
  overview: "Start",
  environments: "Laufzeitumgebungen",
  environmentOverview: "Alle Umgebungen",
  agents: "Dein Agententeam",
  tasks: "Aufträge",
  activity: "Verbrauch",
  skills: "Skills-Bibliothek",
  mcp: "MCP-Verbindungen",
  models: "KI & Modelle",
  billing: "Plan & Guthaben",
  privacy: "Datenschutz",
  admin: "Administration",
};
function Badge({ status }: { status: string }) {
  const { ui, localeTag, number, money, date } = useLanguage();

  return (
    <span className={`badge status-${status}`}>
      <span />
      {ui(labels[status] ?? status)}
    </span>
  );
}
function Avatar({
  agent,
  small = false,
}: {
  agent: Pick<Agent, "name" | "color">;
  small?: boolean;
}) {
  const { ui, localeTag, number, money, date } = useLanguage();

  return (
    <span className={`avatar ${agent.color} ${small ? "small" : ""}`}>
      <Bot size={small ? 17 : 23} />
    </span>
  );
}
function Empty({
  icon: Icon = FolderKanban,
  title,
  children,
  action,
}: {
  icon?: typeof Bot;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  const { ui, localeTag, number, money, date } = useLanguage();

  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={28} />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const { ui, localeTag, number, money, date } = useLanguage();

  const inputId = useId();
  const native =
    isValidElement<{ id?: string; "aria-describedby"?: string }>(children) &&
    typeof children.type === "string" &&
    ["input", "textarea", "select"].includes(children.type);
  return (
    <div className="field">
      {native ? <label htmlFor={inputId}>{label}</label> : <span>{label}</span>}
      {native
        ? cloneElement(children, {
            id: inputId,
            "aria-describedby": hint ? `${inputId}-hint` : undefined,
          })
        : children}
      {hint && <small id={`${inputId}-hint`}>{hint}</small>}
    </div>
  );
}
function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const { ui, localeTag, number, money, date } = useLanguage();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [close]);
  return (
    <div className="modal-backdrop" onClick={close}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2>{title}</h2>
          <button
            className="icon-button"
            onClick={close}
            aria-label={ui("Schließen")}
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
function Login({
  done,
  initialSignup = false,
}: {
  done: () => void;
  initialSignup?: boolean;
}) {
  const { ui, localeTag, number, money, date } = useLanguage();

  const router = useRouter();
  const { t, locale } = useLanguage();
  const [secondFactor, setSecondFactor] = useState(false);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.get("mfa") === "1") setSecondFactor(true);
    if (query.has("oauthError"))
      setError(
        query.get("oauthError") === "account"
          ? t(
              "Bitte mit dem vorhandenen Konto anmelden und den Dienst im Profil verknüpfen. Für neue Konten zuerst registrieren.",
              "Sign in to your existing account and connect the service in your profile. For new accounts, sign up first.",
            )
          : t(
              "Anmeldung beim Dienst abgebrochen oder fehlgeschlagen.",
              "Service sign-in was cancelled or failed.",
            ),
      );
  }, []);
  const [signup, setSignup] = useState(initialSignup),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    setSignup(initialSignup);
  }, [initialSignup]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      const result = await api(`auth/${signup ? "signup" : "login"}`, {
        email: f.get("email"),
        password: f.get("password"),
        name: f.get("name") || undefined,
        privacyAccepted: f.get("privacy") === "on",
        marketingConsent: f.get("marketing") === "on",
      });
      if (result.mfaRequired) {
        setSecondFactor(true);
        return;
      }
      done();
    } catch (err) {
      setError(
        locale === "en"
          ? (err as { status?: number }).status === 401
            ? "Invalid email or password."
            : "Unable to complete your request. Check your details and try again."
          : (err as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <a className="auth-home-link" href="/">
        {t("← Zur Startseite", "← Back to website")}
      </a>
      <div className="auth-brand">
        <div className="brand-symbol">
          <Command />
        </div>
        <b>
          KeRnCloud<span>WORKSPACE</span>
        </b>
      </div>
      <div className="auth-card">
        <span className="eyebrow">
          <span className="live-dot" />{" "}
          {t("DEINE LOKALE SAAS-UMGEBUNG", "YOUR LOCAL SAAS WORKSPACE")}
        </span>
        <LanguageSwitcher />
        <h1>
          {signup
            ? t("Dein Team beginnt hier.", "Your team starts here.")
            : t("Willkommen zurück.", "Welcome back.")}
        </h1>
        <p>
          {t(
            "Ein Ziel. Ein Team aus Agenten. Alles im Blick.",
            "One goal. A team of agents. Everything in view.",
          )}
        </p>
        {secondFactor ? (
          <MfaLogin
            done={done}
            cancel={() => {
              void api("auth/mfa/cancel", {}).finally(() => {
                setSecondFactor(false);
                router.replace("/login");
              });
            }}
          />
        ) : (
          <>
            <form onSubmit={submit}>
              {signup && (
                <Field label={t("Dein Name", "Your name")}>
                  <input
                    name="name"
                    autoComplete="name"
                    required
                    maxLength={80}
                  />
                </Field>
              )}
              <Field label={t("E-Mail-Adresse", "Email address")}>
                <input
                  name="email"
                  type="email"
                  autoComplete="username"
                  required
                  placeholder={t("du@unternehmen.de", "you@company.com")}
                />
              </Field>
              <Field
                label={t("Passwort", "Password")}
                hint={
                  signup
                    ? t("Mindestens 12 Zeichen.", "At least 12 characters.")
                    : undefined
                }
              >
                <input
                  name="password"
                  type="password"
                  minLength={12}
                  maxLength={128}
                  autoComplete={signup ? "new-password" : "current-password"}
                  required
                />
              </Field>
              {signup && (
                <>
                  <label className="check-row">
                    <input name="privacy" type="checkbox" required />
                    {t("Ich habe die", "I have read the")}{" "}
                    <a
                      href={`/privacy?lang=${locale}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t("lokalen Datenschutzhinweise", "local privacy notice")}
                    </a>{" "}
                    {t("gelesen.", ".")}
                  </label>
                  <label className="check-row">
                    <input name="marketing" type="checkbox" />
                    {t(
                      "Ich möchte Produktneuigkeiten erhalten (optional).",
                      "I would like to receive product updates (optional).",
                    )}
                  </label>
                </>
              )}
              {error && (
                <div className="error-box" role="alert">
                  {error}
                </div>
              )}
              <button className="primary full" disabled={busy}>
                {busy ? (
                  <Loader2 className="spin" size={17} />
                ) : (
                  <ArrowRight size={17} />
                )}{" "}
                {signup
                  ? t("Konto erstellen", "Create account")
                  : t("Anmelden", "Sign in")}
              </button>
            </form>
            {!signup && !secondFactor && (
              <a className="text-button" href="/forgot-password">
                {t("Passwort vergessen?", "Forgot your password?")}
              </a>
            )}
            <SocialLogin signup={signup} />
            <button
              data-registration-toggle
              className="text-button"
              onClick={() => {
                setSignup(!signup);
                router.push(signup ? "/login" : "/signup");
                setError("");
              }}
            >
              {signup
                ? t(
                    "Bereits ein Konto? Anmelden",
                    "Already have an account? Sign in",
                  )
                : t("Neuen Kundenaccount erstellen", "Create a new account")}
            </button>
          </>
        )}
      </div>
      <p className="auth-foot">
        <ShieldCheck size={15} />{" "}
        {t(
          "Lokal betrieben · Getrennte Workspaces · Verschlüsselte Zugangsdaten",
          "Locally hosted · Separate workspaces · Encrypted credentials",
        )}
      </p>
    </div>
  );
}
export function WorkspaceApp({
  authMode,
}: { authMode?: "login" | "signup" } = {}) {
  const { ui, localeTag, number, money, date, t } = useLanguage();

  const appearance = useWorkspaceAppearance();
  const router = useRouter();
  const route = resolveWorkspacePath(usePathname());
  const view = route?.view ?? "overview";
  const runId = route?.runId ?? null;
  const projectId = route?.projectId;
  const [state, setState] = useState<State | null>(null),
    [loading, setLoading] = useState(true),
    [loggedOut, setLoggedOut] = useState(false),
    [passwordRequired, setPasswordRequired] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [modal, setModal] = useState<ReactNode>(null),
    [search, setSearch] = useState("");
  useEffect(()=>{ if(state?.appearance) appearance.sync(state.appearance); },[state?.appearance?.theme,state?.appearance?.canSave,appearance.sync]);
  const [detailTab, setDetailTab] = useState<string | null>(null);
  useEffect(() => setDetailTab(null), [runId]);
  const refreshSequence = useRef(0);
  const selectedRoute = useRef<string | undefined>(undefined);
  const previousRunPage = useRef<{
    workspace: string;
    project: string;
    runs: Run[];
  } | null>(null);
  const [olderRuns, setOlderRuns] = useState<Run[]>([]),
    [runsCursor, setRunsCursor] = useState<string | null | undefined>(
      undefined,
    ),
    [loadingMore, setLoadingMore] = useState(false);
  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    try {
      const s = await api<State & { passwordChangeRequired?: boolean }>(
        "state?view=" +
          encodeURIComponent(view) +
          (runId ? "&runId=" + encodeURIComponent(runId) : "") +
          (projectId ? "&projectId=" + encodeURIComponent(projectId) : ""),
        undefined,
        "GET",
        { projectScope: false },
      );
      if (sequence !== refreshSequence.current) return;
      if (s.passwordChangeRequired) {
        setPasswordRequired(true);
        setState(null);
        setLoggedOut(false);
        return;
      }
      setPasswordRequired(false);
      selectWorkspace(s.workspace.id);
      setProjectScope(s.workspace.project_id);
      const routeKey = projectId ? s.workspace.id + ":" + projectId : undefined;
      if (routeKey && selectedRoute.current !== routeKey) {
        await selectProject(projectId!);
        if (sequence !== refreshSequence.current) return;
      }
      selectedRoute.current = routeKey;
      if (view === "tasks" && !runId) {
        const previous = previousRunPage.current;
        if (
          previous?.workspace === s.workspace.id &&
          previous.project === s.workspace.project_id
        ) {
          setOlderRuns((old) =>
            old.length ? mergePage(old, previous.runs) : old,
          );
        }
        if (previous && previous.project !== s.workspace.project_id) {
          setOlderRuns([]);
          setRunsCursor(undefined);
        }
        previousRunPage.current = {
          workspace: s.workspace.id,
          project: s.workspace.project_id!,
          runs: s.runs,
        };
      }
      setState(s);
      setLoggedOut(false);
    } catch (err) {
      if ((err as { status?: number }).status === 401) {
        selectWorkspace(undefined);
        selectedRoute.current = undefined;
        setState(null);
        setPasswordRequired(false);
        setLoggedOut(true);
      } else setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [view, runId, projectId]);
  useEffect(() => {
    setOlderRuns([]);
    setRunsCursor(undefined);
    void refresh();
    const fallback = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 60000);
    const focus = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", focus);
    return () => {
      clearInterval(fallback);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [refresh]);
  useEffect(() => {
    const id = state?.workspace.id;
    if (!id) return;
    let pending: ReturnType<typeof setTimeout> | undefined;
    const stream = new EventSource(
      "/api/synchronization?workspaceId=" + encodeURIComponent(id),
    );
    stream.onmessage = (e) => {
      try {
        if (JSON.parse(e.data).invalidate && !pending)
          pending = setTimeout(() => {
            pending = undefined;
            if (document.visibilityState === "visible") void refresh();
          }, 500);
      } catch {}
    };
    return () => {
      stream.close();
      if (pending) clearTimeout(pending);
    };
  }, [state?.workspace.id, refresh]);
  useEffect(() => {
    setOlderRuns([]);
    setRunsCursor(undefined);
  }, [state?.workspace.id]);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(id);
  }, [notice]);
  useEffect(() => {
    document.dispatchEvent(new CustomEvent("kc:view", { detail: view }));
  }, [view]);
  useEffect(() => {
    if (authMode && state && !loggedOut)
      router.replace(workspacePaths.overview);
  }, [authMode, state, loggedOut, router]);
  const perform = async (
    path: string,
    body: unknown,
    method = "POST",
    message = ui("Gespeichert."),
  ) => {
    setBusy(true);
    setError("");
    try {
      const r = await api(path, body, method);
      await refresh();
      setNotice(message);
      return r;
    } catch (err) {
      setError((err as Error).message);
      throw err;
    } finally {
      setBusy(false);
    }
  };
  if (loading)
    return (
      <div className="loading">
        <Loader2 className="spin" />
        {ui(" KeRnCloud wird gestartet …")}
      </div>
    );
  if (passwordRequired)
    return <RequiredPasswordChange done={() => void refresh()} />;
  if (loggedOut)
    return (
      <Login
        initialSignup={authMode === "signup"}
        done={() => void refresh()}
      />
    );
  if (!state)
    return (
      <div className="loading">
        <div>
          <h2>{ui("Verbindung zur Plattform fehlt")}</h2>
          <p>{error}</p>
          <button className="primary" onClick={() => void refresh()}>
            {ui("Erneut versuchen")}
          </button>
        </div>
      </div>
    );
  const s = state,
    active = s.runs.filter((r) => r.status === "running"),
    completed = s.runs.filter((r) => r.status === "completed"),
    workers = s.workers.filter(
      (w) => Date.now() - new Date(w.last_seen).getTime() < 30000,
    ),
    selected = s.runs.find((r) => r.id === runId),
    runTasks = s.tasks.filter((t) => t.run_id === runId);
  const taskSection =
    detailTab ??
    (selected && ["completed", "failed", "canceled"].includes(selected.status)
      ? "results"
      : "work");
  const modelsNeedingAttention = s.models.filter(
    (model) =>
      model.active &&
      ["unavailable", "unlisted"].includes(model.check_status ?? ""),
  );
  const showModelNotice =
    view !== "models" && modelsNeedingAttention.length > 0;
  const showModelSetupNotice =
    view !== "models" && !s.models.some((model) => model.active);
  const showDecisionNotice =
    view !== "decisions" && view !== "overview" && (s.decision_count ?? 0) > 0;
  const nav = (next: View) => {
    router.push(workspacePaths[next]);
    setSearch("");
  };
  const logout = async () => {
    setBusy(true);
    try {
      await api("auth/logout", {});
      appearance.sync({theme:"light",canSave:false});
      selectWorkspace(undefined);
      selectedRoute.current = undefined;
      setState(null);
      setLoggedOut(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const switchWorkspace = async (id: string) => {
    await api("workspaces/select", { id });
    selectWorkspace(id);
    setError("");
    if (runId || projectId) {
      router.replace(runId ? workspacePaths.tasks : "/projects");
      return;
    }
    await refresh();
  };
  const close = () => setModal(null);
  const formModal = (
    title: string,
    fields: ReactNode,
    submit: (f: FormData) => Promise<unknown>,
    button = ui("Speichern"),
  ) =>
    setModal(
      <Modal title={title} close={close}>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            try {
              await submit(f);
              close();
            } catch {
              /* persistent error outside dialog */
            }
          }}
        >
          {fields}
          <footer>
            <button type="button" className="secondary" onClick={close}>
              {ui("Abbrechen")}
            </button>
            <button className="primary">
              {button}
              <ArrowRight size={15} />
            </button>
          </footer>
        </form>
      </Modal>,
    );
  const newRun = () =>
    setModal(
      <Modal title={t("Neuer Auftrag", "New task")} close={close}>
        <NewTaskForm
          state={s}
          cancel={close}
          created={(id) => {
            close();
            void refresh();
            router.push("/tasks/" + encodeURIComponent(id));
          }}
        />
      </Modal>,
    );
  const editAgent = (a?: Agent) =>
    formModal(
      a ? ui("{0} konfigurieren", [a.name]) : ui("Agent hinzufügen"),
      <>
        <div className="form-grid">
          <Field label="Name">
            <input
              name="name"
              required
              defaultValue={a?.name}
              maxLength={200}
            />
          </Field>
          <Field label={ui("Rolle")}>
            <input
              name="role"
              required
              defaultValue={a?.role}
              placeholder={ui("z. B. Marketing")}
              maxLength={200}
            />
          </Field>
        </div>
        <Field label={ui("Arbeitsanweisungen")}>
          <textarea
            name="instructions"
            required
            rows={5}
            maxLength={12000}
            defaultValue={a?.instructions}
          />
        </Field>
        <Field label={ui("KI-Modell für diesen Agenten")}>
          <select name="model" defaultValue={a?.model_id ?? ""}>
            <option value="">{ui("Workspace-Standard übernehmen")}</option>
            {s.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} · {m.provider_name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Skills">
          <div className="choices">
            {s.skills.length ? (
              s.skills
                .filter((skill) => skill.status === "approved")
                .map((skill) => (
                  <label key={skill.id} className="check-row">
                    <input
                      type="checkbox"
                      name="skills"
                      value={skill.id}
                      defaultChecked={a?.skill_ids.includes(skill.id)}
                    />
                    {skill.name}
                  </label>
                ))
            ) : (
              <span className="muted">{ui("Noch keine Skills angelegt.")}</span>
            )}
          </div>
        </Field>
        <Field label={ui("MCP-Verbindungen")}>
          <div className="choices">
            {s.connections.length ? (
              s.connections.map((c) => (
                <label className="check-row" key={c.id}>
                  <input
                    type="checkbox"
                    name="mcps"
                    value={c.id}
                    defaultChecked={a?.mcp_ids.includes(c.id)}
                  />
                  {c.name}
                </label>
              ))
            ) : (
              <span className="muted">
                {ui("Noch keine Verbindungen angelegt.")}
              </span>
            )}
          </div>
        </Field>
      </>,
      (f) =>
        perform("agents", {
          id: a?.id,
          name: f.get("name"),
          role: f.get("role"),
          instructions: f.get("instructions"),
          skill_ids: f.getAll("skills"),
          mcp_ids: f.getAll("mcps"),
          model_id: f.get("model") || null,
          color: a?.color ?? "green",
        }),
    );
  const editSkill = (skill?: Skill) =>
    formModal(
      skill ? ui("Skill bearbeiten") : ui("Skill erstellen"),
      <>
        <div className="form-note">
          <BookOpen size={18} />
          {ui(
            " Unterstützt textbasierte SKILL.md-Anweisungen. Skripte werden in dieser Version nicht ausgeführt.",
          )}
        </div>
        <Field label="Name">
          <input
            name="name"
            defaultValue={skill?.name}
            required
            maxLength={200}
          />
        </Field>
        <Field label={ui("Wann soll der Skill verwendet werden?")}>
          <input
            name="description"
            defaultValue={skill?.description}
            required
            maxLength={1024}
          />
        </Field>
        <Field label={ui("SKILL.md importieren (optional)")}>
          <input
            type="file"
            accept=".md,.txt"
            onChange={(e) => {
              const file = e.target.files?.[0];
              const form = e.target.closest("form");
              if (file && form && file.size <= 50000)
                void file.text().then((text) => {
                  const area = form.elements.namedItem(
                    "content",
                  ) as HTMLTextAreaElement;
                  area.value = text;
                });
            }}
          />
        </Field>
        <Field label={ui("Anweisungen")}>
          <textarea
            name="content"
            className="mono"
            defaultValue={
              skill?.content ??
              ui(
                "---\nname: mein-skill\ndescription: Beschreibe den Einsatzzweck.\n---\n\n# Vorgehen\n\n1. Prüfe die verfügbaren Informationen.\n2. Bearbeite die Aufgabe.\n3. Belege und speichere das Ergebnis.",
              )
            }
            rows={12}
            required
            maxLength={50000}
          />
        </Field>
      </>,
      (f) =>
        perform("skills", {
          id: skill?.id,
          version: skill?.version,
          name: f.get("name"),
          description: f.get("description"),
          content: f.get("content"),
        }),
    );
  const editConnection = (c?: Omit<Connection, "secret">) =>
    formModal(
      c ? ui("MCP-Verbindung bearbeiten") : ui("MCP-Server verbinden"),
      <>
        <Field label="Name">
          <input name="name" defaultValue={c?.name} required maxLength={200} />
        </Field>
        <Field label={ui("Streamable-HTTP-Endpoint")}>
          <input
            name="url"
            type="url"
            placeholder="https://mein-dienst.de/mcp"
            defaultValue={c?.url}
            required
          />
        </Field>
        <Field
          label={ui("Bearer-Token (optional)")}
          hint={ui("Leer lassen, um einen gespeicherten Token beizubehalten.")}
        >
          <input name="key" type="password" autoComplete="new-password" />
        </Field>
        <Field
          label={ui("Freigegebene Werkzeugnamen")}
          hint={ui(
            "Ein exakter Werkzeugname pro Zeile. Die Erkennung zeigt die verfügbaren Namen.",
          )}
        >
          <textarea
            name="tools"
            rows={4}
            defaultValue={c?.allowed_tools.join("\n")}
          />
        </Field>
        <label className="check-row">
          <input type="checkbox" name="enabled" defaultChecked={c?.enabled} />
          {ui("Verbindung für zugewiesene Agenten aktivieren")}
        </label>
        <div className="form-note">
          {ui(
            "Nur explizit freigegebene Werkzeuge sind ausführbar. OAuth und lokal gestartete MCP-Prozesse folgen in einer späteren Version.",
          )}
        </div>
      </>,
      (f) =>
        perform("connections", {
          id: c?.id,
          name: f.get("name"),
          url: f.get("url"),
          key: f.get("key") || undefined,
          allowed_tools: String(f.get("tools"))
            .split("\n")
            .map((t) => t.trim())
            .filter(Boolean),
          enabled: f.get("enabled") === "on",
        }),
    );
  const activity = (events: Event[]) =>
    events.length ? (
      <div className="timeline">
        {events.map((e) => {
          const a = s.agents.find((a) => a.id === e.agent_id);
          return (
            <div className="timeline-item" key={e.id}>
              <div className={`timeline-dot ${a?.color ?? "cyan"}`}>
                {e.kind === "completed" ? (
                  <Check size={13} />
                ) : e.kind === "delegated" ? (
                  <ArrowUpRight size={13} />
                ) : (
                  <Activity size={13} />
                )}
              </div>
              <div>
                <div className="timeline-line">
                  <b>
                    {a ? <a href={`/agents/${a.id}`}>{a.name}</a> : "Workspace"}
                  </b>
                  <span>{date(e.created_at)}</span>
                </div>
                <p>{e.content}</p>
                <small>{e.kind}</small>
              </div>
            </div>
          );
        })}
      </div>
    ) : (
      <Empty icon={Activity} title={ui("Hier entsteht dein Arbeitsverlauf")}>
        {ui(
          "Sobald dein Team einen Auftrag bearbeitet, siehst du hier Nachrichten, Werkzeugaufrufe und Ergebnisse.",
        )}
      </Empty>
    );
  const runList = (runs: Run[]) =>
    runs.length ? (
      <div className="run-list">
        {runs.map((r) => (
          <button
            className="run-row"
            key={r.id}
            onClick={() =>
              router.push(`${workspacePaths.tasks}/${encodeURIComponent(r.id)}`)
            }
          >
            <span className="run-icon">
              <FolderKanban size={19} />
            </span>
            <span className="run-row-main">
              <strong>{runTitle(r.goal)}</strong>
              <small>
                {date(r.created_at)} · {r.steps_used}/{r.max_steps}
                {ui(" Schritte ·")} {number(r.tokens_used)} Tokens
              </small>
            </span>
            <Badge status={r.status} />
            <ChevronRight size={17} />
          </button>
        ))}
      </div>
    ) : (
      <Empty title={ui("Bereit für den ersten Auftrag")}>
        {ui(
          "Verbinde ein Modell und gib deinem Team ein Ziel. Planung, Aufgaben und Ergebnisse erscheinen hier.",
        )}
      </Empty>
    );
  const agentCards = () =>
    s.agents.map((a) => {
      const tasks = s.tasks.filter(
        (t) => t.agent_id === a.id && t.status === "running",
      );
      return (
        <article className="agent-card" key={a.id}>
          <div className="agent-card-top">
            <Avatar agent={a} />
            <button
              className="icon-button"
              aria-label={ui("{0} konfigurieren", [a.name])}
              onClick={() => editAgent(a)}
            >
              <MoreHorizontal size={20} />
            </button>
          </div>
          <h3>
            <a href={`/agents/${a.id}`}>{a.name}</a>
          </h3>
          <p className="agent-role">{a.role}</p>
          <p className="agent-description">{a.instructions}</p>
          <div className="agent-tools">
            <span>
              <BookOpen size={12} />
              {a.skill_ids.length} Skills
            </span>
            <span>
              <Plug size={12} />
              {a.mcp_ids.length} MCP
            </span>
          </div>
          <div className="agent-card-bottom">
            <span className={tasks.length ? "working" : "muted"}>
              <span className={`status-dot ${tasks.length ? "cyan" : ""}`} />
              {a.execution_paused || s.workspace.execution_paused
                ? ui("Gestoppt")
                : tasks.length
                  ? ui("Arbeitet")
                  : ui("Bereit")}
            </span>
            <button
              className="text-button"
              aria-pressed={a.execution_paused ?? false}
              aria-label={`${a.name} ${a.execution_paused ? ui("fortsetzen") : ui("stoppen")}`}
              onClick={() =>
                void perform("execution/control", {
                  agentId: a.id,
                  action: a.execution_paused ? "resume" : "stop",
                }).catch(() => undefined)
              }
            >
              {a.execution_paused ? ui("Fortsetzen") : ui("Stoppen")}
            </button>
            <a
              className="text-button"
              href={`/agents/${a.id}`}
              aria-label={t("Einblick in ", "Inspect ") + a.name}
            >
              {t("Einblick", "Inspect")}
              <ArrowUpRight size={13} />
            </a>
          </div>
        </article>
      );
    });
  return (
    <div
      className={
        "app-shell workspace-rebuild" +
        (view === "admin" ? " operator-mode" : "")
      }
    >
      <aside className="sidebar">
        <a
          className="brand"
          href="/overview"
          aria-label={ui("KeRnCloud Workspace-Übersicht")}
        >
          <div className="brand-symbol">
            <KernCloudLogo size={34} />
          </div>
          <div>
            KeRnCloud<span>AGENT WORKSPACE</span>
          </div>
        </a>
        <button
          className="workspace-picker"
          aria-label={ui("Workspace wechseln oder erstellen")}
          onClick={() => nav("workspaces")}
        >
          <span className="workspace-letter">{s.workspace.name[0]}</span>
          <div>
            <strong>{s.workspace.name}</strong>
            <small>
              {s.plan.name}
              {ui(" · Lokal")}
            </small>
          </div>
          <ChevronDown size={15} />
        </button>
        <div className="sidebar-navigation">
          {view === "admin" ? (
            <AdminNavigation sidebar />
          ) : (
            <>
              <WorkspaceNavigation
                view={view}
                nav={nav}
                decisions={s.decision_count ?? 0}
              />
              {s.user.role === "admin" && (
                <nav aria-label={t("Betreiberzugang", "Operator access")}>
                  <button
                    className="nav-item operator-entry"
                    onClick={() => nav("admin")}
                  >
                    <Settings2 size={18} />
                    {t("Betreiberkonsole", "Operator console")}
                    <span className="admin-tag">ADMIN</span>
                  </button>
                </nav>
              )}
              <CustomWorkspaceLinks />
            </>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="local-status">
            <span className="live-dot" />
            <div>
              <b>{t("Systemstatus", "System status")}</b>
              <small>
                {workers.length}
                {ui(" Worker verbunden")}
              </small>
            </div>
            <Server size={17} />
          </div>
          <button
            className="profile"
            aria-label={ui("Profil öffnen")}
            onClick={() => nav("profile")}
          >
            <span className="profile-avatar">{s.user.name[0]}</span>
            <div>
              <strong>{s.user.name}</strong>
              <small>{s.user.email}</small>
            </div>
            <ChevronRight size={16} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            {view === "admin"
              ? t("Betreiberkonsole", "Operator console")
              : s.workspace.name}
            <ChevronRight size={14} />
            {((projectViews.includes(view) &&
              (view !== "projects" || projectId)) ||
              runId) && (
              <>
                <a href={projectPath(s.workspace.project_id!)}>
                  {(s as any).project?.name ??
                    (s as any).projects?.find(
                      (p: any) => p.id === s.workspace.project_id,
                    )?.name}
                </a>
                <ChevronRight size={14} />
              </>
            )}
            <strong>
              {view === "decisions"
                ? t("Entscheidungs-Postfach", "Decision inbox")
                : view === "environmentOverview"
                  ? t("Alle Umgebungen", "All environments")
                  : ((
                      {
                        overview: t("Start", "Home"),
                        work: t("Alle Aufträge", "All tasks"),
                        settings: t("Einstellungen", "Settings"),
                        budgets: t(
                          "Budgets & Ausweichmodelle",
                          "Budgets & fallback models",
                        ),
                        hosts: t(
                          "Eigene Rechner & Standorte",
                          "Your hosts & locations",
                        ),
                        worklog: t("Arbeitsverlauf", "Work history"),
                        quality: t("KI-Testlabor", "AI test lab"),
                        projectSettings: t(
                          "Projekteinstellungen",
                          "Project settings",
                        ),
                        activity: t("Verbrauch", "Usage"),
                      } as Partial<Record<View, string>>
                    )[view] ?? ui(viewLabels[view]))}
            </strong>
          </div>
          <div className="top-actions">
            <LanguageSwitcher compact />
            <button
              className="secondary compact workspace-control"
              onClick={() =>
                void perform("execution/control", {
                  action: s.workspace.execution_paused ? "resume" : "stop",
                }).catch(() => undefined)
              }
            >
              {s.workspace.execution_paused
                ? ui("Workspace fortsetzen")
                : t("Workspace pausieren", "Pause workspace")}
            </button>
            <span className="environment">
              <span className="live-dot" />
              LOCAL
            </span>
            <button
              className="icon-button"
              aria-label={ui("Aktualisieren")}
              onClick={() => void refresh()}
            >
              <RefreshCw size={16} />
            </button>
            <AccountMenu
              name={s.user.name}
              email={s.user.email}
              navigate={nav}
              logout={() => void logout()}
            />
          </div>
        </header>
        <main>
          {![
            "overview",
            "projects",
            "work",
            "decisions",
            "activity",
            "settings",
            "admin",
          ].includes(view) &&
            !projectViews.includes(view) && (
              <p className="workspace-scope-hint">
                {["profile", "billing", "invoices", "privacy"].includes(view)
                  ? t(
                      "KONTO · unabhängig vom ausgewählten Projekt",
                      "ACCOUNT · independent of the selected project",
                    )
                  : t(
                      "WORKSPACE · gilt für alle Projekte",
                      "WORKSPACE · applies to all projects",
                    )}
              </p>
            )}
          {error && (
            <div className="error-box global-error" role="alert">
              {error}
              <button
                className="icon-button"
                onClick={() => setError("")}
                aria-label={ui("Fehlermeldung schließen")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {view !== "admin" &&
            (s.workspace.execution_paused ||
              showModelNotice ||
              showModelSetupNotice ||
              showDecisionNotice) && (
              <div className="workspace-notices">
                {s.workspace.execution_paused && (
                  <div className="execution-banner" role="status">
                    {ui(
                      "Alle Agenten in diesem Workspace sind gestoppt. Neue Aufträge und weitere Verarbeitungsschritte sind gesperrt, bis du den Workspace fortsetzt.",
                    )}
                  </div>
                )}
                {showModelSetupNotice && (
                  <div className="form-note" role="status">
                    <span>
                      {ui(
                        "Kein aktives KI-Modell verfügbar. Aktiviere oder verbinde ein Modell unter „KI & Modelle“.",
                      )}{" "}
                      <a href="/models">{ui("KI & Modelle öffnen")}</a>
                      {view === "chat" && (
                        <>
                          {" "}
                          {ui(
                            "Du kannst weiterhin Informationen ohne KI-Antwort hinterlegen.",
                          )}
                        </>
                      )}
                    </span>
                  </div>
                )}
                {showModelNotice && (
                  <div
                    className="error-box workspace-model-notice"
                    role="alert"
                  >
                    <span>
                      {ui("KI & Modelle")}:{" "}
                      {modelsNeedingAttention
                        .map((model) => model.name)
                        .join(", ")}
                    </span>
                    <a href="/models">
                      {t("Verbindung prüfen", "Check connection")}
                    </a>
                  </div>
                )}
                {showDecisionNotice && (
                  <div className="form-note" role="status">
                    <button
                      className="secondary"
                      onClick={() => nav("decisions")}
                    >
                      {s.decision_count}{" "}
                      {t(
                        "Entscheidung(en) warten auf dich",
                        "decision(s) need your input",
                      )}{" "}
                      →
                    </button>
                  </div>
                )}
              </div>
            )}
          {view !== "admin" &&
            s.workspace.membership_role &&
            s.workspace.membership_role !== "owner" && (
              <div
                className="form-note"
                style={{ marginBottom: 28 }}
                role="status"
              >
                {t(
                  "Geteilter Workspace · Deine Rolle: ",
                  "Shared workspace · Your role: ",
                )}
                {s.workspace.membership_role}
                {t(
                  ". Abrechnung und Kontoverwaltung sind dem Eigentümer vorbehalten.",
                  ". Billing and account administration are reserved for the owner.",
                )}
              </div>
            )}
          {projectViews.includes(view) &&
            !runId &&
            !(view === "projects" && !projectId) && (
              <ProjectContext state={s} />
            )}
          {view === "settings" && <SettingsHub state={s} />}
          {view === "bridge" && <BridgePanel />}
          {view === "hosts" && (
            <>
              <header className="workspace-page-heading">
                <div>
                  <h1>
                    {t("Eigene Rechner & Standorte", "Your hosts & locations")}
                  </h1>
                  <p>
                    {t(
                      "Ausführungsorte für diesen Workspace und seine Projekte.",
                      "Execution locations for this workspace and its projects.",
                    )}
                  </p>
                </div>
                <a className="button secondary" href="/settings">
                  ← {t("Einstellungen", "Settings")}
                </a>
              </header>
              {s.workspace.owner_id === s.user.id ? (
                <CustomerHosts onChange={refresh} />
              ) : (
                <p className="form-note">
                  {t(
                    "Ausführungsorte verwaltet der Kontoinhaber.",
                    "The account owner manages execution locations.",
                  )}
                </p>
              )}
            </>
          )}
          {view === "budgets" && (
            <>
              <header className="workspace-page-heading">
                <div>
                  <h1>
                    {t(
                      "Budgets & Ausweichmodelle",
                      "Budgets & fallback models",
                    )}
                  </h1>
                  <p>
                    {t(
                      "Workspace-Standards für neue Aufträge. Bestehende Aufträge behalten ihre Limits.",
                      "Workspace defaults for new tasks. Existing tasks keep their limits.",
                    )}
                  </p>
                </div>
                <a className="button secondary" href="/settings">
                  ← {t("Einstellungen", "Settings")}
                </a>
              </header>
              <RunPolicySettings
                key={s.workspace.id}
                state={s}
                changed={() => void refresh()}
              />
            </>
          )}
          {view === "work" && <WorkspaceWork state={s} newTask={newRun} />}
          {view === "worklog" && (
            <>
              <header className="workspace-page-heading">
                <div>
                  <span className="scope-label">WORKSPACE</span>
                  <h1>{t("Arbeitsverlauf", "Work history")}</h1>
                  <p>
                    {t(
                      "Letzte Ereignisse im gesamten Workspace. Details findest du im jeweiligen Auftrag.",
                      "Recent events across the workspace. Open a task for details.",
                    )}
                  </p>
                </div>
              </header>
              <section className="panel workspace-history">
                {activity(s.events)}
              </section>
            </>
          )}
          {view === "chat" && (
            <TeamChat
              key={s.workspace.id + ":" + s.workspace.project_id}
              state={s}
              save={perform}
            />
          )}
          {view === "timeline" && (
            <WorkTimeline
              key={s.workspace.id + ":" + s.workspace.project_id}
              state={s}
            />
          )}
          {view === "organisation" && (
            <OrganisationChart
              key={s.workspace.id + ":" + s.workspace.project_id}
              state={s}
            />
          )}
          {view === "routines" && (
            <AutomationsPanel
              key={s.workspace.id + ":" + s.workspace.project_id}
              state={s}
            />
          )}
          {view === "apps" && (
            <WorkAppsPanel
              key={s.workspace.id}
              workspaceId={s.workspace.id}
              isAdmin={s.user.role === "admin"}
            />
          )}
          {(view === "projects" || view === "projectSettings") && (
            <section className="project-page-stack">
              <WorkspaceProjects
                key={
                  s.workspace.id +
                  (projectId ? ":" + projectId : ":manage") +
                  ":" +
                  view
                }
                state={s}
                newTask={newRun}
              />
              {view === "projectSettings" && (
                <details className="panel settings-panel">
                  <summary>
                    {t(
                      "Git-Repository & Entwicklungsumgebung",
                      "Git repository & development environment",
                    )}
                  </summary>
                  <ProjectsPanel
                    key={s.workspace.id}
                    workspaceId={s.workspace.id}
                    role={s.workspace.membership_role ?? "owner"}
                  />
                </details>
              )}
            </section>
          )}
          {view === "quality" && (
            <>
              {" "}
              <details className="panel settings-panel">
                <summary>
                  {t(
                    "Beobachtete Kontext- und Kostenwerte",
                    "Observed context and cost metrics",
                  )}
                </summary>
                <RuntimeInsights />
              </details>
              <QualityPanel
                key={s.workspace.id}
                workspaceId={s.workspace.id}
                role={s.workspace.membership_role ?? "owner"}
                agents={s.agents}
                models={s.models}
              />
            </>
          )}
          {view === "team" && (
            <TeamPanel key={s.workspace.id} workspaceId={s.workspace.id} />
          )}
          {view === "knowledge" && <KnowledgePanel key={s.workspace.id} />}
          {view === "briefings" && (
            <BriefingPanel
              key={s.workspace.id}
              workspaceId={s.workspace.id}
              role={s.workspace.membership_role ?? "owner"}
            />
          )}
          {view === "memory" && (
            <MemoryPanel key={s.workspace.id} state={s} save={perform} />
          )}
          {view === "files" && (
            <>
              <ProjectResults
                key={s.workspace.id + ":" + s.workspace.project_id}
                state={s}
              />
              <details className="panel settings-panel">
                <summary>
                  {t(
                    "Uploads & Repository-Materialien",
                    "Uploads & repository materials",
                  )}
                </summary>
                <MaterialsPanel
                  key={s.workspace.id}
                  files={s.attachments}
                  save={perform}
                />
              </details>
            </>
          )}
          {view === "decisions" && (
            <DecisionInbox
              key={s.workspace.id}
              workspaceId={s.workspace.id}
              save={perform}
            />
          )}
          {view === "profile" && <AccountPanel state={s} save={perform} />}
          {view === "invoices" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">{ui("DEIN KONTO")}</div>
                  <h1>{ui("Deine Rechnungen")}</h1>
                  <p>
                    {ui("Rechnungen und Downloads für dein gesamtes Konto.")}
                  </p>
                </div>
              </div>
              <>
                <AccountBenefits />
                <InvoicesPanel />
              </>
            </>
          )}
          {view === "workspaces" && (
            <WorkspacesPanel
              state={s}
              save={perform}
              switchTo={switchWorkspace}
            />
          )}
          {view === "overview" && <WorkspaceHome state={s} newTask={newRun} />}
          {view === "agents" && route?.agentId && (
            <AgentInspector
              key={s.workspace.id + ":" + route.agentId}
              agentId={route.agentId}
              workspaceId={s.workspace.id}
            />
          )}
          {view === "agents" && !route?.agentId && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">{ui("ZUSAMMENARBEIT")}</div>
                  <h1>{ui("Dein Agententeam")}</h1>
                  <p>
                    {ui(
                      "Definiere Rollen, Arbeitsweisen und verfügbare Werkzeuge.",
                    )}
                  </p>
                </div>
                <button className="primary" onClick={() => editAgent()}>
                  <Plus size={17} />
                  {ui("Agent hinzufügen")}
                </button>
              </div>
              <div className="agent-grid">{agentCards()}</div>
              <div className="form-note">
                {ui(
                  "Agenten können sich innerhalb eines Auftrags gegenseitig Teilaufgaben geben, Nachrichten austauschen und Ergebnisse prüfen. Skills und MCP-Zugriffe werden pro Agent freigegeben.",
                )}
              </div>
            </>
          )}
          {view === "tasks" && (
            <>
              <div
                className={selected ? "task-detail-toolbar" : "page-heading"}
              >
                <div>
                  {!selected && (
                    <div className="eyebrow">
                      {t("PROJEKTAUFTRÄGE", "PROJECT TASKS")}
                    </div>
                  )}
                  <h1>
                    {selected ? runTitle(selected.goal) : ui("Deine Aufträge")}
                  </h1>
                  <p>
                    {selected
                      ? ui(
                          "Aufgaben, Kommunikation und Ergebnisse an einem Ort.",
                        )
                      : ui(
                          "Verfolge die Arbeit deines Teams und steuere bei Bedarf nach.",
                        )}
                  </p>
                </div>
                <button className="primary" onClick={newRun}>
                  <Plus size={17} />
                  {ui("Neuer Auftrag")}
                </button>
              </div>
              {selected ? (
                <>
                  <button
                    className="text-button back"
                    onClick={() =>
                      router.push(projectPath(s.workspace.project_id!, "tasks"))
                    }
                  >
                    {ui("← Alle Aufträge")}
                  </button>
                  <section className="panel run-detail">
                    <div className="run-detail-heading">
                      <div>
                        <Badge status={selected.status} />

                        <details className="task-instructions">
                          <summary>
                            {t("Auftragsbeschreibung", "Task description")}
                          </summary>
                          <pre>{selected.goal}</pre>
                        </details>
                        <p>
                          {selected.steps_used}/{selected.max_steps}{" "}
                          {ui("Modellaufrufe · ")}
                          {number(selected.tokens_used)} Tokens ·{" "}
                          {date(selected.created_at)}
                        </p>
                      </div>
                      {!["completed", "failed", "canceled"].includes(
                        selected.status,
                      ) && (
                        <div className="button-row">
                          <button
                            className="secondary"
                            onClick={() =>
                              void perform(
                                `runs/${selected.id}`,
                                {
                                  action:
                                    selected.status === "paused"
                                      ? "resume"
                                      : "pause",
                                },
                                "PATCH",
                              ).catch(() => undefined)
                            }
                          >
                            {selected.status === "paused" ? (
                              <Play size={15} />
                            ) : (
                              <Pause size={15} />
                            )}{" "}
                            {selected.status === "paused"
                              ? ui("Fortsetzen")
                              : "Pause"}
                          </button>
                          <button
                            className="danger"
                            onClick={() =>
                              void perform(
                                `runs/${selected.id}`,
                                { action: "cancel" },
                                "PATCH",
                              ).catch(() => undefined)
                            }
                          >
                            <Square size={14} />
                            {ui("Stoppen")}
                          </button>
                        </div>
                      )}
                    </div>
                    <p className="form-note">
                      {t("Festes Auftragslimit:", "Fixed task budget:")}{" "}
                      {selected.credit_used ?? 0} /{" "}
                      {selected.credit_limit ?? 10000} Credits ·{" "}
                      {selected.token_limit ?? 100000} Tokens
                    </p>
                    <div className="progress-track">
                      <span
                        style={{
                          width: `${runTasks.length ? (runTasks.filter((t) => t.status === "completed").length / runTasks.length) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <small className="muted">
                      {runTasks.filter((t) => t.status === "completed").length}{" "}
                      {ui("von ")}
                      {runTasks.length}
                      {ui(
                        " aktuellen Teilaufgaben abgeschlossen. Der Umfang kann sich während der Arbeit ändern.",
                      )}
                    </small>
                  </section>
                  <TaskWorkflow
                    run={selected}
                    tasks={runTasks}
                    events={s.events}
                    agents={s.agents}
                    files={
                      s.artifacts.filter((a) => a.run_id === selected.id).length
                    }
                  />
                  <nav
                    className="task-section-tabs"
                    aria-label={t("Auftragsbereiche", "Task sections")}
                  >
                    {[
                      ["work", t("Fortschritt", "Progress")],
                      ["results", t("Ergebnis", "Result")],
                      ["history", t("Kommunikation", "Communication")],
                      [
                        "advanced",
                        t("Technische Details", "Technical details"),
                      ],
                    ].map(([key, label]) => (
                      <button
                        key={key}
                        aria-current={taskSection === key ? "page" : undefined}
                        className={taskSection === key ? "active" : ""}
                        onClick={() => setDetailTab(key)}
                      >
                        {label}
                      </button>
                    ))}
                  </nav>
                  {taskSection === "advanced" && (
                    <>
                      <RunProcesses
                        runId={selected.id}
                        active={selected.status === "running"}
                      />
                      <CheckpointPanel
                        key={"checkpoints-" + selected.id}
                        runId={selected.id}
                        workspaceId={s.workspace.id}
                      />
                    </>
                  )}
                  {taskSection === "results" && (
                    <RunResults
                      key={selected.id}
                      run={selected}
                      tasks={runTasks}
                      files={s.artifacts.filter(
                        (a) => a.run_id === selected.id,
                      )}
                      workspaceId={s.workspace.id}
                      retry={async () => {
                        const next = await perform(
                          `runs/${selected.id}/retry`,
                          {},
                        );
                        router.push(`/tasks/${next.id}`);
                      }}
                    />
                  )}
                  {taskSection === "work" && (
                    <div className="task-board">
                      {(
                        [
                          "queued",
                          "running",
                          "waiting",
                          "input_required",
                          "completed",
                          "failed",
                        ] as const
                      ).map((status) => {
                        const tasks = runTasks.filter(
                          (t) => t.status === status,
                        );
                        return tasks.length ? (
                          <section className="task-column" key={status}>
                            <h3>
                              {ui(labels[status])}
                              <span>{tasks.length}</span>
                            </h3>
                            {tasks.map((t) => (
                              <article className="task-card" key={t.id}>
                                <a
                                  className="eyebrow"
                                  href={`/agents/${t.agent_id}?task=${t.id}`}
                                >
                                  {
                                    s.agents.find((a) => a.id === t.agent_id)
                                      ?.name
                                  }
                                </a>
                                <h4>{t.title}</h4>
                                {t.parent_id && (
                                  <small>{ui("Delegierte Teilaufgabe")}</small>
                                )}
                                {t.error && (
                                  <p className="warning-text">{t.error}</p>
                                )}
                                {t.result && (
                                  <details>
                                    <summary>{ui("Ergebnis ansehen")}</summary>
                                    <pre>{t.result}</pre>
                                  </details>
                                )}
                              </article>
                            ))}
                          </section>
                        ) : null;
                      })}
                    </div>
                  )}
                  {taskSection === "history" && (
                    <div className="run-history">
                      <section className="panel">
                        <div className="panel-heading">
                          <h2>{ui("Kommunikation & Verlauf")}</h2>
                          <MessageSquare size={17} />
                        </div>
                        {activity(
                          s.events.filter((e) => e.run_id === selected.id),
                        )}
                        {!["completed", "failed", "canceled"].includes(
                          selected.status,
                        ) && (
                          <form
                            className="message-form"
                            onSubmit={async (e) => {
                              e.preventDefault();
                              const f = new FormData(e.currentTarget);
                              const form = e.currentTarget;
                              try {
                                await perform(
                                  `runs/${selected.id}/message`,
                                  { message: f.get("message") },
                                  "POST",
                                  ui("Nachricht übermittelt."),
                                );
                                form.reset();
                              } catch {}
                            }}
                          >
                            <input
                              name="message"
                              required
                              placeholder={ui(
                                "Information ergänzen oder Rückfrage beantworten …",
                              )}
                              maxLength={12000}
                            />
                            <button
                              className="primary"
                              aria-label={ui("Nachricht senden")}
                            >
                              <Send size={17} />
                            </button>
                          </form>
                        )}
                      </section>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="search-field">
                    <Search size={17} />
                    <input
                      placeholder={ui("Aufträge durchsuchen …")}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  <section className="panel">
                    {runList(
                      [
                        ...s.runs,
                        ...olderRuns.filter(
                          (r) => !s.runs.some((x) => x.id === r.id),
                        ),
                      ]
                        .sort(
                          (a, b) =>
                            b.created_at.localeCompare(a.created_at) ||
                            b.id.localeCompare(a.id),
                        )
                        .filter((r) =>
                          r.goal.toLowerCase().includes(search.toLowerCase()),
                        ),
                    )}
                  </section>
                  {(runsCursor === undefined
                    ? s.page?.runs_next
                    : runsCursor) && (
                    <div className="button-row">
                      <button
                        className="secondary"
                        disabled={loadingMore}
                        onClick={async () => {
                          setLoadingMore(true);
                          try {
                            const page = await api<State>(
                              "state?view=tasks&before=" +
                                encodeURIComponent(
                                  (runsCursor === undefined
                                    ? s.page?.runs_next
                                    : runsCursor)!,
                                ),
                            );
                            setOlderRuns((old) => mergePage(old, page.runs));
                            setRunsCursor(page.page?.runs_next ?? null);
                          } catch (e) {
                            setError((e as Error).message);
                          } finally {
                            setLoadingMore(false);
                          }
                        }}
                      >
                        {t("Ältere Aufträge laden", "Load older tasks")}
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
          {view === "activity" && (
            <>
              <UsageDashboard key={s.workspace.id} />
              <details className="panel activity-panel team-events-panel">
                <summary>
                  {t(
                    "Team-Ereignisse dieses Workspaces",
                    "Team events in this workspace",
                  )}
                </summary>
                <div className="team-events-body">{activity(s.events)}</div>
              </details>
            </>
          )}
          {view === "skills" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    {ui("WISSEN WIRD ARBEITSWEISE")}
                  </div>
                  <h1>{ui("Skills-Bibliothek")}</h1>
                  <p>
                    {ui("Wiederverwendbare Anleitungen für dein Agententeam.")}
                  </p>
                </div>
                <button className="primary" onClick={() => editSkill()}>
                  <Plus size={17} />
                  {ui("Skill erstellen")}
                </button>
              </div>
              <AutomationsPanel state={s} />
              <div className="resource-grid">
                {s.skills.map((skill) => (
                  <article className="resource-card" key={skill.id}>
                    <BookOpen className="cyan-text" size={25} />
                    <span className="subtle-chip">v{skill.version}</span>
                    <h3>{skill.name}</h3>
                    <p>{skill.description}</p>
                    <SkillReview skill={skill} changed={() => void refresh()} />
                    <button
                      className="secondary"
                      onClick={() => editSkill(skill)}
                    >
                      {ui("Bearbeiten")}
                      <ArrowUpRight size={14} />
                    </button>
                  </article>
                ))}
              </div>
              {!s.skills.length && (
                <section className="panel">
                  <Empty
                    icon={BookOpen}
                    title={ui("Deine Erfahrung als Skill")}
                  >
                    {ui(
                      "Erstelle eine Arbeitsanweisung oder importiere eine SKILL.md-Datei. Weise sie anschließend einem Agenten zu.",
                    )}
                  </Empty>
                </section>
              )}
            </>
          )}
          {view === "mcp" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">{ui("WERKZEUGE FÜR DEIN TEAM")}</div>
                  <h1>{ui("MCP-Verbindungen")}</h1>
                  <p>{ui("Verbinde externe Dienste über Streamable HTTP.")}</p>
                </div>
                <button className="primary" onClick={() => editConnection()}>
                  <Plus size={17} />
                  {ui("Server verbinden")}
                </button>
              </div>
              <div className="resource-grid">
                {s.connections.map((c) => (
                  <article className="resource-card" key={c.id}>
                    <Plug className="cyan-text" size={25} />
                    <span className="subtle-chip">
                      {c.enabled ? ui("Aktiv") : ui("Inaktiv")}
                    </span>
                    <h3>{c.name}</h3>
                    <p className="mono wrap">{c.url}</p>
                    <small>
                      {c.allowed_tools.length}
                      {ui(" Werkzeuge freigegeben")}
                    </small>
                    <div className="button-row">
                      <button
                        className="secondary"
                        onClick={() => editConnection(c)}
                      >
                        {ui("Bearbeiten")}
                      </button>
                      <button
                        className="text-button"
                        onClick={() => {
                          void api<{
                            tools: { name: string; description?: string }[];
                          }>(`connections/${c.id}/discover`, {})
                            .then((data) =>
                              setModal(
                                <Modal
                                  title={ui("Werkzeuge · {0}", [c.name])}
                                  close={close}
                                >
                                  <div className="form-note">
                                    {ui(
                                      "Kopiere die gewünschten Werkzeugnamen in die Freigabeliste der Verbindung.",
                                    )}
                                  </div>
                                  {data.tools.map((t) => (
                                    <div className="tool-entry" key={t.name}>
                                      <code>{t.name}</code>
                                      <p>{t.description}</p>
                                    </div>
                                  ))}
                                </Modal>,
                              ),
                            )
                            .catch((err) => setError((err as Error).message));
                        }}
                      >
                        {ui("Erkennen")}
                        <RefreshCw size={14} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              {!s.connections.length && (
                <section className="panel">
                  <Empty icon={Plug} title={ui("Dein Team bekommt Werkzeuge")}>
                    {ui(
                      "Verbinde einen MCP-Server, erkenne dessen Werkzeuge und erteile gezielt Zugriff.",
                    )}
                  </Empty>
                </section>
              )}
            </>
          )}
          {view === "models" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    {ui("DEIN MODELL. DEINE ENTSCHEIDUNG.")}
                  </div>
                  <h1>{ui("KI & Modelle")}</h1>
                  <p>
                    {ui(
                      "Mehrere Anbieter, eigene Schlüssel und eine Modellwahl pro Agent.",
                    )}
                  </p>
                </div>
              </div>
              <p className="workspace-shortcut">
                <a href="/settings/budgets">
                  {t(
                    "Auftragsbudgets und Ausweichmodelle verwalten",
                    "Manage task budgets and fallback models",
                  )}{" "}
                  →
                </a>
              </p>
              <ModelCatalog models={s.models} state={s} save={perform} />
            </>
          )}
          {view === "billing" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">{ui("WACHSE MIT DEINEM TEAM")}</div>
                  <h1>{ui("Plan & Guthaben")}</h1>
                  <p>
                    {ui("Aktuell: ")}
                    {s.plan.name} ·{" "}
                    {s.workspace.subscription_status === "local_test"
                      ? ui("lokale Testfreischaltung")
                      : ui("lokaler Testbetrieb")}
                  </p>
                </div>
                <span className="credit-total">
                  <Coins size={20} />
                  {number(s.workspace.credits)} Credits
                </span>
              </div>
              <div className="form-note">
                <ShieldCheck size={18} />
                {s.stripeAvailable
                  ? ui(
                      "Stripe-Checkout ist aktiviert. Verbindliche Beträge und Steuerangaben siehst du vor dem Bezahlen.",
                    )
                  : ui(
                      "Zahlungen sind deaktiviert. Pläne und Guthaben können im",
                    )}{" "}
                {!s.stripeAvailable && (
                  <>
                    {ui(
                      "Adminbereich ausdrücklich als Test freigeschaltet werden.",
                    )}
                  </>
                )}
              </div>
              <div className="form-note">
                <strong>
                  {t(
                    "KI-Credits ≠ Hosting-Minuten ≠ Modellaufrufe",
                    "AI credits ≠ hosted minutes ≠ model calls",
                  )}
                </strong>
                <p>
                  {t(
                    "KI-Credits bezahlen KeRnCloud-Modelle. Deine eigene KI-Verbindung wird beim Anbieter abgerechnet und benötigt hier keine KI-Credits. Aktive Abos erhalten ihre Kontingente automatisch: manuelle und Geschenk-Abos am 1. des Monats (UTC), Stripe-Abos nach bestätigter Zahlung. Ein Planwechsel füllt ein bereits zugeteiltes Monatskontingent nicht erneut auf. Details und Buchungen:",
                    "AI credits pay for KeRnCloud models. Your own AI connection is billed by its provider and needs no KeRnCloud AI credits. Active subscriptions receive allowances automatically: manual and gifted subscriptions on the first of the month (UTC), Stripe subscriptions after confirmed payment. Changing a plan does not refill an allowance already granted this month. Details and transactions:",
                  )}{" "}
                  <a href="/activity">
                    {t("Verbrauch & Statistik", "Usage & statistics")}
                  </a>
                  .
                </p>
              </div>
              {s.model_usage && (
                <p className="form-note">
                  {t(
                    "Modellaufrufe dieses Kalendermonats (UTC):",
                    "Model calls this calendar month (UTC):",
                  )}{" "}
                  {number(s.model_usage.used)} / {number(s.model_usage.quota)} ·{" "}
                  {s.model_usage.parallel}{" "}
                  {t(
                    "Agentenaufgaben gleichzeitig pro Konto. Eigene KI nutzt ebenfalls dieses Plattform-Kontingent.",
                    "concurrent agent tasks per account. Your own AI also uses this platform allowance.",
                  )}
                </p>
              )}
              <div className="plans-grid">
                {s.plans.map((p) => (
                  <article
                    className={`plan-card ${p.id === s.plan.id ? "current" : ""}`}
                    key={p.id}
                  >
                    <div className="eyebrow">{p.name}</div>
                    <h2>
                      {money(p.price_cents)}
                      <small>{ui("/ Monat")}</small>
                    </h2>
                    <p>
                      {p.managed
                        ? ui("KI-Zugang mit Guthaben")
                        : ui("Für deinen eigenen KI-Anbieter")}
                    </p>
                    <ul>
                      <li>
                        <Check size={16} />
                        {p.max_agents}
                        {ui(" Agenten pro Workspace")}
                      </li>
                      <li>
                        <Check size={16} />
                        {p.max_steps}
                        {ui(" Schritte pro Auftrag")}
                      </li>
                      <li>
                        <Check size={16} />
                        {number(p.credits)}
                        {ui(" KI-Credits")}
                      </li>
                      <li>
                        <Check size={16} />
                        {ui("Skills & MCP-Verbindungen")}
                      </li>
                      <li>
                        <Check size={16} />
                        {p.max_workspaces}
                        {ui(" Workspaces · Konto-Guthaben gemeinsam")}
                      </li>
                      <li>
                        <Check size={16} />
                        {number(p.monthly_steps)}{" "}
                        {t(
                          "Modellaufrufe je Kalendermonat (UTC)",
                          "model calls per calendar month (UTC)",
                        )}{" "}
                        · {p.max_parallel_tasks} {t("gleichzeitig", "at once")}
                      </li>
                      <li>
                        <Check size={16} />
                        {p.max_customer_hosts}{" "}
                        {t("eigene Rechner ·", "customer hosts ·")}{" "}
                        {p.max_local_environments}{" "}
                        {t("lokale Plätze", "local slots")}
                      </li>
                      <li>
                        <Check size={16} />
                        {p.max_environments ?? 0}
                        {ui(" Umgebungsplätze ·")}{" "}
                        {p.max_running_environments ?? 0}
                        {ui(" gleichzeitig")}
                      </li>
                      <li>
                        <Check size={16} />
                        {number(p.runtime_minutes ?? 0)}
                        {ui(" Laufzeit-Minuten pro Zeitraum")}
                      </li>
                    </ul>
                    <button
                      className={p.id === s.plan.id ? "secondary" : "primary"}
                      disabled={p.id === s.plan.id}
                      onClick={() =>
                        formModal(
                          ui("Plan buchen"),
                          <>
                            <p>
                              {p.name} · {money(p.price_cents)}
                              {ui(
                                " pro Monat. Die verbindliche Preis- und Steueranzeige erfolgt im Stripe-Checkout.",
                              )}
                            </p>
                            <label className="check-row">
                              <input name="terms" type="checkbox" required />
                              {ui("Ich akzeptiere die")}{" "}
                              <a
                                href="/legal/agb"
                                target="_blank"
                                rel="noreferrer"
                              >
                                {ui("AGB")}
                              </a>{" "}
                              {ui("und habe die")}{" "}
                              <a
                                href="/legal/datenschutz"
                                target="_blank"
                                rel="noreferrer"
                              >
                                {ui("Datenschutzhinweise")}
                              </a>{" "}
                              {ui("gelesen.")}
                            </label>
                          </>,
                          async () => {
                            const result = await perform("billing/checkout", {
                              planId: p.id,
                              termsAccepted: true,
                            });
                            if (result.url)
                              window.location.assign(result.url as string);
                          },
                          ui("Weiter zum Checkout"),
                        )
                      }
                    >
                      {p.id === s.plan.id
                        ? ui("Dein aktueller Plan")
                        : ui("Plan auswählen")}
                      <ArrowRight size={16} />
                    </button>
                  </article>
                ))}
              </div>
              <>
                <AccountBenefits />
                <InvoicesPanel />
              </>
              <section className="panel">
                <div className="panel-heading">
                  <h2>{ui("Guthabenverlauf")}</h2>
                </div>
                {s.ledger.length ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>{ui("Zeit")}</th>
                          <th>{ui("Vorgang")}</th>
                          <th>Credits</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.ledger.map((l, i) => (
                          <tr key={i}>
                            <td>{date(l.created_at)}</td>
                            <td>{l.reason}</td>
                            <td>
                              {l.amount > 0 ? "+" : ""}
                              {number(l.amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty icon={Wallet} title={ui("Noch keine Buchungen")}>
                    {ui(
                      "Gutschriften und verwaltete KI-Nutzung werden hier nachvollziehbar erfasst.",
                    )}
                  </Empty>
                )}
              </section>
            </>
          )}
          {view === "privacy" && (
            <Privacy
              state={s}
              perform={perform}
              logout={() => setLoggedOut(true)}
            />
          )}
          {view === "environmentOverview" && (
            <EnvironmentOverview key={s.workspace.id} />
          )}
          {view === "environments" && (
            <>
              <CustomerEnvironments key={s.workspace.id} />
              <EnvironmentBudgets
                workspaceId={s.workspace.id}
                role={s.workspace.membership_role ?? "owner"}
              />
            </>
          )}
          {view === "admin" && (
            <AdminPanel perform={perform} refreshKey={notice} />
          )}
          <footer className="page-footer">
            <span>KeRnCloud</span>
            <span>
              <ShieldCheck size={13} />
              {ui("Dein Workspace, deine Kontrolle.")}
            </span>
          </footer>
        </main>
      </div>
      {modal}
      {notice && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {notice}
        </div>
      )}
      {busy && (
        <div className="busy-indicator">
          <Loader2 size={16} className="spin" />
          {ui("Wird verarbeitet …")}
        </div>
      )}
    </div>
  );
}
function ProviderForm({
  provider,
  save,
}: {
  provider: State["provider"];
  save: (b: unknown) => Promise<unknown>;
}) {
  const { ui, localeTag, number, money, date } = useLanguage();

  return (
    <form
      className="settings-form"
      key={provider?.endpoint ?? "new"}
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        await save({
          name: f.get("name"),
          endpoint: f.get("endpoint"),
          model: f.get("model"),
          key: f.get("key") || undefined,
        }).catch(() => undefined);
      }}
    >
      <div className="form-grid">
        <Field label={ui("Anbietername")}>
          <input
            name="name"
            placeholder={ui("z. B. OpenRouter oder Ollama")}
            defaultValue={provider?.name}
            required
          />
        </Field>
        <Field label={ui("Modell-ID")}>
          <input
            name="model"
            placeholder={ui("Exakte ID deines Modells")}
            defaultValue={provider?.model}
            required
          />
        </Field>
      </div>
      <Field
        label={ui("API-Basis-URL")}
        hint={ui(
          "Beispiel: https://openrouter.ai/api/v1 oder http://host.docker.internal:11434/v1",
        )}
      >
        <input
          name="endpoint"
          type="url"
          defaultValue={provider?.endpoint}
          placeholder="https://anbieter.de/v1"
          required
        />
      </Field>
      <Field
        label={ui("API-Schlüssel (optional für lokale Modelle)")}
        hint={ui(
          "Verschlüsselte Speicherung. Ein leeres Feld behält den vorhandenen Schlüssel bei.",
        )}
      >
        <input
          name="key"
          type="password"
          autoComplete="new-password"
          placeholder={
            provider
              ? ui("Schlüssel gespeichert · zum Ersetzen neu eingeben")
              : ui("API-Schlüssel eingeben")
          }
        />
      </Field>
      <button className="primary">
        {ui("Anbieter speichern")}
        <Check size={16} />
      </button>
    </form>
  );
}
function Privacy({
  state: s,
  perform,
  logout,
}: {
  state: State;
  perform: (p: string, b: unknown, m?: string, n?: string) => Promise<unknown>;
  logout: () => void;
}) {
  const { ui, localeTag, number, money, date, t } = useLanguage();

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">{ui("DEINE DATEN")}</div>
          <h1>{ui("Datenschutz & Kontrolle")}</h1>
          <p>
            {ui(
              "Verwalte deine Einstellungen und exportiere deine Workspace-Daten.",
            )}
          </p>
        </div>
      </div>
      <section className="panel settings-panel">
        <h2>{ui("Datenexport")}</h2>
        <p>
          {ui(
            "Lade deine Kontodaten, Agenten, Skills, Aufträge und Ergebnisse als JSON herunter. Zugangsschlüssel sind nicht enthalten.",
          )}
        </p>
        <a className="secondary" href="/api/privacy/export" download>
          <ArrowDownToLine size={16} />
          {ui("Daten exportieren")}
        </a>
      </section>
      <section className="panel settings-panel">
        <h2>{ui("Aufbewahrung & Einwilligung")}</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void perform("privacy/settings", {
              retention_days: Number(f.get("days")),
              marketing_consent: f.get("marketing") === "on",
            }).catch(() => undefined);
          }}
        >
          <Field label={ui("Aufbewahrung abgeschlossener Aufträge (Tage)")}>
            <input
              type="number"
              name="days"
              min={1}
              max={365}
              defaultValue={s.workspace.retention_days}
              required
            />
          </Field>
          <label className="check-row">
            <input
              type="checkbox"
              name="marketing"
              defaultChecked={s.user.marketing_consent}
            />
            {ui(
              "Produktneuigkeiten erhalten (optional, jederzeit widerrufbar)",
            )}
          </label>
          <p className="muted">
            {ui(
              "Beim Speichern werden abgeschlossene Aufträge außerhalb der Frist aus der aktiven Datenbank entfernt.",
            )}
          </p>
          <button className="primary">{ui("Einstellungen speichern")}</button>
        </form>
      </section>
      <section className="panel settings-panel">
        <h2>{ui("Konto löschen")}</h2>
        <p className="form-note">
          {t(
            "Gesetzlich aufzubewahrende E-Rechnungen bleiben im Betreiberarchiv erhalten. Der Kontozugriff und die übrigen löschbaren Kontodaten werden entfernt.",
            "Electronic invoices subject to statutory retention remain in the operator archive. Account access and other erasable account data are removed.",
          )}
        </p>
        <p>
          {ui(
            "Entfernt dein Konto und alle zugehörigen Workspace-Daten aus der aktiven Datenbank. Laufende Aufträge verlieren ihren Zugriff. Betreiber-Backups unterliegen einem getrennten Löschkonzept.",
          )}
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            try {
              await perform("privacy/delete", {
                password: f.get("password"),
                code: f.get("code"),
                confirmation: f.get("confirmation"),
              });
              logout();
            } catch {}
          }}
        >
          <div className="form-grid">
            <Field
              label={ui(
                "Aktuelles Passwort (bei Dienstkonto ohne Passwort leer lassen)",
              )}
            >
              <input
                name="password"
                type="password"
                autoComplete="current-password"
              />
            </Field>
            <Field label={ui("2FA-Code (falls aktiviert)")}>
              <input name="code" autoComplete="one-time-code" maxLength={80} />
            </Field>
            <Field label={ui("Zum Bestätigen: KONTO LÖSCHEN")}>
              <input
                name="confirmation"
                pattern={ui("KONTO LÖSCHEN")}
                required
              />
            </Field>
          </div>
          <button className="danger" disabled={s.user.role === "admin"}>
            {ui("Konto und Workspace löschen")}
          </button>
        </form>
      </section>
      <div className="form-note">
        {ui(
          "Technische Datenschutzfunktionen sind vorhanden. Vor einem öffentlichen Betrieb müssen Datenschutzerklärung, Verantwortlicher, Auftragsverarbeitung, Löschkonzept und die verwendeten KI-Dienste auf den tatsächlichen Betrieb abgestimmt werden.",
        )}{" "}
        <a href="/privacy" target="_blank" rel="noreferrer">
          {ui("Hinweise lesen")}
        </a>
      </div>
    </>
  );
}
function AdminPanel({
  perform,
  refreshKey,
}: {
  perform: (p: string, b: unknown, m?: string, n?: string) => Promise<unknown>;
  refreshKey: string;
}) {
  const { ui, localeTag, number, money, date, t } = useLanguage();

  const router = useRouter();
  const tab = resolveWorkspacePath(usePathname())?.adminTab ?? "customers";
  const [data, setData] = useState<AdminState | null>(null),
    [error, setError] = useState("");
  const load = useCallback(
    () =>
      api<AdminState>("admin")
        .then(setData)
        .catch((e) => setError((e as Error).message)),
    [],
  );
  useEffect(() => {
    void load();
  }, [load, refreshKey]);
  if (!data)
    return (
      <div className="loading-inline">
        {error || ui("Administration wird geladen …")}
      </div>
    );
  const save = async (path: string, b: unknown) => {
    await perform(`admin/${path}`, b);
    await load();
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">{ui("BETREIBERKONSOLE")}</div>
          <h1>{t("Plattformverwaltung", "Platform administration")}</h1>
          <p>
            {ui("Kunden, Angebote, KI-Zugang und Promotion zentral verwalten.")}
          </p>
        </div>
        <span className="subtle-chip">
          <ShieldCheck size={14} />
          Administrator
        </span>
      </div>
      <details className="operator-metrics" open={tab === "customers"}>
        <summary>{t("Plattformüberblick", "Platform overview")}</summary>{" "}
        <div className="stats-grid">
          {[
            [ui("Kundenkonten"), data.users.length],
            ["Workspaces", data.workspaces.length],
            [ui("Modellaufrufe"), number(data.usage.calls)],
            [ui("Verarbeitete Tokens"), number(Number(data.usage.tokens))],
          ].map(([label, value]) => (
            <article className="stat-card" key={label}>
              <div>
                {label}
                <Gauge size={17} />
              </div>
              <strong>{value}</strong>
              <small>{ui("Lokale SaaS-Umgebung")}</small>
            </article>
          ))}
        </div>
      </details>
      <AdminNavigation />
      {tab === "self-hosted" && <AdminSelfHosted />}
      {tab === "customers" && <LocalUsers />}
      {tab === "company" && <AdminCompany />}
      {tab === "einvoices" && <AdminElectronicInvoices />}
      {tab === "mail" && <AdminMail />}
      {tab === "contracts" && <AdminContracts />}
      {tab === "plans" && (
        <div className="admin-plan-grid">
          {[
            ...data.plans,
            {
              id: "",
              name: "",
              price_cents: 0,
              credits: 0,
              max_agents: 3,
              max_steps: 20,
              max_workspaces: 1,
              max_environments: 0,
              max_running_environments: 0,
              runtime_minutes: 0,
              max_customer_hosts: 0,
              max_local_environments: 0,
              max_running_local: 0,
              monthly_steps: 1000,
              max_parallel_tasks: 2,
              max_automations: 0,
              automation_runs: 0,
              environment_templates: [] as string[],
              managed: false,
              active: true,
              stripe_price_id: null,
            },
          ].map((p, i) => (
            <section className="panel settings-panel" key={p.id || "new"}>
              <h2>{p.id ? p.name : ui("Neuen Plan erstellen")}</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void save("plan", {
                    id: f.get("id"),
                    name: f.get("name"),
                    price_cents: Math.round(Number(f.get("price")) * 100),
                    credits: Number(f.get("credits")),
                    max_agents: Number(f.get("agents")),
                    max_steps: Number(f.get("steps")),
                    max_workspaces: Number(f.get("workspaces")),
                    max_environments: Number(f.get("max_environments")),
                    max_running_environments: Number(
                      f.get("max_running_environments"),
                    ),
                    runtime_minutes: Number(f.get("runtime_minutes")),
                    max_customer_hosts: Number(f.get("max_customer_hosts")),
                    max_local_environments: Number(
                      f.get("max_local_environments"),
                    ),
                    max_running_local: Number(f.get("max_running_local")),
                    monthly_steps: Number(f.get("monthly_steps")),
                    max_parallel_tasks: Number(f.get("max_parallel_tasks")),
                    max_automations: Number(f.get("max_automations")),
                    automation_runs: Number(f.get("automation_runs")),
                    environment_templates: String(
                      f.get("environment_templates") ?? "",
                    )
                      .split(",")
                      .map((x) => x.trim())
                      .filter(Boolean),
                    managed: f.get("managed") === "on",
                    active: f.get("active") === "on",
                    stripe_price_id: f.get("stripe_price_id") || null,
                  }).catch(() => undefined);
                }}
              >
                <div className="form-grid">
                  <Field label={ui("Plan-ID")}>
                    <input
                      name="id"
                      defaultValue={p.id}
                      readOnly={Boolean(p.id)}
                      pattern="[a-z0-9-]+"
                      required
                    />
                  </Field>
                  <Field label={ui("Anzeigename")}>
                    <input name="name" defaultValue={p.name} required />
                  </Field>
                  <Field label={ui("Monatspreis (€)")}>
                    <input
                      name="price"
                      type="number"
                      min={0}
                      step="0.01"
                      defaultValue={p.price_cents / 100}
                      required
                    />
                  </Field>
                  <Field label={ui("Enthaltene Credits")}>
                    <input
                      name="credits"
                      type="number"
                      min={0}
                      defaultValue={p.credits}
                      required
                    />
                  </Field>
                  <Field label={ui("Max. Workspaces")}>
                    <input
                      name="workspaces"
                      type="number"
                      min="1"
                      max="100"
                      defaultValue={p.max_workspaces}
                      required
                    />
                  </Field>
                  {[
                    [
                      "max_environments",
                      ui("Max. gebuchte Umgebungen"),
                      p.max_environments ?? 0,
                    ],
                    [
                      "max_running_environments",
                      ui("Max. gleichzeitig laufende Umgebungen"),
                      p.max_running_environments ?? 0,
                    ],
                    [
                      "runtime_minutes",
                      ui("Enthaltene Laufzeit-Minuten pro Zeitraum"),
                      p.runtime_minutes ?? 0,
                    ],
                  ].map(([name, label, value]) => (
                    <Field label={String(label)} key={String(name)}>
                      <input
                        name={String(name)}
                        type="number"
                        min={0}
                        max={name === "runtime_minutes" ? 1000000 : 100}
                        defaultValue={Number(value)}
                        required
                      />
                    </Field>
                  ))}
                  {[
                    [
                      "max_customer_hosts",
                      t("Max. eigene Kunden-Rechner", "Max. customer hosts"),
                      p.max_customer_hosts,
                      0,
                      100,
                    ],
                    [
                      "max_local_environments",
                      t(
                        "Max. lokale Umgebungsplätze",
                        "Max. local environment slots",
                      ),
                      p.max_local_environments,
                      0,
                      100,
                    ],
                    [
                      "max_running_local",
                      t("Max. gleichzeitig lokal", "Max. local concurrency"),
                      p.max_running_local,
                      0,
                      100,
                    ],
                    [
                      "monthly_steps",
                      t(
                        "Modellaufrufe je Kalendermonat (UTC)",
                        "Model calls per calendar month (UTC)",
                      ),
                      p.monthly_steps,
                      1,
                      1000000,
                    ],
                    [
                      "max_parallel_tasks",
                      t(
                        "Gleichzeitige Agentenaufgaben pro Konto",
                        "Concurrent agent tasks per account",
                      ),
                      p.max_parallel_tasks,
                      1,
                      100,
                    ],
                    [
                      "max_automations",
                      t("Automationen pro Konto", "Automations per account"),
                      p.max_automations ?? 0,
                      0,
                      1000,
                    ],
                    [
                      "automation_runs",
                      t(
                        "Automationsausführungen / Monat (UTC)",
                        "Automation executions / month (UTC)",
                      ),
                      p.automation_runs ?? 0,
                      0,
                      1000000,
                    ],
                  ].map(([name, label, value, min, max]) => (
                    <Field key={String(name)} label={String(label)}>
                      <input
                        name={String(name)}
                        type="number"
                        defaultValue={Number(value)}
                        min={Number(min)}
                        max={Number(max)}
                        required
                      />
                    </Field>
                  ))}
                  <Field
                    label={ui(
                      "Erlaubte Container-Vorlagen (IDs, kommagetrennt)",
                    )}
                  >
                    <input
                      name="environment_templates"
                      defaultValue={(p.environment_templates ?? []).join(", ")}
                      placeholder="browser, development"
                    />
                  </Field>
                  <Field label={ui("Stripe Price-ID")}>
                    <input
                      name="stripe_price_id"
                      defaultValue={p.stripe_price_id ?? ""}
                      placeholder="price_…"
                      maxLength={100}
                    />
                  </Field>
                  <Field label={ui("Max. Agenten")}>
                    <input
                      name="agents"
                      type="number"
                      min={1}
                      max={50}
                      defaultValue={p.max_agents}
                      required
                    />
                  </Field>
                  <Field label={ui("Max. Schritte/Auftrag")}>
                    <input
                      name="steps"
                      type="number"
                      min={1}
                      max={500}
                      defaultValue={p.max_steps}
                      required
                    />
                  </Field>
                </div>
                <label className="check-row">
                  <input
                    type="checkbox"
                    name="managed"
                    defaultChecked={p.managed}
                  />
                  {ui("Verwalteten KI-Zugang erlauben")}
                </label>
                <label className="check-row">
                  <input
                    type="checkbox"
                    name="active"
                    defaultChecked={p.active}
                  />
                  {ui("Öffentlich in der Planauswahl anzeigen")}
                </label>
                <button className="primary">
                  {p.id ? ui("Plan speichern") : ui("Plan erstellen")}
                </button>
              </form>
            </section>
          ))}
        </div>
      )}
      {tab === "provider" && (
        <ModelCatalog
          admin
          models={data.models}
          plans={data.plans}
          save={async (path, body) => {
            await perform(path, body);
            await load();
          }}
        />
      )}
      {tab === "payments" && <AdminBusiness section="billing" save={perform} />}
      {tab === "legal" && <AdminBusiness section="legal" save={perform} />}
      {tab === "site" && <AdminBusiness section="site" save={perform} />}
      {tab === "analytics" && <AdminAnalytics />}
      {tab === "security" && <AdminLoginProviders />}
      {tab === "infrastructure" && (
        <>
          <ScalingStatus />
          <AdminInfrastructure />
        </>
      )}
      {tab === "languages" && <AdminLanguages />}
      {tab === "pages" && <AdminPages />}
      {tab === "plans" && (
        <PlanCalculator plans={data.plans} models={data.models} />
      )}
      {tab === "marketing" && (
        <>
          <section className="panel settings-panel">
            <h2>{ui("Promotion erstellen")}</h2>
            <p>
              {ui(
                "Aktive Kampagnen erscheinen als Banner in Kunden-Workspaces. Rabattcodes sind vorbereitet; eine Zahlungsanbindung ist lokal deaktiviert.",
              )}
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void save("campaign", {
                  title: f.get("title"),
                  body: f.get("body"),
                  code: f.get("code"),
                  discount_percent: Number(f.get("discount")),
                  active: true,
                  expires_at: f.get("expires")
                    ? new Date(String(f.get("expires"))).toISOString()
                    : null,
                }).catch(() => undefined);
              }}
            >
              <Field label={ui("Überschrift")}>
                <input name="title" required maxLength={200} />
              </Field>
              <Field label={ui("Beschreibung")}>
                <textarea name="body" rows={3} required maxLength={4000} />
              </Field>
              <div className="form-grid">
                <Field label={ui("Aktionscode")}>
                  <input
                    name="code"
                    pattern="[A-Z0-9_-]{2,30}"
                    placeholder="WELCOME20"
                    required
                  />
                </Field>
                <Field label={ui("Rabatt (%)")}>
                  <input
                    name="discount"
                    type="number"
                    min={0}
                    max={100}
                    defaultValue={0}
                    required
                  />
                </Field>
                <Field label={ui("Ablauf (optional)")}>
                  <input name="expires" type="datetime-local" />
                </Field>
              </div>
              <button className="primary">
                <Megaphone size={16} />
                {ui("Kampagne anlegen")}
              </button>
            </form>
          </section>
          <div className="resource-grid">
            {data.campaigns.map((c) => (
              <article className="resource-card" key={c.id}>
                <Megaphone size={24} className="cyan-text" />
                <span className="subtle-chip">
                  {c.active ? ui("Aktiv") : ui("Pausiert")}
                </span>
                <h3>{c.title}</h3>
                <p>{c.body}</p>
                <code>
                  {c.code} · {c.discount_percent}%
                </code>
                <button
                  className="secondary"
                  onClick={() =>
                    void save("campaign", { ...c, active: !c.active }).catch(
                      () => undefined,
                    )
                  }
                >
                  {c.active ? ui("Pausieren") : ui("Aktivieren")}
                </button>
              </article>
            ))}
          </div>
        </>
      )}
      {tab === "audit" && (
        <section className="panel">
          <div className="panel-heading">
            <h2>{ui("Nachvollziehbare Verwaltungsaktionen")}</h2>
            <ShieldCheck size={18} />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{ui("Zeit")}</th>
                  <th>{ui("Akteur")}</th>
                  <th>{ui("Aktion")}</th>
                  <th>{ui("Referenz")}</th>
                </tr>
              </thead>
              <tbody>
                {data.audit.map((a) => (
                  <tr key={a.id}>
                    <td>{date(a.created_at)}</td>
                    <td>{a.email ?? ui("Gelöschtes Konto")}</td>
                    <td>
                      <code>{a.action}</code>
                    </td>
                    <td className="mono">{a.subject.slice(0, 25)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
