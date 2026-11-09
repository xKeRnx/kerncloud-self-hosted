#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
node scripts/self-host.mjs stop
