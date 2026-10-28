#!/bin/sh
# Installs the launchd job that runs the publisher every 15 minutes.
#   marketing/publisher/install.sh          install (or update) and start
#   marketing/publisher/install.sh remove   stop and delete the job
set -eu
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
label=dev.malipetek.marketing-publisher
target="$HOME/Library/LaunchAgents/$label.plist"

if [ "${1:-install}" = "remove" ]; then
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  rm -f "$target"
  echo "Removed $label."
  exit 0
fi

if [ ! -f "$here/.env" ]; then
  echo "Create $here/.env first (copy .env.example) and set MARKETING_TOKEN." >&2
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents"
sed -e "s#__REPO__#$repo#g" -e "s#__HOME__#$HOME#g" "$here/com.malipetek.marketing-publisher.plist.template" > "$target"

launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$target"
echo "Installed $label; it runs every 15 minutes and logs to $here/publish.log."
echo "Stop it with: $0 remove"
