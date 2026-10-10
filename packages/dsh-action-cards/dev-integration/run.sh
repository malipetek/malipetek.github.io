#!/usr/bin/env bash
#
# Boot the throwaway profile and report what the driver found.
#
# The driver checks the real sandboxed filesystem, the real confined shell and
# the real sandbox policy, drives the plugin's own propose/apply path against
# them, then exits the process. The report is written before it does.
#
#   ./dev-integration/setup.sh && ./dev-integration/run.sh
#
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${DSH_ACTION_CARDS_VERIFY_ROOT:-/tmp/dsh-action-cards-verify}"
DSH="${DSH_BIN:-/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh}"
TIMEOUT="${DSH_ACTION_CARDS_VERIFY_TIMEOUT:-90}"

if [[ ! -d "$ROOT/home/profiles/verify" ]]; then
  echo "run: no profile at $ROOT — run setup.sh first" >&2
  exit 1
fi

DSH_HOME="$ROOT/home" \
DSH_ACTION_CARDS_DIR="$ROOT/state" \
DSH_ACTION_CARDS_REPORT="$ROOT/report.json" \
DSH_ACTION_CARDS_WORKSPACE="$ROOT/workspace" \
  timeout "$TIMEOUT" "$DSH" --profile verify 2>&1 | grep -E '^\[driver\]|^\[action-cards\]'

echo
if [[ -f "$ROOT/report.json" ]]; then
  node -e '
const fs = require("node:fs");
const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const rows = report.steps ?? [];
console.log(`${rows.filter((row) => row.ok).length}/${rows.length} checks passed, ${report.failed ?? "?"} failure(s)`);
for (const row of rows.filter((entry) => !entry.ok)) console.log(`  FAILED ${row.name}${row.detail === undefined ? "" : ` — ${typeof row.detail === "string" ? row.detail : JSON.stringify(row.detail)}`}`);
process.exit(report.failed === 0 ? 0 : 1);
' "$ROOT/report.json"
else
  echo "run: the driver wrote no report" >&2
  exit 1
fi
