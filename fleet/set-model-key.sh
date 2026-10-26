#!/usr/bin/env bash
# Give this machine's `dsh` agent a model key, without the key ever appearing
# on screen, in shell history, or on another machine.
#
#   ./set-model-key.sh deepseek      DeepSeek's own API (dsh's default route)
#   ./set-model-key.sh opencode-go   OpenCode Go (deepseek-v4.1-flash)
#
# What it does:
#   1. asks for the key (hidden input)
#   2. writes it to ~/.config/malipetek-runner/node.env (mode 600), which the
#      node service reads, and to dsh's own store ~/.dsh/.credentials.yaml, so
#      `dsh headless` in an SSH session finds it too
#   3. points the headless dsh profile at that provider, with the store enabled
#   4. runs one real task with it; stops here if that fails
#   5. adds `dsh` to this node's agents and restarts the node service
set -euo pipefail

PROVIDER=${1:-}
case "$PROVIDER" in
  deepseek)
    VAR=DEEPSEEK_API_KEY
    # dsh's shipped default is already deepseek-official; say so explicitly,
    # replacing any earlier provider choice in this profile.
    PATCH='- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: deepseek-official
    model: deepseek-flash'
    ;;
  opencode-go)
    VAR=OPENCODE_GO_API_KEY
    PATCH='- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      opencode-go:
        apiKeyEnv: OPENCODE_GO_API_KEY
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: opencode-go
    model: deepseek-v4.1-flash'
    ;;
  *)
    echo "usage: $0 deepseek|opencode-go" >&2
    exit 2
    ;;
esac

export PATH="$HOME/n/bin:$HOME/.local/bin:$PATH"
command -v dsh >/dev/null || { echo "dsh is not installed (npm install -g @deepseek-ai/dsh)" >&2; exit 1; }

read -rsp "Paste the $PROVIDER API key (input is hidden): " KEY
echo
[ -n "$KEY" ] || { echo "No key given; nothing changed." >&2; exit 1; }

# 3 + 4 first, against a scratch copy, so a bad key changes nothing.
PROFILE="$HOME/.dsh/profiles/headless"
mkdir -p "$PROFILE"
SCRATCH=$(mktemp -d)
trap 'rm -rf "$SCRATCH"' EXIT
printf '%s\n' "$PATCH" > "$SCRATCH/patch.yml"
echo "Checking the key with one small task…"
if ! OUT=$(cd "$SCRATCH" && env "$VAR=$KEY" timeout 180 dsh --profile headless --patch "$SCRATCH/patch.yml" "Reply with exactly: OK" 2>&1); then
  echo "The key did not work:" >&2
  echo "$OUT" | tail -3 >&2
  exit 1
fi
echo "$OUT" | tail -1 | grep -q OK || { echo "Unexpected answer:" >&2; echo "$OUT" | tail -3 >&2; exit 1; }
echo "The key works."

# 2. The environment file the node service reads.
ENVFILE="$HOME/.config/malipetek-runner/node.env"
mkdir -p "$(dirname "$ENVFILE")"
touch "$ENVFILE"
chmod 600 "$ENVFILE"
grep -v "^$VAR=" "$ENVFILE" > "$ENVFILE.tmp" || true
printf '%s=%s\n' "$VAR" "$KEY" >> "$ENVFILE.tmp"
mv "$ENVFILE.tmp" "$ENVFILE"
chmod 600 "$ENVFILE"
printf '%s' "$KEY" | python3 -c '
import os, sys
var, key = sys.argv[1], sys.stdin.read()
path = os.path.expanduser("~/.dsh/.credentials.yaml")
lines = open(path).read().splitlines() if os.path.exists(path) else ["version: 1", "records: {}", "refs:"]
lines = ["refs:" if l.strip() == "refs: {}" else l for l in lines if not l.strip().startswith(var + ":")]
if "refs:" not in lines: lines.append("refs:")
lines.insert(lines.index("refs:") + 1, f"  {var}: {key}")
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
os.write(fd, ("\n".join(lines) + "\n").encode()); os.close(fd)
' "$VAR"
unset KEY

# 3. The headless profile, kept with a backup.
[ -f "$PROFILE/cordis.patch.yml" ] && cp "$PROFILE/cordis.patch.yml" "$PROFILE/cordis.patch.yml.bak-$(date +%Y%m%d%H%M%S)"
{
  echo "# Fleet node (malipetek.dev): written by set-model-key.sh. The key comes"
  echo "# from node.env ($VAR) for the service and ~/.dsh/.credentials.yaml for SSH sessions."
  printf '%s\n' '- id: credentials
  name: "@deepseek-ai/dsh-credentials-local"
  disabled: false'
  printf '%s\n' "$PATCH"
} > "$PROFILE/cordis.patch.yml"

# 5. The service reads node.env; the node offers dsh.
DROPIN="$HOME/.config/systemd/user/malipetek-node.service.d"
mkdir -p "$DROPIN"
printf '[Service]\nEnvironmentFile=-%s\n' "$ENVFILE" > "$DROPIN/env.conf"
CONFIG="${MALIPETEK_NODE_CONFIG:-$HOME/.config/malipetek-runner/config.json}"
python3 - "$CONFIG" <<'EOF'
import json, sys
path = sys.argv[1]
config = json.load(open(path))
node = config.setdefault("node", {})
if isinstance(node.get("executors"), list) and "dsh" not in node["executors"]:
    node["executors"].append("dsh")
config.setdefault("executors", {}).setdefault("dsh", {"bin": "dsh", "profile": "headless"})
json.dump(config, open(path, "w"), indent=2)
open(path, "a").write("\n")
print("This node now offers:", node.get("executors", "every agent it finds"))
EOF
systemctl --user daemon-reload
systemctl --user restart malipetek-node
echo "Node restarted with the key. dsh is ready."
