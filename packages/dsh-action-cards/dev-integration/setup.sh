#!/usr/bin/env bash
#
# Wire a throwaway DSH profile around the integration driver.
#
# The driver must be mounted by the real loader to reach the real services, so it
# needs a profile of its own. This copies the `desktop` profile (known to boot,
# and already holding every bundle the plugin's neighbours need), swaps the plugin
# out of the bundle list for the driver, and points the driver at a scratch store
# and workspace.
#
# Everything lives under one scratch DSH_HOME, so the running app's sessions,
# storages and action store are never touched. Run it, then print the command:
#
#   ./dev-integration/setup.sh          # wire it
#   ./dev-integration/run.sh            # boot it and report
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(cd "$HERE/.." && pwd)"
ROOT="${DSH_ACTION_CARDS_VERIFY_ROOT:-/tmp/dsh-action-cards-verify}"
DSH="${DSH_BIN:-/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh}"
SOURCE_PROFILE="${DSH_SOURCE_PROFILE:-$HOME/.dsh/profiles/desktop}"

if [[ ! -x "$DSH" ]]; then
  echo "setup: no dsh CLI at $DSH (set DSH_BIN)" >&2
  exit 1
fi
if [[ ! -f "$SOURCE_PROFILE/package.json" ]]; then
  echo "setup: no source profile at $SOURCE_PROFILE (set DSH_SOURCE_PROFILE)" >&2
  exit 1
fi

rm -rf "$ROOT"
mkdir -p "$ROOT/home/profiles/verify" "$ROOT/state" "$ROOT/workspace"

# The profile: the source profile's bundle list, minus this plugin (the driver
# owns the only application of it, through its recording shim), plus the driver.
DSH_ACTION_CARDS_VERIFY_ROOT="$ROOT" SOURCE_PROFILE="$SOURCE_PROFILE" PLUGIN_DIR="$PLUGIN_DIR" node -e '
const fs = require("node:fs");
const path = require("node:path");
const root = process.env.DSH_ACTION_CARDS_VERIFY_ROOT;
const profile = JSON.parse(fs.readFileSync(path.join(process.env.SOURCE_PROFILE, "package.json"), "utf8"));
profile.name = "dsh-profile-verify";
delete profile.dependencies["@malipetek/dsh-action-cards"];
profile.dsh.profile.bundles = profile.dsh.profile.bundles.filter((name) => name !== "@malipetek/dsh-action-cards");
profile.dependencies["@malipetek/dsh-action-cards-driver"] = `link:${path.join(process.env.PLUGIN_DIR, "dev-integration/driver")}`;
profile.dsh.profile.bundles.push("@malipetek/dsh-action-cards-driver");
const dir = path.join(root, "home/profiles/verify");
fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(profile, null, 2) + "\n");
fs.writeFileSync(path.join(dir, "pnpm-workspace.yaml"), "packages:\n  - .\n");
const patch = path.join(process.env.SOURCE_PROFILE, "cordis.patch.yml");
if (fs.existsSync(patch)) fs.copyFileSync(patch, path.join(dir, "cordis.patch.yml"));
// The profile resolves its bundles from its own node_modules; link the source
// profile'\''s @local packages so the neighbouring plugins still resolve.
const localDir = path.join(dir, "node_modules/@local");
fs.mkdirSync(localDir, { recursive: true });
const sourceLocal = path.join(process.env.SOURCE_PROFILE, "node_modules/@local");
for (const entry of fs.readdirSync(sourceLocal)) {
  if (entry === "dsh-action-cards") continue;
  fs.symlinkSync(path.join(sourceLocal, entry), path.join(localDir, entry));
}
fs.symlinkSync(path.join(process.env.PLUGIN_DIR, "dev-integration/driver"), path.join(localDir, "dsh-action-cards-driver"));
'

echo "setup: profile wired at $ROOT/home/profiles/verify"
echo "setup: run it with $HERE/run.sh"
