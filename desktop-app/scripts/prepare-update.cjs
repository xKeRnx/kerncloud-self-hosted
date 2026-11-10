'use strict';
// The private release key stays outside the checkout and is supplied by the owner.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const {APP_ID, REPOSITORY, verifyManifest} = require('../updates.cjs');
const {version} = require('../package.json');
const directory = path.resolve(process.argv[2] ?? 'dist');
const output = path.resolve(process.argv[3] ?? path.join(directory, 'desktop-update.json'));
if (!process.env.KERNCLOUD_DESKTOP_UPDATE_KEY) throw Error('Set KERNCLOUD_DESKTOP_UPDATE_KEY to the private release-key file outside the checkout');
const key = crypto.createPrivateKey(fs.readFileSync(process.env.KERNCLOUD_DESKTOP_UPDATE_KEY));
const trust = require('../update-trust.json');
const publicKey = crypto.createPublicKey(key).export({type: 'spki', format: 'pem'});
const trusted = trust.keys.find(k => k.publicKey === publicKey);
if (!trusted) throw Error('Private key does not match a bundled desktop verification key');
const files = [];
for (const name of fs.readdirSync(directory).sort()) {
  if (!name.startsWith('KeRnCloud-' + version + '-')) continue;
  let platform, arch, format;
  const match = name.match(/-(win|linux|mac)-(x64|arm64|amd64|x86_64)\.(exe|deb|AppImage|zip)$/);
  if (!match) continue;
  platform = {win: 'win32', linux: 'linux', mac: 'darwin'}[match[1]];
  arch = ['amd64', 'x86_64'].includes(match[2]) ? 'x64' : match[2]; format = match[3];
  // macOS is published only from a signed/notarized release build, never from a local unsigned ZIP.
  if (platform === 'darwin' && process.env.KERNCLOUD_MAC_RELEASE_VERIFIED !== 'true') continue;
  const file = path.join(directory, name), stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Release artifact must be a regular file');
  const bytes = fs.readFileSync(file);
  files.push({platform, arch, format, name, url: REPOSITORY + '/releases/download/v' + version + '/' + name,
    bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), sha512: crypto.createHash('sha512').update(bytes).digest('base64'),
    ...(platform === 'darwin' ? {signed: true, notarized: true} : {})});
}
const now = Date.now(), payload = JSON.stringify({schema: 1, appId: APP_ID, channel: 'stable', version,
  issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 90 * 86400000).toISOString(), files});
const envelope = {keyId: trusted.id, payload, signature: crypto.sign(null, Buffer.from(payload), key).toString('base64')};
verifyManifest(envelope, trust);
fs.writeFileSync(output, JSON.stringify(envelope, null, 2) + '\n');
console.log(JSON.stringify({version, artifacts: files.length, manifest: path.basename(output)}));
