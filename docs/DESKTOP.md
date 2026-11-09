# Desktop app: Windows, Linux and macOS

[Deutsch](DESKTOP.de.md) · [Local setup](SELF-HOSTING.md)

The KeRnCloud desktop launcher installs the local server source, starts its Docker services and opens the dashboard in an isolated window. The separate Bridge adapter grants bounded access to a device; it does not replace the local server.

## First launch

The launcher starts in English. Choose German from its selector if preferred; that choice is remembered on the device. Select Set up Docker if needed, complete the official installer/operating-system prompts, then select Start locally. Existing Docker installations and data are kept. Linux guided installation supports Debian/Ubuntu; other systems use their distribution's Docker installation method.

The initial container build needs internet. Open the generated private configuration to obtain the initial administrator credentials, sign in and change the password. Public registration is off. The desktop defaults are website port 43100 and environment gateway port 43200; the launcher shows the actual address.

## Network and users

Network & ports offers localhost-only access or explicit LAN access through this computer's IP/hostname. Stop and start the services after saving a change. No firewall/router settings are changed. Use HTTPS for sensitive network access and for invitation/password links outside loopback.

Users & access opens administrator account management in the dashboard. Authentication, membership, roles, project boundaries and tool approvals apply to local installations too.

## Update and uninstall

Update local server creates a backup and applies the installed source version after open tasks are finished or paused appropriately. Installing a newer desktop package upgrades the launcher/source; it does not silently replace your private configuration. Stop/start or update the local server to apply its new source.

Runtime data is stored separately from installation files, under Electron's `kerncloud-desktop` user profile by default. Test/deployment automation can set `KERNCLOUD_DESKTOP_DATA_DIR` to an explicit runtime directory. Do not change the directory between upgrades unless intentionally migrating the same configuration and volumes.

Closing the launcher leaves local services running. Stop services preserves database/object volumes. Uninstall removes the launcher and its managed shortcuts, while preserving runtime configuration, keys, data and permissions. Reinstalling can reuse that data. Keep backups and the matching encryption key separately.

## Build targets

Windows: NSIS EXE with an English default and optional German. Linux: AppImage and DEB. macOS: DMG and ZIP built on macOS. Platform verification and signing/notarization status are recorded separately for each release; preparing a build target does not imply that target has been tested on a real device.

```sh
node scripts/desktop-payload.mjs
cd desktop-app
npm ci
npm test
npm run build
```

Only curated application source is included in the server payload. Local `.env` files, keys, private signing material, runtime data, backups and development dependencies must remain excluded.

## Installation diagnostics

For unattended installation checks, run the launcher with `--diagnostics-report /absolute/path/report.json`. It uses a separate profile alongside that report and exits after loading the renderer. Add `--local-command doctor` or another existing local command to verify Docker services through the same backend runner as the UI. To test an existing installation, set `KERNCLOUD_DESKTOP_DATA_DIR` explicitly. Reports exclude credentials and customer content. No general shell commands or arbitrary scripts are accepted.
