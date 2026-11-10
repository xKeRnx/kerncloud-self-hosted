'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const {EventEmitter} = require('node:events');
const {APP_ID, REPOSITORY, FEED, verifyManifest, fetchManifest, checkArtifact, installationFormat, DesktopUpdates} = require('../updates.cjs');
const keys = crypto.generateKeyPairSync('ed25519');
const trust = {keys: [{id: 'fixture', publicKey: keys.publicKey.export({type: 'spki', format: 'pem'})}]};
const now = Date.now(), bytes = Buffer.from('Synthetic installer fixture; never executable.');
function payload(version = '1.1.0') {
  const name = `KeRnCloud-${version}-win-x64.exe`;
  return {schema: 1, appId: APP_ID, channel: 'stable', version, issuedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 60000).toISOString(), files: [{platform: 'win32', arch: 'x64', format: 'exe', name, url: REPOSITORY + '/releases/download/v' + version + '/' + name, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), sha512: crypto.createHash('sha512').update(bytes).digest('base64')}]};
}
function sign(p) {const text = JSON.stringify(p); return {keyId: 'fixture', payload: text, signature: crypto.sign(null, Buffer.from(text), keys.privateKey).toString('base64')};}
function response(envelope) {return new Response(JSON.stringify(envelope));}
test('signed manifests reject tampering, wrong identity, stale releases, rollback and foreign URLs', () => {
  const p = payload(), valid = sign(p);
  assert.equal(verifyManifest(valid, trust, {now, minimum: '1.0.0'}).version, '1.1.0');
  assert.throws(() => verifyManifest({...valid, payload: valid.payload.replace('1.1.0', '9.9.9')}, trust));
  assert.throws(() => verifyManifest({...valid, keyId: 'unknown'}, trust));
  for (const change of [p => p.appId = 'another.app', p => p.expiresAt = new Date(now - 1).toISOString(), p => p.expiresAt = p.issuedAt,
    p => p.files[0].url = 'https://attacker.invalid/installer.exe', p => p.files.push(p.files[0]), p => p.files[0].bytes = 2 ** 31]) {
    const changed = payload(); change(changed); assert.throws(() => verifyManifest(sign(changed), trust, {now}));
  }
  assert.throws(() => verifyManifest(valid, trust, {now, minimum: '1.2.0'}));
});
test('feed requests contain no credentials and reject unsafe redirects / oversized responses', async () => {
  let requests = 0;
  await fetchManifest(async (url, options) => {
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'manual'); requests++;
    if (requests === 1) {assert.equal(url, FEED); return new Response(null, {status: 302, headers: {location: 'https://release-assets.githubusercontent.com/fixture'}});}
    return response(sign(payload()));
  });
  assert.equal(requests, 2);
  for (const url of ['http://github.com/file', 'https://attacker.invalid/file', 'https://github.com:444/file', 'https://user:pass@github.com/file'])
    await assert.rejects(fetchManifest(async () => new Response(null, {status: 302, headers: {location: url}})));
  await assert.rejects(fetchManifest(async () => new Response('x'.repeat(130 * 1024))));
});
test('only installed target formats support automatic replacement', () => {
  assert.equal(installationFormat({platform: 'win32', executable: 'C:/fixture/KeRnCloud.exe', exists: () => false}), null);
  assert.equal(installationFormat({platform: 'win32', executable: 'C:/fixture/KeRnCloud.exe', exists: p => p.endsWith('Uninstall KeRnCloud.exe')}), 'exe');
  assert.equal(installationFormat({platform: 'linux', executable: '/opt/KeRnCloud/kerncloud-desktop', appImage: ''}), 'deb');
  assert.equal(installationFormat({platform: 'linux', executable: '/tmp/.mount/KeRnCloud', appImage: '/home/fixture/KeRnCloud.AppImage', exists: () => true}), 'AppImage');
});
async function fixture(t, extra = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kerncloud-updater-test-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  const file = path.join(directory, 'download.exe'); await fs.writeFile(file, bytes);
  const preserved = path.join(directory, 'runtime'); await fs.mkdir(preserved);
  await fs.writeFile(path.join(preserved, '.env'), 'ENCRYPTION_KEY=synthetic-persisted-key\n');
  await fs.writeFile(path.join(preserved, 'grants.fixture.json'), '["fixture-project:read"]');
  let installs = 0, downloads = 0, busy = false, fetched = 0, clock = now;
  let envelope = sign(payload());
  const native = new EventEmitter();
  native.checkForUpdates = async () => ({updateInfo: {version: JSON.parse(envelope.payload).version}});
  native.downloadUpdate = async () => {downloads++; return [file];};
  native.quitAndInstall = () => installs++;
  const options = {app: {getPath: () => directory, getVersion: () => '1.0.0'}, trust, platform: 'win32', arch: 'x64', format: 'exe', now: () => clock,
    fetcher: async () => {fetched++; return response(envelope);}, createNative: () => native, isBusy: () => busy, ...extra};
  const manager = new DesktopUpdates(options); await manager.init();
  return {manager, options, directory, file, native, setBusy: v => busy = v, setEnvelope: v => envelope = v, tick: () => clock += 60001,
    counters: () => ({installs, downloads, fetched}), async checkPreserved() {
      assert.equal(await fs.readFile(path.join(preserved, '.env'), 'utf8'), 'ENCRYPTION_KEY=synthetic-persisted-key\n');
      assert.equal(await fs.readFile(path.join(preserved, 'grants.fixture.json'), 'utf8'), '["fixture-project:read"]');
    }};
}
test('automatic checks coalesce; download never restarts an active session; preferences and data survive', async t => {
  const f = await fixture(t), {manager: u} = f;
  await Promise.all([u.check(), u.check()]);
  assert.equal(u.snapshot().phase, 'ready'); assert.deepEqual(f.counters(), {installs: 0, downloads: 1, fetched: 1});
  f.setBusy(true); await assert.rejects(u.install()); assert.equal(u.snapshot().canInstall, false);
  f.setBusy(false); await u.install(); assert.equal(f.counters().installs, 1);
  await f.checkPreserved();
  const reopened = new DesktopUpdates(f.options); await reopened.init();
  await reopened.check({startup: true}); assert.equal(f.counters().installs, 2);
  await f.checkPreserved();
});
test('changed manifests or cached bytes never execute; errors leave configuration and grants intact', async t => {
  const f = await fixture(t); await f.manager.check();
  f.setEnvelope(sign(payload('1.2.0'))); await assert.rejects(f.manager.install()); assert.equal(f.counters().installs, 0);
  f.setEnvelope(sign(payload())); f.tick(); await f.manager.check();
  await fs.writeFile(f.file, Buffer.from('tampered')); await assert.rejects(f.manager.install());
  assert.equal(f.counters().installs, 0); await f.checkPreserved();
  await assert.rejects(checkArtifact(f.file, payload().files[0]));
});
test('automatic setting persists, manual checking remains available, current versions do not download', async t => {
  const f = await fixture(t); await f.manager.automatic(false); await f.manager.check(); assert.equal(f.counters().fetched, 0);
  const reopened = new DesktopUpdates(f.options); await reopened.init(); assert.equal(reopened.snapshot().automatic, false);
  await reopened.check({manual: true}); assert.equal(reopened.snapshot().phase, 'ready'); assert.equal(f.counters().installs, 0);
  const current = await fixture(t, {app: {...f.options.app, getVersion: () => '1.1.0'}});
  await current.manager.automatic(true);
  await current.manager.check(); assert.equal(current.manager.snapshot().phase, 'current'); assert.equal(current.counters().downloads, 0);
});
test('Linux updates require an explicit install even on subsequent startup', async t => {
  const f = await fixture(t, {platform: 'linux', format: 'deb'}), p = payload();
  p.files[0].platform = 'linux'; p.files[0].format = 'deb'; p.files[0].name = 'KeRnCloud-1.1.0-linux-amd64.deb';
  p.files[0].url = REPOSITORY + '/releases/download/v1.1.0/' + p.files[0].name;
  f.setEnvelope(sign(p)); await f.manager.check();
  const reopened = new DesktopUpdates(f.options); await reopened.init(); await reopened.check({startup: true});
  assert.equal(reopened.snapshot().phase, 'ready'); assert.equal(f.counters().installs, 0);
});
test('installation acquires its gate before asynchronous verification', async t => {
  let release; const blocker = new Promise(resolve => release = resolve);
  const f = await fixture(t, {beforeInstall: () => blocker}); await f.manager.check();
  const installing = f.manager.install(); assert.equal(f.manager.installing, true);
  await assert.rejects(f.manager.install()); release(); await installing; assert.equal(f.counters().installs, 1);
});
