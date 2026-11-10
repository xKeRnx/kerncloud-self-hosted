'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const APP_ID = 'com.kern-ws.kerncloud.desktop';
const REPOSITORY = 'https://github.com/xKeRnx/kerncloud-self-hosted';
const FEED = REPOSITORY + '/releases/latest/download/desktop-update.json';
const MAX_FEED = 128 * 1024;

function compare(a, b) {
  const parse = value => {
    if (typeof value !== 'string' || !/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(value)) throw Error('Invalid version');
    return value.split('.').map(Number);
  };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return Math.sign(x[i] - y[i]);
  return 0;
}
function verifyManifest(envelope, trust, {now = Date.now(), minimum = '0.0.0'} = {}) {
  if (!envelope || typeof envelope.payload !== 'string' || Buffer.byteLength(envelope.payload) > MAX_FEED ||
      typeof envelope.signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature)) throw Error('Invalid update envelope');
  const key = trust.keys?.find(k => k.id === envelope.keyId);
  if (!key || !crypto.verify(null, Buffer.from(envelope.payload), key.publicKey, Buffer.from(envelope.signature, 'base64'))) throw Error('Update signature rejected');
  const p = JSON.parse(envelope.payload), issued = Date.parse(p.issuedAt), expires = Date.parse(p.expiresAt);
  if (p.schema !== 1 || p.appId !== APP_ID || p.channel !== 'stable' || !Array.isArray(p.files) || !p.files.length || p.files.length > 12 ||
      !Number.isFinite(issued) || !Number.isFinite(expires) || issued > now + 300000 || expires <= now || expires <= issued ||
      expires - issued > 93 * 86400000 || compare(p.version, minimum) < 0) throw Error('Invalid, expired or superseded update manifest');
  const seen = new Set();
  for (const f of p.files) {
    const formats = {win32: ['exe'], linux: ['deb', 'AppImage'], darwin: ['zip']};
    if (!formats[f.platform]?.includes(f.format) || !['x64', 'arm64'].includes(f.arch) ||
        typeof f.name !== 'string' || !/^KeRnCloud-[A-Za-z0-9._-]+$/.test(f.name) ||
        !f.name.startsWith('KeRnCloud-' + p.version + '-') || !f.name.endsWith('.' + f.format) ||
        f.url !== REPOSITORY + '/releases/download/v' + p.version + '/' + f.name ||
        !Number.isSafeInteger(f.bytes) || f.bytes < 1 || f.bytes > 1024 ** 3 ||
        !/^[a-f0-9]{64}$/.test(f.sha256) || !/^[A-Za-z0-9+/]{86}==$/.test(f.sha512) ||
        seen.has(f.platform + '/' + f.arch + '/' + f.format)) throw Error('Invalid update artifact');
    if (f.platform === 'darwin' && (f.signed !== true || f.notarized !== true)) throw Error('macOS updates require signing and notarization');
    seen.add(f.platform + '/' + f.arch + '/' + f.format);
  }
  return p;
}
function trustedRedirect(url) {
  const u = new URL(url);
  return u.protocol === 'https:' && !u.username && !u.password && !u.port &&
    ['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(u.hostname);
}
async function fetchManifest(fetcher = fetch) {
  let url = FEED;
  for (let n = 0; n < 6; n++) {
    const response = await fetcher(url, {redirect: 'manual', credentials: 'omit', headers: {Accept: 'application/json'}, signal: AbortSignal.timeout(15000)});
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next = new URL(response.headers.get('location'), url).href;
      await response.body?.cancel();
      if (!trustedRedirect(next)) throw Error('Untrusted update redirect');
      url = next; continue;
    }
    if (!response.ok) throw Error('Update service unavailable');
    const chunks = []; let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > MAX_FEED) throw Error('Update manifest too large');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  throw Error('Too many update redirects');
}
async function hashFile(file, algorithm) {
  const h = crypto.createHash(algorithm);
  for await (const chunk of require('node:fs').createReadStream(file)) h.update(chunk);
  return h.digest(algorithm === 'sha512' ? 'base64' : 'hex');
}
async function checkArtifact(file, entry) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== entry.bytes ||
      await hashFile(file, 'sha256') !== entry.sha256 || await hashFile(file, 'sha512') !== entry.sha512) throw Error('Update file verification failed');
}
function installationFormat({platform = process.platform, executable = process.execPath, appImage = process.env.APPIMAGE, exists = require('node:fs').existsSync} = {}) {
  if (platform === 'win32') return exists(path.join(path.dirname(executable), 'Uninstall KeRnCloud.exe')) ? 'exe' : null;
  if (platform === 'linux') return appImage && exists(appImage) ? 'AppImage' : path.dirname(executable) === '/opt/KeRnCloud' ? 'deb' : null;
  if (platform === 'darwin') return executable.includes('.app/Contents/MacOS/') ? 'zip' : null;
  return null;
}
function nativeUpdater({app, platform, format, entry, version, issuedAt}) {
  const lib = require('electron-updater');
  const {Provider} = require('electron-updater/out/providers/Provider');
  const info = {version, releaseDate: issuedAt, files: [{url: entry.url, sha512: entry.sha512, size: entry.bytes}], isAdminRightsRequired: false};
  class VerifiedProvider extends Provider {
    constructor(_config, _updater, runtime) { super({...runtime, isUseMultipleRangeRequest: false}); }
    async getLatestVersion() { return structuredClone(info); }
    resolveFiles(update) {
      if (JSON.stringify(update.files) !== JSON.stringify(info.files)) throw Error('Update metadata changed');
      return update.files.map(f => ({url: new URL(f.url), info: f}));
    }
  }
  const Type = platform === 'win32' ? lib.NsisUpdater : platform === 'darwin' ? lib.MacUpdater : format === 'AppImage' ? lib.AppImageUpdater : lib.DebUpdater;
  const u = new Type();
  // A private signed manifest supplies all URLs and hashes. No unsigned latest.yml feed is used.
  u.updateConfigPath = path.join(app.getAppPath(), 'update-native.json');
  u.setFeedURL({provider: 'custom', updateProvider: VerifiedProvider});
  u.autoDownload = false; u.autoInstallOnAppQuit = false; u.autoRunAppAfterInstall = true;
  u.allowDowngrade = false; u.allowPrerelease = false;
  u.disableWebInstaller = true; u.disableDifferentialDownload = true;
  u.logger = {info() {}, warn() {}, error() {}, debug() {}};
  if (platform === 'win32') u.installDirectory = path.dirname(process.execPath);
  if (format === 'deb') {
    // Do not use the library's apt fallback, which adds authentication/downgrade bypass flags.
    u.doInstall = function(options) {
      if (!this.installerPath) throw Error('No verified package');
      const {spawnSync} = require('node:child_process'), root = process.getuid?.() === 0;
      const r = spawnSync(root ? '/usr/bin/dpkg' : '/usr/bin/pkexec', root ? ['-i', this.installerPath] : ['/usr/bin/dpkg', '-i', this.installerPath], {shell: false, windowsHide: true, stdio: 'ignore', timeout: 120000});
      if (r.error || r.status !== 0) throw Error('System package installation was not completed');
      if (options.isForceRunAfter) this.app.relaunch();
      return true;
    };
  }
  return u;
}
class DesktopUpdates {
  constructor({app, trust, platform = process.platform, arch = process.arch, format = installationFormat(),
    fetcher = fetch, createNative = nativeUpdater, onChange = () => {}, isBusy = () => false, beforeInstall = async () => {}, now = Date.now}) {
    this.o = {app, trust, platform, arch, format, fetcher, createNative, onChange, isBusy, beforeInstall, now};
    this.file = path.join(app.getPath('userData'), 'desktop-updates.json');
    this.preferences = {automatic: true, highestVersion: app.getVersion(), pendingVersion: null};
    this.state = {phase: 'idle', automatic: true, version: app.getVersion(), availableVersion: null, progress: 0, supported: !!format};
    this.operation = null; this.lastCheck = null; this.installing = false;
  }
  snapshot() { return {...this.state, canInstall: this.state.phase === 'ready' && !this.o.isBusy() && !this.installing}; }
  emit(phase, extra = {}) { Object.assign(this.state, {phase}, extra); this.o.onChange(this.snapshot()); }
  async init() {
    try {
      const p = JSON.parse(await fs.readFile(this.file, 'utf8'));
      compare(p.highestVersion, this.preferences.highestVersion);
      if (p.pendingVersion) compare(p.pendingVersion, '0.0.0');
      this.preferences = {automatic: p.automatic !== false, highestVersion: compare(p.highestVersion, this.preferences.highestVersion) > 0 ? p.highestVersion : this.preferences.highestVersion, pendingVersion: p.pendingVersion ?? null};
    } catch (e) { if (e.code !== 'ENOENT') { this.preferences.automatic = false; this.state.phase = 'preferences-error'; } }
    this.initialPending = this.preferences.pendingVersion;
    this.state.automatic = this.preferences.automatic;
    return this.snapshot();
  }
  async save() {
    const value = JSON.stringify(this.preferences);
    this.saving = (this.saving ?? Promise.resolve()).catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(this.file), {recursive: true, mode: 0o700});
      await fs.writeFile(this.file + '.tmp', value, {mode: 0o600});
      await fs.rename(this.file + '.tmp', this.file);
    });
    await this.saving;
  }
  async automatic(enabled) {
    if (typeof enabled !== 'boolean') throw Error('Invalid update preference');
    if (this.installing) throw Error('Installation is already starting');
    this.preferences.automatic = enabled; this.state.automatic = enabled;
    if (!enabled) this.token?.cancel();
    await this.save(); this.o.onChange(this.snapshot()); return this.snapshot();
  }
  check({manual = false, startup = false} = {}) {
    if (this.operation) return this.operation;
    if (this.installing || (!manual && !this.preferences.automatic) || (this.lastCheck !== null && this.o.now() - this.lastCheck < 60000)) return Promise.resolve(this.snapshot());
    this.lastCheck = this.o.now();
    this.operation = this.perform({manual, startup}).finally(() => {this.operation = null;});
    return this.operation;
  }
  async perform({manual, startup}) {
    try {
      this.emit('checking');
      const payload = verifyManifest(await fetchManifest(this.o.fetcher), this.o.trust, {now: this.o.now(), minimum: this.preferences.highestVersion});
      if (!manual && !this.preferences.automatic) {this.emit('idle'); return this.snapshot();}
      const entry = payload.files.find(f => f.platform === this.o.platform && f.arch === this.o.arch && f.format === this.o.format);
      this.preferences.highestVersion = payload.version;
      if (compare(payload.version, this.o.app.getVersion()) <= 0) {
        this.preferences.pendingVersion = null; await this.save(); this.emit('current', {availableVersion: null}); return this.snapshot();
      }
      await this.save();
      if (!entry) {this.emit('unavailable', {availableVersion: payload.version}); return this.snapshot();}
      this.entry = entry;
      this.native = this.o.createNative({...this.o, entry, version: payload.version, issuedAt: payload.issuedAt});
      this.native.on('error', () => {this.installing = false; this.emit('error');});
      this.native.on('download-progress', p => {
        if (p.transferred > entry.bytes) this.token?.cancel();
        this.emit('downloading', {progress: Math.max(0, Math.min(100, Number(p.percent) || 0))});
      });
      const checked = await this.native.checkForUpdates();
      if (!checked || checked.updateInfo.version !== payload.version) throw Error('Native update metadata mismatch');
      const {CancellationToken} = require('builder-util-runtime'); this.token = new CancellationToken();
      this.emit('downloading', {availableVersion: payload.version, progress: 0});
      const timeout = setTimeout(() => this.token.cancel(), 15 * 60000);
      let files; try {files = await this.native.downloadUpdate(this.token);} finally {clearTimeout(timeout);}
      if (!files?.[0]) throw Error('No update downloaded');
      await checkArtifact(files[0], entry); this.download = files[0];
      this.preferences.pendingVersion = payload.version; await this.save();
      this.emit('ready', {progress: 100});
      // Never restart an open session unexpectedly; only a previously downloaded
      // update may install on a subsequent launch. Linux elevation stays explicit.
      if (startup && this.initialPending === payload.version && this.preferences.automatic && this.o.platform !== 'linux' && !this.o.isBusy()) await this.install();
      return this.snapshot();
    } catch {this.installing = false; this.emit('error'); return this.snapshot();}
  }
  async install() {
    if (this.installing || this.state.phase !== 'ready' || this.o.isBusy()) throw Error('Wait for the current local operation to finish before updating');
    // Acquire the gate before awaiting network/disk checks, preventing a new
    // start/update/backup from racing the installer.
    this.installing = true; this.emit('verifying');
    try {
      const fresh = verifyManifest(await fetchManifest(this.o.fetcher), this.o.trust, {now: this.o.now(), minimum: this.preferences.highestVersion});
      if (fresh.version !== this.preferences.pendingVersion || !fresh.files.some(f => JSON.stringify(f) === JSON.stringify(this.entry))) throw Error('Release changed; check for updates again');
      await checkArtifact(this.download, this.entry);
      if (this.o.isBusy()) throw Error('A local operation is running');
      await this.o.beforeInstall();
      this.emit('installing'); this.native.quitAndInstall(true, true);
      return this.snapshot();
    } catch (e) {this.installing = false; this.emit('error'); throw e;}
  }
  start() {
    this.startTimer = setTimeout(() => void this.check({startup: true}), 15000);
    this.timer = setInterval(() => void this.check(), 6 * 3600000);
    this.startTimer.unref?.(); this.timer.unref?.();
  }
  stop() {clearTimeout(this.startTimer); clearInterval(this.timer); this.token?.cancel();}
}
module.exports = {APP_ID, REPOSITORY, FEED, compare, verifyManifest, trustedRedirect, fetchManifest, hashFile, checkArtifact, installationFormat, nativeUpdater, DesktopUpdates};
