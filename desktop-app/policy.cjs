"use strict";
const allowedCommands = new Set([
  "doctor",
  "start",
  "stop",
  "status",
  "backup",
  "update",
]);
function allowedNavigation(target, origin) {
  try {
    return new URL(target).origin === origin;
  } catch {
    return false;
  }
}
function allowedWorkspacePopup(target, origin, gateway) {
  if (target === "about:blank") return true;
  try {
    const u = new URL(target);
    if (u.username || u.password) return false;
    if (u.origin === origin) return true;
    if (!gateway) return false;
    const base = new URL(gateway),
      prefix = u.hostname.slice(0, -(base.hostname.length + 1));
    return (
      ["http:", "https:"].includes(u.protocol) &&
      u.protocol === base.protocol &&
      u.port === base.port &&
      u.hostname.endsWith("." + base.hostname) &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        prefix,
      )
    );
  } catch {
    return false;
  }
}
function redact(text, env) {
  for (const [key, value] of Object.entries(env))
    if (/PASSWORD|TOKEN|KEY|SECRET/.test(key) && value)
      text = text.split(value).join("[redacted]");
  return text;
}
function loginAutostart(app, platform) {
  return platform === "win32" || platform === "darwin"
    ? app.getLoginItemSettings().openAtLogin
    : false;
}
module.exports = {
  allowedCommands,
  allowedNavigation,
  redact,
  loginAutostart,
  allowedWorkspacePopup,
};
