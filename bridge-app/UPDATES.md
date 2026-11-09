# Operator guide: Bridge updates

Bridge 0.1.5 adds authenticated native updates. Versions before 0.1.5 need the
installer once; they cannot discover a feature they do not contain. Application
identity, userData path, safeStorage data, local permissions and action journal
must remain unchanged across every release. Never uninstall before updating.

The pinned production dependency is electron-updater 6.8.11. A custom provider
passes only verified metadata to it; it never parses a second unsigned feed.
Updates come from the address bundled in server.json, not from enrollment keys,
agent instructions or a separately connected workspace server. No device token,
session cookie or provider credential is sent to the public update service.

The public update-trust.json contains Ed25519 verification keys. The release
private key is held outside Bridge source, initially in the restricted operator
directory .bridge-update-keys at the repository root. Back up that key securely,
or put it in your CI secret store and set BRIDGE_UPDATE_PRIVATE_KEY to its path.
It is separate from Windows Authenticode, Apple Developer ID and APT signing.
Do not regenerate it casually. For rotation first ship a transition release that
trusts both public keys, then change the signing key. Remove the old public key
only after installations have migrated. Never ship private keys in app packages,
Docker images, web assets or source control.

Build steps:

1. Set the real public BRIDGE_DEFAULT_ORIGIN, increment package version, keep
   stable app name / bundle ID and user-data location, and run npm ci in bridge-app.
2. Run prepare-updates.cjs before packaging. Install only production dependencies
   in the packaged app. Fresh package builders prune development dependencies.
3. Build and verify native packages. Signed Windows builds also embed the expected
   publisher for the library's Authenticode verification. macOS candidates need
   Developer ID signing, notarization and a ZIP of the final stapled app. The signed
   macOS builder creates that ZIP alongside the DMG. Unsigned macOS archives are
   never eligible for unattended native installation.
4. After artifacts are verified and listed in releases/manifest.json, run
   `node scripts/publish-updates.cjs` with BRIDGE_UPDATE_PRIVATE_KEY set. This
   validates artifact sizes and hashes before atomically signing releases/updates.json.
   Verified signed build reports can be adopted with `--release-report PATH`;
   existing immutable artifact names are never overwritten with different bytes.
5. Deploy the app, artifacts and signed feed together. The public endpoint is
   /api/public/bridge/updates. Renew the feed when releasing, or at least monthly:
   signatures expire after 90 days. Expired/malformed feeds never execute code.

The client rejects unknown keys, altered manifests, expired feeds, cross-origin
download destinations, mismatched hashes and versions below its highest observed
release. Cached downloads are verified again and checked against a fresh signed
feed immediately before installation. Updates are serialized, full downloads are
bounded by the signed artifact metadata, and failed downloads do not replace the app.

Windows: only installed per-user NSIS copies update automatically. Setup preserves
its original install folder and shortcut/startup choices. Its update mode waits
for the old app to exit, never kills it, and relaunches only when requested.
Background download is automatic. Installation happens explicitly, or at a later
safe launch after a previous download; never during OS shutdown. The app must be
paused and have no in-flight action. Local profile data is not in the installer.

Linux: installed Debian/Ubuntu packages can download automatically. Installation
requires an explicit local action and OS authorization when unprivileged. Only
dpkg via pkexec is used, without shell strings, global apt repair, unauthenticated
repositories, downgrade flags or permission bypass. Portable ZIPs use the installer.

macOS: native Squirrel.Mac updates are enabled only for a signed installed app and
only consume signed/notarized ZIPs. Preserve Developer ID identity across updates.
Runtime/notarization verification still requires macOS and operator credentials.
Portable / unsigned copies can be replaced with the appropriate installer.

No updater can repair a corrupted OS or guarantee success after disk failure.
Preserve previous installers for recovery. Failed or canceled installation must
not delete userData or widen local/cloud permissions. After restart Bridge stays
paused and does not replay uncertain external effects.
