'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createStartup, desktopExec } = require('../startup.cjs');
test('Linux startup is opt in, quotes executable paths and only removes its own entry', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'kcb-startup-'));
  const manager = createStartup({ app: { getPath: () => path.join(home, 'Desktop') }, shell: {}, platform: 'linux', executable: '/opt/Bridge with $name/bridge%file', home, env: {} });
  assert.equal((await manager.get()).enabled, false);
  await manager.set(true);
  const filename = path.join(home, '.config/autostart/kerncloud-bridge.desktop');
  assert.match(await fs.readFile(filename, 'utf8'), /Exec="\/opt\/Bridge with \\\$name\/bridge%%file" --autostart/);
  assert.equal((await manager.get()).enabled, true);
  await manager.shortcut();
  assert.ok((await fs.readFile(path.join(home, 'Desktop/kerncloud-bridge.desktop'), 'utf8')).includes('X-KeRnCloud-Managed=true'));
  await manager.set(false);
  assert.equal((await manager.get()).enabled, false);
  await fs.writeFile(filename, '[Desktop Entry]\nName=Someone else\n');
  await assert.rejects(() => manager.set(true), /fremden/);
  await assert.rejects(() => manager.set(false), /fremden/);
  assert.match(await fs.readFile(filename, 'utf8'), /Someone else/);
});
test('Startup integration refuses symlinks, invalid toggle values and desktop Exec injection', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'kcb-startup-deny-'));
  const manager = createStartup({ app: { getPath: () => home }, shell: {}, platform: 'linux', executable: '/opt/bridge', home, env: {} });
  await assert.rejects(() => manager.set('true'), /Auswahl/);
  assert.throws(() => desktopExec('/opt/name\nExec=evil'), /Programmpfad/);
  const target = path.join(home, 'keep.txt'); await fs.writeFile(target, 'unchanged');
  const file = path.join(home, '.config/autostart/kerncloud-bridge.desktop'); await fs.mkdir(path.dirname(file), { recursive: true });
  if (process.platform !== 'win32') { await fs.symlink(target, file); await assert.rejects(() => manager.set(true), /verwaltete/); assert.equal(await fs.readFile(target, 'utf8'), 'unchanged'); }
});
test('Windows login item uses the installer registry identity and only fixed arguments', async () => {
  let saved; const manager = createStartup({ platform: 'win32', executable: 'C:\\Bridge\\bridge.exe', app: { getLoginItemSettings: options => ({ openAtLogin: !!saved?.openAtLogin }), setLoginItemSettings: value => { saved = value; } }, shell: {} });
  assert.equal((await manager.get()).enabled, false); await manager.set(true);
  assert.equal(saved.name, 'de.kerncloud.bridge'); assert.deepEqual(saved.args, ['--autostart']); assert.equal(saved.openAtLogin, true);
  await manager.set(false); assert.equal(saved.openAtLogin, false);
});
