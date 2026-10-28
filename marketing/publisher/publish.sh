#!/bin/sh
# Runs the publisher with the local .env, from any working directory.
#   ./publish.sh --login
#   ./publish.sh --once
#   ./publish.sh --once --auto
set -eu
here=$(cd "$(dirname "$0")" && pwd)
if [ -f "$here/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$here/.env"
  set +a
fi
cd "$here"
exec node "$here/publish.mjs" "$@"
