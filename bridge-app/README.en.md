# KeRnCloud Bridge 0.1.5

Bridge connects a customer computer to a KeRnCloud workspace using outbound HTTPS. It does not open router ports. Plain HTTP is permitted only for local development on localhost/127.0.0.1.

## Setup

1. Windows x64: run the Setup wizard. Choose Start menu entries, a desktop shortcut and optional login startup. Startup is off by default. Installation is per user without administrator privileges; choose a dedicated folder on first install. Updates reuse that folder. Linux Debian/Ubuntu x64: open the `.deb` in the software center, or run `sudo apt install ./kerncloud-bridge-0.1.5-linux-amd64.deb`, then launch from the application menu. Other distributions can use the portable ZIP: extract, `chmod +x Start-Bridge.sh`, run the launcher in a graphical session with a working Secret Service/keyring. Never disable the Electron sandbox. macOS: choose the Apple Silicon or Intel ZIP, extract and move the app to Applications before opening it. Drag it from Applications to the Dock if desired.
2. In KeRnCloud open Connections & environments → Bridge & devices. The workspace owner needs an active plan with connector slots. Docker connectors and Bridge share the account-wide device cap.
3. Create an enrollment key with a name, expiry, explicit projects, agents and capabilities. Empty selections grant no access. Enter only the device name and one-time key in the app, then select Connect device. The KeRnCloud address is already configured. For a different installation, open Advanced settings and enable Use another server address to enter its HTTPS address. Updates retain previously saved server addresses.
4. While paused, choose local folders and aliases, read/write permissions, exact HTTP(S) origins and optional fixed programs with fixed arguments. Save, then resume. Only the local user can widen local access; cloud permissions are an additional ceiling.

## Startup, shortcuts and removal

Startup is optional and always opens Bridge paused. Change Windows/Linux startup later in the app's local startup section. For Windows desktop and Start menu options, run Setup again and adjust the choices. Setup asks you to close the app instead of force-stopping active work. Remove it through Windows Settings > Apps or the Start menu uninstall entry.

On Linux, the Debian package creates an application-menu entry. A desktop launcher is optional in the app; your desktop may ask you to allow launching it. Turn off user startup and remove any user-created desktop launcher before removing the package through the software center or sudo apt remove kerncloud-bridge. On macOS, manage login items manually in System Settings > General > Login Items.

Uninstalling retains connection settings and the action journal in your user profile. The Windows uninstaller removes only delivered program files and its own registered shortcuts; extra files you added are not recursively removed. Revoke the device in the web app before permanent disconnection.

## Operation

Read text files up to 60 KB; list up to 200 directory entries. Paths must remain inside selected folders; links are rejected. Overwriting requires the hash from a previous read and creates a local backup beside the file. Pause and restore that backup manually if needed. External effects cannot be rolled back.

The isolated browser uses its own profile, no Node integration, no automatic downloads and only locally allowlisted origins. Writable requests also require local write permission for that origin. Sign in manually in that browser when needed. HTTP tools pin DNS per request, refuse metadata/link-local destinations and do not automatically follow redirects. Network replies are capped at 60 KB/12 seconds. Custom authentication headers are not available in this version.

Programs are explicitly selected absolute executables with fixed arguments, a 15-second limit and bounded output. Do not approve general shells/interpreters. Programs run with the OS user's privileges; this is not an OS sandbox.

Desktop actions require exact web approval and local confirmation. Screenshots currently support one monitor. Windows supports mouse clicks and keyboard input. Linux input needs X11 and xdotool; Wayland input is unavailable. macOS screen capture, keyboard input and mouse clicks use OS APIs subject to user permissions. Use the isolated browser where possible.

## Privacy, keys and recovery

Read content, tool outputs and explicitly approved screenshots may reach KeRnCloud and the selected AI provider. Local execution is not fully offline AI. Credentials and local policy use Electron safeStorage; an unavailable or insecure basic_text backend is rejected. A local action journal stores results in the app's user-data directory to avoid replay and must be protected as customer data.

Use the local pause button to stop new actions. Already executed effects cannot be undone; short file operations may finish. Restart or connection errors leave the app paused. Cloud pause/revocation prevents new access but cannot physically stop an offline machine.

Edit key names, expiry and scope in the web app. Rotation immediately invalidates old device credentials and issues a new one-time enrollment key. Reconnect the app. Revocation blocks access. Deletion removes the active entry while retaining action history. Pending actions are canceled or marked uncertain when grants change. An uncertain action must be checked locally before issuing a new operation; it is never silently repeated.

Operator support receives no automatic device access. Task budgets and permissions still apply. From version 0.1.5, installed Bridge checks for updates at startup and every six hours, verifies new versions and downloads them in the background. In Updates, enable or disable automatic downloads, check now, or choose Restart and update. Pause Bridge and wait for active actions to finish before installing. On Windows a downloaded update can also install at the next launch. Linux may ask for OS authorization; macOS uses the native update service. Connections, credentials, local permissions and the action journal remain in your user profile. Bridge starts paused after an update. Older versions need the current installer once to enable this feature. Portable builds use the installer for updates. See the detailed German guide for further operational notes and platform limitations.
