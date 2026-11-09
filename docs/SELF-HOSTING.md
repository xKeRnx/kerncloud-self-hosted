# Install and run locally

[Deutsch](SELF-HOSTING.de.md) · [Desktop launcher](DESKTOP.md)

KeRnCloud runs its own web app, PostgreSQL database, workers, scheduler and private file storage in Docker. English is the default; German is available in the language selector. The self-hosted edition opens the workspace directly and does not include the operator's marketing website.

## Requirements

Use Docker with Linux containers and Compose v2. The source quick start also needs Node.js 22+. The desktop launcher includes its own Node runtime. Allow approximately four CPU cores, 8 GB free RAM and 20 GB disk space for a small installation; browsers, builds and local models can need more. The first build needs internet access.

## Source quick start

```sh
node scripts/self-host.mjs init
node scripts/self-host.mjs doctor
node scripts/self-host.mjs start
```

Open http://localhost:3100/login. The generated administrator email/password are in the private `.env` file. Keep that file private and change the administrator password after signing in. Existing `.env` files are preserved. Do not initialize a local installation over an operator/SaaS installation.

Before the first initialization, different ports can be selected:

```sh
node scripts/self-host.mjs init --port 4100 --gateway-port 4200 --email admin@example.com
```

The desktop app provides these settings without editing files. Start with one project, connect your own model, set a small task budget and create a test task. Your external provider bills its own usage; self-hosting does not include a paid model allowance.

## Localhost and network access

The default binds published ports to 127.0.0.1. The desktop Network & ports panel lets you choose different website/environment ports and opt into local-network access using this computer's IP or hostname. Stop and start services to apply a change. This preserves data and permissions.

LAN mode binds to 0.0.0.0. Authentication is still required. No firewall or router rule is opened automatically. Use HTTPS for sensitive network access. Publishing to the internet needs a separately configured HTTPS reverse proxy and domain. Invitation/password links require HTTPS except on loopback; do not weaken that protection.

## Users and permissions

Public signup is off by default. Administrators can invite users, suspend accounts, revoke sessions and assign administrator/user roles under Users & access. Changes require administrator reauthentication. Users set their own passwords through a one-time invitation. Workspace membership and project/tool permissions remain separate boundaries. The last active administrator is protected.

## Maintenance

```sh
node scripts/self-host.mjs status
node scripts/self-host.mjs backup
node scripts/self-host.mjs update
node scripts/self-host.mjs stop
```

Stopping does not remove volumes. Updates use the installed source version, refuse to restart over open tasks and create database/object backups first. Preserve the matching `.env` and encryption key separately. An uninstall removes application files, while runtime data and Docker volumes remain. Never use `down -v` as part of an ordinary update or uninstall.

## Troubleshooting

Run `doctor` to check the Linux engine and Compose. Check the launcher log or `node scripts/self-host.mjs logs` if startup is incomplete. If a port is in use, choose another. Automatic network allocation avoids occupied local subnets and preserves existing project networks. Do not remove unrelated Docker networks or volumes to resolve a startup problem.

The Bridge is a separate device-access adapter. Installing the server does not grant access to your computer's files or desktop. Model connections, tool grants and approvals must still be configured deliberately.
