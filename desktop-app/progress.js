"use strict";
(function () {
  const steps = ["docker", "prepare", "build", "services", "health"];
  const labels = {
    docker: ["Checking Docker", "Docker wird geprüft"],
    prepare: ["Preparing local services", "Lokale Dienste werden vorbereitet"],
    build: ["Preparing the server image", "Server-Image wird vorbereitet"],
    services: ["Starting local services", "Lokale Dienste werden gestartet"],
    health: [
      "Waiting for the workspace to be ready",
      "Bereitschaft des Workspaces wird geprüft",
    ],
    backup: ["Creating a backup", "Backup wird erstellt"],
    "update-check": [
      "Checking whether an update can start",
      "Update-Voraussetzungen werden geprüft",
    ],
    stopping: ["Stopping local services", "Lokale Dienste werden gestoppt"],
    status: ["Reading service status", "Dienststatus wird geladen"],
    setup: ["Preparing Docker", "Docker wird vorbereitet"],
    working: ["Applying your change", "Änderung wird angewendet"],
    ready: ["Your workspace is ready", "Dein Workspace ist bereit"],
    done: ["Completed", "Abgeschlossen"],
    failed: [
      "Action could not be completed",
      "Aktion konnte nicht abgeschlossen werden",
    ],
  };
  function begin(command, now = Date.now()) {
    return {
      command,
      phase:
        command === "start"
          ? "docker"
          : command === "stop"
            ? "stopping"
            : command === "status"
              ? "status"
              : command === "docker:setup"
                ? "setup"
                : command === "backup"
                  ? "backup"
                  : command === "update"
                    ? "update-check"
                    : "working",
      startedAt: now,
      lastActivityAt: now,
      finishedAt: null,
      detail: "",
      failed: false,
      completed: [],
    };
  }
  function apply(state, event, now = Date.now()) {
    if (!state || state.finishedAt) return state;
    const next = { ...state, lastActivityAt: now };
    if (event.phase && Object.hasOwn(labels, event.phase)) {
      if (state.phase !== event.phase && steps.includes(state.phase))
        next.completed = [...new Set([...state.completed, state.phase])];
      next.phase = event.phase;
    }
    if (event.detail !== undefined)
      next.detail = String(event.detail).slice(-500);
    if (event.reusedImages) next.reusedImages = true;
    if (event.done) {
      next.finishedAt = now;
      next.failed = !!event.failed;
      next.failedPhase = state.phase;
      next.phase = event.failed
        ? "failed"
        : state.command === "start"
          ? "ready"
          : "done";
      if (!event.failed && state.command === "start")
        next.completed = [...steps];
    }
    return next;
  }
  function view(state, language = "en", now = Date.now()) {
    const de = language === "de",
      elapsed = Math.max(
        0,
        Math.floor(((state.finishedAt ?? now) - state.startedAt) / 1000),
      );
    const quiet = !state.finishedAt && now - state.lastActivityAt >= 30000;
    return {
      heading:
        state.phase === "build" && state.reusedImages
          ? de
            ? "Vorhandene Server-Images werden verwendet"
            : "Using existing server images"
          : (labels[state.phase]?.[de ? 1 : 0] ?? labels.working[de ? 1 : 0]),
      elapsed:
        Math.floor(elapsed / 60) + ":" + String(elapsed % 60).padStart(2, "0"),
      quiet,
      note: quiet
        ? de
          ? "Dieser Schritt läuft noch. Seit 30 Sekunden gibt es keine neue Ausgabe. Details zeigen das bisherige Protokoll."
          : "This step is still running. No new output in the last 30 seconds. Open details to see the log."
        : !state.finishedAt && state.phase === "build"
          ? de
            ? "Downloads und der erste Serveraufbau können mehrere Minuten dauern."
            : "Downloads and the first server build can take several minutes."
          : "",
      steps:
        state.command === "start"
          ? steps.map((phase) => ({
              phase,
              label: labels[phase][de ? 1 : 0],
              state: state.completed.includes(phase)
                ? "complete"
                : phase === state.phase && !state.finishedAt
                  ? "active"
                  : phase === state.failedPhase && state.failed
                    ? "failed"
                    : "pending",
            }))
          : [],
    };
  }
  function serviceSummary(services, ready) {
    if (!Array.isArray(services)) return "unknown";
    if (
      !services.length ||
      services.every((s) =>
        ["exited", "created", "dead", "removing"].includes(s.state),
      )
    )
      return "stopped";
    if (
      services.some(
        (s) =>
          s.health === "unhealthy" ||
          ["restarting", "dead", "exited", "paused"].includes(s.state),
      )
    )
      return "attention";
    return ready ? "running" : "starting";
  }
  const api = { begin, apply, view, serviceSummary };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.localProgress = api;
})();
