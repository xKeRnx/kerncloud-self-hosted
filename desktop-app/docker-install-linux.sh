#!/bin/sh
set -eu
if [ "$(id -u)" != 0 ]; then echo 'Administrator permission is required.' >&2; exit 1; fi
. /etc/os-release
case "$ID" in debian|ubuntu) ;; *) echo 'Automatic setup supports Debian and Ubuntu. Install Docker using your distribution guide.' >&2; exit 1;; esac
case "${VERSION_CODENAME:-}" in ''|*[!a-zA-Z0-9_-]*) echo 'Unknown distribution release.' >&2; exit 1;; esac
if command -v docker >/dev/null 2>&1; then echo 'Docker already exists; existing installation left unchanged.'; exit 0; fi
for package in docker.io docker-compose podman-docker containerd runc; do
 if dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q 'install ok installed'; then echo "Existing $package package detected; review compatibility before installing Docker CE. Nothing removed." >&2; exit 1; fi
done
apt-get update
apt-get install -y ca-certificates curl
install -m 0755 -d /etc/apt/keyrings
curl --fail --silent --show-error --location "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
arch=$(dpkg --print-architecture)
case "$arch" in amd64|arm64) ;; *) echo 'Unsupported architecture.' >&2; exit 1;; esac
cat > /etc/apt/sources.list.d/kerncloud-docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/$ID
Suites: $VERSION_CODENAME
Components: stable
Architectures: $arch
Signed-By: /etc/apt/keyrings/docker.asc
EOF
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
echo 'Docker packages installed. No user groups, firewall rules or existing containers were changed.'
