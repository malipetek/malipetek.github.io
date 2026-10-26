#!/usr/bin/env bash
#
# Install this machine as a fleet node, supervised so it survives crashes,
# logouts and reboots: a LaunchAgent on macOS, a systemd user unit on Linux.
#
#   fleet/install.sh              install (or reinstall) and start
#   fleet/install.sh uninstall    stop and remove the service
#   fleet/install.sh restart      restart the running node
#
# The node reads ~/.config/malipetek-runner/config.json (fleet/config.example.json).
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LABEL="dev.malipetek.node"
NODE_BIN="$(command -v node)"
LOG_DIR="$HOME/Library/Logs/malipetek-node"
CONFIG="${MALIPETEK_NODE_CONFIG:-$HOME/.config/malipetek-runner/config.json}"
# launchd and systemd start with a bare PATH; give the node the one the agents need.
AGENT_PATH="$HOME/.local/bin:$HOME/n/bin:$HOME/Library/pnpm:$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

action="${1:-install}"

if [[ "$(uname)" == "Darwin" ]]; then
  PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
  DOMAIN="gui/$(id -u)"
  case "$action" in
    uninstall)
      launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
      rm -f "$PLIST"
      echo "removed $LABEL"
      exit 0 ;;
    restart)
      launchctl kickstart -k "$DOMAIN/$LABEL"
      echo "restarted $LABEL"
      exit 0 ;;
  esac
  [[ -f "$CONFIG" ]] || { echo "no config at $CONFIG — copy fleet/config.example.json there first" >&2; exit 1; }
  mkdir -p "$LOG_DIR" "$(dirname "$PLIST")"
  cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$NODE_BIN</string><string>$HERE/node.mjs</string></array>
  <key>WorkingDirectory</key><string>$HERE</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ExitTimeOut</key><integer>30</integer>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$AGENT_PATH</string>
    <key>MALIPETEK_NODE_CONFIG</key><string>$CONFIG</string>
  </dict>
  <key>StandardOutPath</key><string>$LOG_DIR/node.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/node.err.log</string>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
PLIST
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  launchctl bootstrap "$DOMAIN" "$PLIST"
  echo "installed $LABEL → $PLIST"
  echo "logs: $LOG_DIR/node.log"
  exit 0
fi

# Linux (the G500): a systemd user unit. `loginctl enable-linger $USER` keeps it
# running with nobody logged in.
UNIT_DIR="$HOME/.config/systemd/user"
UNIT="$UNIT_DIR/malipetek-node.service"
case "$action" in
  uninstall)
    systemctl --user disable --now malipetek-node 2>/dev/null || true
    rm -f "$UNIT"; systemctl --user daemon-reload
    echo "removed malipetek-node"; exit 0 ;;
  restart)
    systemctl --user restart malipetek-node; echo "restarted malipetek-node"; exit 0 ;;
esac
[[ -f "$CONFIG" ]] || { echo "no config at $CONFIG — copy fleet/config.example.json there first" >&2; exit 1; }
mkdir -p "$UNIT_DIR"
cat > "$UNIT" <<UNIT
[Unit]
Description=malipetek.dev fleet node
After=network-online.target

[Service]
ExecStart=$NODE_BIN $HERE/node.mjs
WorkingDirectory=$HERE
Environment=PATH=$AGENT_PATH
Environment=MALIPETEK_NODE_CONFIG=$CONFIG
Restart=always
RestartSec=10
KillSignal=SIGTERM
TimeoutStopSec=30

[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
systemctl --user enable --now malipetek-node
echo "installed malipetek-node → $UNIT (logs: journalctl --user -u malipetek-node -f)"
