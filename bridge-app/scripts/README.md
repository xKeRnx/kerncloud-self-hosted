# Bridge release builds

The native runtime stays Electron 45.0.0. Windows uses an NSIS per-user setup; Debian/Ubuntu uses a `.deb`. ZIPs remain an optional portable distribution. macOS DMGs require a native Mac build.

## Prepare guides

Maintain README.de.md and README.en.md. Generate customer PDFs before packaging:

    python -m pip install reportlab
    python bridge-app/scripts/generate-guides.py --font-dir /usr/share/fonts/truetype/dejavu

The fonts directory must contain DejaVuSans.ttf, DejaVuSans-Bold.ttf and DejaVuSansMono.ttf, or Ubuntu-R.ttf, Ubuntu-B.ttf and Inconsolata-Regular.ttf. Render every generated page with Poppler and review layout before publishing.

## Windows and Linux

Use a Linux build environment with Node.js 22.12+, zip, unzip, NSIS (`makensis`), dpkg-deb and the libraries required by Electron. Run `npm ci` in bridge-app, then `npm run build:installers`. It packages from current source via the pinned @electron/packager. For local builds from already validated Electron 45 bundles, the documented build helper also accepts `--from-bundles <release-directory>` and `--packager-root <packager-dist-directory>`. It verifies base SHA-256 values before use. `BRIDGE_BUILD_WORKDIR` can move temporary payloads to a fast local build filesystem.

The setup is per user and does not ask for elevation. Windows choices: Start menu (on by default), desktop (off), startup (off). Existing choices are retained on upgrade; the user can change them. Silent testing accepts `/S /DESKTOP=0|1 /STARTMENU=0|1 /AUTOSTART=0|1 /D=<absolute dedicated folder>`; `/D` is last and unquoted per NSIS syntax. Do not use silent mode for ordinary customer onboarding. The app remains paused on every launch, including login startup.

Uninstallation verifies its product marker and install registration, deletes only the generated list of delivered files, and removes only setup-owned shortcuts. It retains user profile state and extra files. Never replace this with recursive removal of a user-chosen directory. Existing unrelated shortcut files are preserved. Users revoke devices in the web app before permanent removal.

The Debian package installs an application menu entry and a root-owned Chromium sandbox helper with the standard setuid mode. It creates no auto-starting daemon or user login entry. Login startup is a separate opt-in in the app. Package removal preserves user profile data; users remove their optional user startup/desktop entries before removal.

## macOS

On a Mac with Node and the pinned dependencies installed, run `npm run build:macos`. The script creates Apple Silicon and Intel DMGs with an Applications shortcut and PDF guides, verifies each image using hdiutil, and records checksums in the manifest. It does not pretend to sign/notarize or validate desktop permissions. Do not offer a DMG before this build succeeds and its contents are checked on a Mac. The current ZIP installation remains available meanwhile.

## Release checks

Check source and package hashes, native startup and paused state, Windows install/update/uninstall choices, Debian install/removal and Linux startup, PDF rendering, public MIME/attachment downloads, tenant/permission regression tests and data preservation. Run native startup tests only against dedicated fixture profiles. Never include a test token, device credential or customer profile in a package. Keep old release archive bytes unchanged; the manifest may retain old download entries for compatibility while customer cards prefer current primary installers.

All current packages are unsigned previews. Trusted production distribution still requires Windows code signing and macOS Developer ID signing/notarization. No automatic update channel is implemented.

## Prepared signing pipeline

See SIGNING.md for the KeRn-WS signing configuration, Windows Artifact Signing/certificate store setup, Developer ID notarization and signed APT repository generation. All release commands are explicit opt-in, produce verified local candidates, and do not publish or replace currently served previews.
