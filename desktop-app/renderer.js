"use strict";
const $ = (selector) => document.querySelector(selector),
  text = (node, value) => {
    if (node.textContent !== value) node.textContent = value;
  };
let language =
    localStorage.getItem("kerncloud-desktop-language") === "de" ? "de" : "en",
  info,
  updateState,
  busy = false,
  currentContext = null,
  refreshing = null;
const states = new Map(),
  logs = new Map(),
  outputs = new Map();
for (const output of document.querySelectorAll("[data-output]")) {
  const fragment = $("#progress-template").content.cloneNode(true);
  output.append(fragment);
  outputs.set(output.dataset.output, output);
}
const t = (en, de) => (language === "de" ? de : en);
function translate() {
  document.documentElement.lang = language;
  $("#language").value = language;
  for (const node of document.querySelectorAll("[data-en]"))
    text(node, node.dataset[language] ?? node.dataset.en);
  renderServices();
  renderUpdates();
  for (const [context, state] of states) renderProgress(context, state);
}
function message(context, value, error = false) {
  const node = outputs.get(context).querySelector("[data-message]");
  node.classList.toggle("error", error);
  text(node, value);
}
function renderProgress(context, state) {
  const node = outputs.get(context).querySelector(".operation"),
    view = window.localProgress.view(state, language);
  if (state.command === "status" && state.finishedAt) {
    node.hidden = true;
    return;
  }
  node.hidden = false;
  if (
    context === "services" &&
    !state.finishedAt &&
    ["start", "stop"].includes(state.command)
  ) {
    text(
      $("#runtime-state"),
      state.command === "start"
        ? t("Starting…", "Wird gestartet …")
        : t("Stopping…", "Wird gestoppt …"),
    );
    $("#runtime-state").dataset.state = "starting";
    text(
      $("#service-description"),
      state.command === "start"
        ? t(
            "Follow each step below. The first start can take several minutes.",
            "Verfolge die Schritte unten. Der erste Start kann einige Minuten dauern.",
          )
        : t(
            "Stopping this installation. Your data and permissions will be preserved.",
            "Diese Installation wird gestoppt. Daten und Freigaben bleiben erhalten.",
          ),
    );
  }
  node.classList.toggle("finished", !!state.finishedAt);
  node.classList.toggle("failed", state.failed);
  text(node.querySelector("[data-phase]"), view.heading);
  text(node.querySelector("[data-elapsed]"), view.elapsed);
  text(node.querySelector("[data-note]"), view.note);
  text(node.querySelector("[data-detail]"), state.detail);
  const list = node.querySelector("[data-steps]"),
    signature = JSON.stringify(view.steps);
  if (list.dataset.signature !== signature) {
    list.dataset.signature = signature;
    list.replaceChildren(
      ...view.steps.map((step) => {
        const li = document.createElement("li");
        li.dataset.state = step.state;
        li.textContent = step.label;
        return li;
      }),
    );
  }
  list.hidden = !view.steps.length;
  node.querySelector(".activity-track").hidden = !!state.finishedAt;
}
function renderServices() {
  if (info?.connection?.mode === "remote") {
    text(
      $("#runtime-state"),
      info.ready
        ? t("Connected", "Verbunden")
        : t("Server unavailable", "Server nicht erreichbar"),
    );
    text($("#service-description"), info.url);
    setControls();
    return;
  }
  if (!info) return;
  const state = window.localProgress.serviceSummary(info.services, info.ready),
    names = {
      running: t("Running", "Gestartet"),
      stopped: t("Stopped", "Gestoppt"),
      starting: t("Starting", "Wird gestartet"),
      attention: t("Needs attention", "Prüfung erforderlich"),
      unknown: t("Status unavailable", "Status nicht verfügbar"),
    };
  const badge = $("#runtime-state");
  text(badge, names[state]);
  badge.dataset.state = state;
  text(
    $("#service-description"),
    info.ready
      ? info.url
      : state === "stopped"
        ? t(
            "Your data is preserved. Select Start locally when you want to continue.",
            "Deine Daten bleiben erhalten. Wähle Lokal starten, um weiterzuarbeiten.",
          )
        : t(
            "Use Refresh status to check your local installation.",
            "Mit Status aktualisieren prüfst du deine lokale Installation.",
          ),
  );
  const list = $("#service-list");
  list.replaceChildren();
  const labels = {
    app: t("Workspace", "Workspace"),
    postgres: t("Database", "Datenbank"),
    worker: t("Agent worker", "Agenten-Worker"),
    gateway: t("Environment gateway", "Umgebungs-Gateway"),
    scheduler: t("Scheduler", "Zeitplanung"),
    "object-storage": t("File storage", "Dateispeicher"),
    "artifact-validator": t("File validation", "Dateiprüfung"),
  };
  for (const service of info.services ?? []) {
    const li = document.createElement("li"),
      name = document.createElement("strong"),
      status = document.createElement("span");
    text(name, labels[service.service] ?? service.service);
    const stateLabel =
      {
        running: t("Running", "Gestartet"),
        exited: t("Stopped", "Gestoppt"),
        created: t("Not started", "Noch nicht gestartet"),
        restarting: t("Restarting", "Startet neu"),
        paused: t("Paused", "Pausiert"),
        dead: t("Stopped unexpectedly", "Unerwartet beendet"),
      }[service.state] ?? service.state;
    const health =
      service.health === "healthy"
        ? t("Ready", "Bereit")
        : service.health === "unhealthy"
          ? t("Unhealthy", "Fehlerhaft")
          : service.health === "starting"
            ? t("Checking readiness", "Bereitschaft wird geprüft")
            : "";
    text(status, stateLabel + (health ? " · " + health : ""));
    li.dataset.state =
      service.health === "unhealthy" ? "attention" : service.state;
    li.append(name, status);
    list.append(li);
  }
  if (!list.children.length) {
    const li = document.createElement("li");
    text(
      li,
      info.services === null
        ? t(
            "Service status could not be read. Check Docker or refresh again.",
            "Dienststatus konnte nicht gelesen werden. Prüfe Docker oder aktualisiere erneut.",
          )
        : t(
            "No local services have been created yet.",
            "Es wurden noch keine lokalen Dienste erstellt.",
          ),
    );
    list.append(li);
  }
  text(
    $("#docker-state"),
    info.docker.running
      ? t("Docker is ready.", "Docker ist bereit.")
      : info.docker.installed || info.docker.desktopInstalled
        ? t(
            "Docker is installed but not running.",
            "Docker ist installiert, aber nicht gestartet.",
          )
        : t(
            "Docker is not installed yet.",
            "Docker ist noch nicht installiert.",
          ),
  );
  setControls();
}
function setControls() {
  const appInstalling = ["verifying", "installing"].includes(
    updateState?.phase,
  );
  for (const button of document.querySelectorAll("[data-action]")) {
    let disabled = busy || appInstalling;
    if (!info && ["start", "stop", "open"].includes(button.dataset.action))
      disabled = true;
    if (info && !busy && !appInstalling) {
      const command = button.dataset.action;
      if (command === "start")
        disabled =
          window.localProgress.serviceSummary(info.services, info.ready) ===
            "running" ||
          (!info.docker.installed && !info.docker.desktopInstalled);
      if (command === "stop")
        disabled =
          !info.docker.running ||
          window.localProgress.serviceSummary(info.services, info.ready) ===
            "stopped";
      if (["open", "users"].includes(command)) disabled = !info.ready;
    }
    if (
      info?.connection?.mode === "remote" &&
      !["open", "users"].includes(button.dataset.action)
    )
      disabled = true;
    button.disabled = disabled;
  }
  for (const field of document.querySelectorAll(
    "#network-form input,#network-form select,#network-form button,#connection-form input,#connection-form select,#connection-form button,#autostart",
  ))
    field.disabled = busy || appInstalling;
  renderUpdates();
}
async function refresh(fields = false) {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    info = await window.kernLocal.action("info");
    updateState = info.updates;
    const remote = info.connection?.mode === "remote";
    for (const node of document.querySelectorAll("[data-local-only]"))
      node.hidden = remote;
    for (const button of $("#services-panel").querySelectorAll("[data-action]"))
      button.hidden = remote;
    if (fields) {
      $("#connection-mode").value = info.connection?.mode ?? "local";
      $("#server-address").value = info.connection?.url ?? "";
      $("#server-address-row").hidden = !remote;
    }
    text($("#version"), "Version " + info.version);
    text($("#origin"), info.url);
    $("#autostart").checked = info.autostart;
    $("#autostart-row").hidden = info.platform === "linux";
    if (fields) {
      $("#port").value = info.network.port;
      $("#gateway-port").value = info.network.gatewayPort;
      $("#exposure").value = info.network.exposure;
      $("#hostname").value = info.network.hostname;
      $("#hostname-row").hidden = info.network.exposure !== "lan";
    }
    renderServices();
    return info;
  })();
  try {
    return await refreshing;
  } finally {
    refreshing = null;
  }
}
window.kernLocal.onLog((value) => {
  if (!currentContext) return;
  const log = outputs.get(currentContext).querySelector("[data-log]"),
    next = ((logs.get(currentContext) ?? "") + value).slice(-50000);
  logs.set(currentContext, next);
  text(log, next);
  if (log.scrollHeight - log.scrollTop - log.clientHeight < 300)
    log.scrollTop = log.scrollHeight;
});
window.kernLocal.onProgress((state) => {
  if (!currentContext) return;
  states.set(currentContext, state);
  renderProgress(currentContext, state);
});
function renderUpdates() {
  if (!updateState) return;
  const s = updateState,
    labels = {
      idle: t(
        "Updates are checked automatically when enabled.",
        "Updates werden bei aktivierter Automatik selbstständig geprüft.",
      ),
      checking: t("Checking for app updates…", "App-Updates werden geprüft …"),
      current: t("Your app is up to date.", "Deine App ist aktuell."),
      unavailable: t(
        "No automatic update package is available for this installation yet.",
        "Für diese Installation ist noch kein automatisches Update-Paket verfügbar.",
      ),
      downloading: t(
        "Downloading verified app update…",
        "Geprüftes App-Update wird heruntergeladen …",
      ),
      ready: t(
        "Update ready. Install now or let it install the next time you open the app (Linux requires a click).",
        "Update bereit. Jetzt installieren oder beim nächsten Öffnen der App installieren lassen (unter Linux per Klick).",
      ),
      verifying: t(
        "Verifying the update before installation…",
        "Update wird vor der Installation geprüft …",
      ),
      installing: t(
        "Installing and restarting the app…",
        "App wird installiert und neu gestartet …",
      ),
      error: t(
        "Could not complete the update. Your saved data is preserved. Check again later.",
        "Update konnte nicht abgeschlossen werden. Deine gespeicherten Daten bleiben erhalten. Bitte später erneut prüfen.",
      ),
      "preferences-error": t(
        "Check your update preferences and re-enable automatic updates if desired.",
        "Prüfe deine Update-Einstellung und aktiviere die Automatik bei Bedarf erneut.",
      ),
    };
  text(
    $("#app-update-status"),
    (labels[s.phase] ?? labels.idle) +
      (s.availableVersion ? " · " + s.availableVersion : ""),
  );
  text($("#app-update-version"), "Version " + s.version);
  $("#automatic-updates").checked = s.automatic;
  const installing = ["verifying", "installing"].includes(s.phase);
  $("#automatic-updates").disabled = installing;
  $("#check-app-update").disabled =
    busy ||
    ["checking", "downloading", "verifying", "installing"].includes(s.phase);
  $("#install-app-update").hidden = s.phase !== "ready";
  $("#install-app-update").disabled = busy || !s.canInstall;
  $("#app-update-progress").hidden = s.phase !== "downloading";
  $("#app-update-progress").value = s.progress;
}
window.kernLocal.onUpdates((state) => {
  updateState = state;
  setControls();
});
async function updateAction(command, input) {
  try {
    updateState = await window.kernLocal.action(command, input);
    setControls();
  } catch (error) {
    text(
      $("#app-update-status"),
      String(error.message).replace(
        /^Error invoking remote method '[^']+': (?:Error: )?/,
        "",
      ),
    );
    await window.kernLocal
      .action("updates:state")
      .then((state) => {
        updateState = state;
      })
      .catch(() => {});
  }
}
$("#check-app-update").addEventListener("click", () =>
  updateAction("updates:check"),
);
$("#install-app-update").addEventListener("click", () =>
  updateAction("updates:install"),
);
$("#automatic-updates").addEventListener("change", (e) =>
  updateAction("updates:automatic", { enabled: e.target.checked }),
);
const success = {
  start: () =>
    t(
      "Your workspace is ready. Select Open workspace.",
      "Dein Workspace ist bereit. Wähle Workspace öffnen.",
    ),
  stop: () =>
    t(
      "Local services stopped. Your data and permissions are preserved.",
      "Lokale Dienste gestoppt. Daten und Freigaben bleiben erhalten.",
    ),
  status: () => t("Service status updated.", "Dienststatus aktualisiert."),
  backup: () => t("Backup created.", "Backup erstellt."),
  update: () =>
    t(
      "Local server updated. Your data and permissions are preserved.",
      "Lokaler Server aktualisiert. Daten und Freigaben bleiben erhalten.",
    ),
  doctor: () =>
    t(
      "Docker Linux engine and Compose are ready.",
      "Docker-Linux-Engine und Compose sind bereit.",
    ),
  "network:save": () =>
    t(
      "Settings saved. Stop and start services to apply them.",
      "Einstellungen gespeichert. Dienste zum Anwenden stoppen und starten.",
    ),
  "autostart:on": () => t("Startup enabled.", "Autostart aktiviert."),
  "autostart:off": () => t("Startup disabled.", "Autostart deaktiviert."),
  credentials: () =>
    t("Opened your private sign-in details.", "Private Zugangsdaten geöffnet."),
  folder: () => t("Opened the data folder.", "Datenordner geöffnet."),
  open: () => t("Workspace opened.", "Workspace geöffnet."),
  users: () => t("User administration opened.", "Benutzerverwaltung geöffnet."),
};
async function action(command, input, context = "services") {
  if (busy) return;
  busy = true;
  currentContext = context;
  setControls();
  message(context, "");
  logs.set(context, "");
  text(outputs.get(context).querySelector("[data-log]"), "");
  let state = window.localProgress.begin(command);
  states.set(context, state);
  renderProgress(context, state);
  try {
    const result = await window.kernLocal.action(command, {
      ...input,
      locale: language,
    });
    state = window.localProgress.apply(states.get(context), {
      done: true,
      detail: "",
    });
    states.set(context, state);
    renderProgress(context, state);
    message(context, success[command]?.() ?? result.message);
    if (
      [
        "start",
        "stop",
        "status",
        "update",
        "docker:setup",
        "doctor",
        "network:save",
      ].includes(command)
    )
      await refresh(command === "network:save");
    if (command === "status") {
      $("#service-details").open = true;
      outputs.get(context).querySelector(".operation").hidden = true;
    }
  } catch (error) {
    const value = String(error.message).replace(
      /^Error invoking remote method '[^']+': (?:Error: )?/,
      "",
    );
    state = window.localProgress.apply(states.get(context), {
      done: true,
      failed: true,
      detail: value,
    });
    states.set(context, state);
    renderProgress(context, state);
    message(context, value, true);
    outputs.get(context).querySelector(".operation-log").open = true;
  } finally {
    busy = false;
    currentContext = null;
    setControls();
  }
}
for (const button of document.querySelectorAll("[data-action]"))
  button.addEventListener("click", () =>
    action(
      button.dataset.action,
      undefined,
      button.closest("[data-context]")?.dataset.context ?? "services",
    ),
  );
$("#language").addEventListener("change", (e) => {
  language = e.target.value === "de" ? "de" : "en";
  localStorage.setItem("kerncloud-desktop-language", language);
  translate();
});
$("#autostart").addEventListener("change", (e) =>
  action(
    e.target.checked ? "autostart:on" : "autostart:off",
    undefined,
    "maintenance",
  ),
);
$("#exposure").addEventListener("change", (e) => {
  $("#hostname-row").hidden = e.target.value !== "lan";
});
$("#network-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const exposure = $("#exposure").value;
  if (
    exposure === "lan" &&
    !confirm(
      t(
        "Allow access from your local network? Use trusted networks and HTTPS for sensitive data.",
        "KeRnCloud im lokalen Netzwerk freigeben? Nutze vertrauenswürdige Netze und HTTPS für vertrauliche Daten.",
      ),
    )
  )
    return;
  action(
    "network:save",
    {
      port: $("#port").value,
      gatewayPort: $("#gateway-port").value,
      exposure,
      hostname: $("#hostname").value,
    },
    "network",
  );
});
setInterval(() => {
  for (const [context, state] of states)
    if (!state.finishedAt) renderProgress(context, state);
}, 1000);
setInterval(() => {
  if (!busy) void refresh().catch(() => {});
}, 15000);
translate();
setControls();
refresh(true)
  .then(() => {
    if (!info.docker.running) $("#setup-details").open = true;
  })
  .catch((e) => message("services", e.message, true));
window.kernLocal.ready?.();

$("#connection-mode").addEventListener("change", (e) => {
  $("#server-address-row").hidden = e.target.value !== "remote";
});
$("#connection-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (busy) return;
  const next = {
    mode: $("#connection-mode").value,
    url: $("#server-address").value,
  };
  busy = true;
  setControls();
  text(
    $("#connection-message"),
    t("Saving connection…", "Verbindung wird gespeichert…"),
  );
  try {
    // Settle the previous mode's status read before replacing its connection.
    // Otherwise its late reply can overwrite the newly selected address.
    if (refreshing) await refreshing.catch(() => {});
    await window.kernLocal.action("connection:save", next);
    await refresh(true);
    text(
      $("#connection-message"),
      t(
        "Connection saved. Your local installation is preserved.",
        "Verbindung gespeichert. Deine lokale Installation bleibt erhalten.",
      ),
    );
  } catch (error) {
    text($("#connection-message"), error.message);
  } finally {
    busy = false;
    setControls();
  }
});
