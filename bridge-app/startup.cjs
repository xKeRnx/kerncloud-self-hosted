'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const marker = 'X-KeRnCloud-Managed=true';
function desktopExec(executable) {
  if (!path.isAbsolute(executable) || /[\r\n\0]/.test(executable)) throw Error('Ungültiger Programmpfad.');
  return '"' + executable.replace(/%/g, '%%').replace(/[\\"`$]/g, '\\$&') + '"';
}
function desktopEntry(executable, startup = false) {
  return '[Desktop Entry]\nType=Application\nName=KeRnCloud Bridge\nComment=Dein Rechner. Deine Freigaben.\nExec=' + desktopExec(executable) + (startup ? ' --autostart' : '') + '\nIcon=kerncloud-bridge\nTerminal=false\nCategories=Utility;Network;\n' + marker + '\n';
}
function createStartup({ app, shell, platform = process.platform, executable = process.execPath, env = process.env, home = os.homedir() }) {
  const config = env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : path.join(home, '.config');
  const linuxFile = path.join(config, 'autostart', 'kerncloud-bridge.desktop');
  const login = { path: executable, args: ['--autostart'] };
  async function ownedFile(filename) {
    try { const s = await fs.lstat(filename); if (!s.isFile() || s.isSymbolicLink()) throw Error('Vorhandener Eintrag ist keine verwaltete Datei.'); const content = await fs.readFile(filename, 'utf8'); if (!content.split(/\r?\n/).includes(marker)) throw Error('Vorhandenen fremden Eintrag bitte selbst prüfen.'); return true; }
    catch (e) { if (e.code === 'ENOENT') return false; throw e; }
  }
  async function get() {
    if (platform === 'darwin') return { supported: false, enabled: false, desktopSupported: false, note: 'macOS: Autostart in Systemeinstellungen > Allgemein > Anmeldeobjekte verwalten.' };
    if (platform === 'win32') return { supported: true, enabled: app.getLoginItemSettings(login).openAtLogin, desktopSupported: true, note: 'Autostart öffnet die App nach der Anmeldung. Die Bridge bleibt dabei pausiert.' };
    if (platform === 'linux') return { supported: true, enabled: await ownedFile(linuxFile), desktopSupported: true, note: 'Autostart gilt nur für deinen Benutzer in einer grafischen Sitzung. Die Bridge bleibt dabei pausiert.' };
    return { supported: false, enabled: false, desktopSupported: false, note: 'Für dieses System nicht verfügbar.' };
  }
  async function set(enabled) {
    if (typeof enabled !== 'boolean') throw Error('Autostart benötigt eine eindeutige Auswahl.');
    if (platform === 'win32') app.setLoginItemSettings({ ...login, name: 'de.kerncloud.bridge', openAtLogin: enabled, enabled });
    else if (platform === 'linux') { const exists = await ownedFile(linuxFile); if (enabled) { await fs.mkdir(path.dirname(linuxFile), { recursive: true }); await fs.writeFile(linuxFile, desktopEntry(executable, true), { mode: 0o600, flag: exists ? 'w' : 'wx' }); } else if (exists) await fs.unlink(linuxFile); }
    else throw Error('Autostart bitte in den Betriebssystem-Einstellungen verwalten.');
    return get();
  }
  async function shortcut() {
    const desktop = app.getPath('desktop');
    if (platform === 'win32') {
      const file = path.join(desktop, 'KeRnCloud Bridge.lnk');
      try { await fs.lstat(file); if (shell.readShortcutLink(file).target.toLowerCase() !== executable.toLowerCase()) throw Error('Vorhandene fremde Verknüpfung wird nicht überschrieben.'); } catch(e) { if (e.code !== 'ENOENT') throw e; }
      if (!shell.writeShortcutLink(file, 'create', { target: executable, cwd: path.dirname(executable), icon: executable, iconIndex: 0, description: 'KeRnCloud Bridge', appUserModelId: 'de.kerncloud.bridge' })) throw Error('Verknüpfung konnte nicht erstellt werden.');
    } else if (platform === 'linux') {
      const file = path.join(desktop, 'kerncloud-bridge.desktop'); const exists = await ownedFile(file); await fs.mkdir(desktop, { recursive: true }); await fs.writeFile(file, desktopEntry(executable), { mode: 0o700, flag: exists ? 'w' : 'wx' });
    } else throw Error('Auf macOS die App aus Programme ins Dock ziehen.');
    return { ok: true, message: 'Desktop-Verknüpfung erstellt. Linux kann zusätzlich eine Bestätigung zum Starten verlangen.' };
  }
  return { get, set, shortcut };
}
module.exports = { createStartup, desktopEntry, desktopExec };
