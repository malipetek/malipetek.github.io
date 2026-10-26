#!/bin/zsh
# <swiftbar.hideRunInTerminal>true</swiftbar.hideRunInTerminal>
# <swiftbar.hideLastUpdated>true</swiftbar.hideLastUpdated>
#
# Menu-bar dot for the local fleet node: green when it heartbeated in the last
# minute and a half, yellow while it is working, red when it is silent.
# Install: symlink into your SwiftBar plugins folder.
STATUS="$HOME/.cache/malipetek-node/status.json"
LOG="$HOME/Library/Logs/malipetek-node/node.log"
if [[ ! -f "$STATUS" ]]; then
  echo "● | color=red"; echo "---"; echo "no node status — run fleet/install.sh"; exit 0
fi
/usr/bin/python3 - "$STATUS" "$LOG" <<'PY'
import json, sys, time
s = json.load(open(sys.argv[1]))
age = time.time() - (s.get("lastHeartbeatAt") or 0) / 1000
running = s.get("running") or []
if age > 90 or s.get("lastError"):
    print("● | color=red")
elif running:
    print(f"● {len(running)} | color=orange")
else:
    print("● | color=green")
print("---")
print(f"node {s.get('nodeId')} v{s.get('version')} · {', '.join(s.get('executors') or [])}")
print(f"last heartbeat {int(age)}s ago" + (" · draining" if s.get("draining") else ""))
if s.get("lastError"):
    print(f"{s['lastError'][:80]} | color=red")
for r in running:
    print(f"#{r['ticketId']} {r['title'][:50]} · {r['executor']} · {int((time.time()*1000 - r['startedAt'])/60000)}m")
print("---")
print(f"Open log | bash=/usr/bin/open param1=-a param2=Console param3={sys.argv[2]} terminal=false")
print(f"Restart node | bash=/bin/launchctl param1=kickstart param2=-k param3=gui/{__import__('os').getuid()}/dev.malipetek.node terminal=false refresh=true")
PY
