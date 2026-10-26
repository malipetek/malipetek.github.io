#!/usr/bin/env bash
#
# Keep the workspace mirror of this plugin in step with the canonical copy.
#
# The canonical copy is the one the `desktop` profile installs and the one that
# gets published, which makes it the only copy that matters. This script keeps a
# second copy, inside the agent workspace, byte-identical — so that reading or
# testing from the workspace path cannot show code the app is not running.
#
# That confusion is not hypothetical: the profile was once repointed at the
# canonical copy, and every later fix landed in the workspace copy instead. The
# app kept loading a snapshot from hours earlier, and it looked exactly like a
# caching bug.
#
#   ./dev-sync.sh            mirror the canonical copy into the workspace
#   ./dev-sync.sh --check    report drift and exit non-zero, changing nothing
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIRROR="${DSH_ACTION_CARDS_MIRROR:-/Users/malipetek/Documents/deepseek-harness/default-workspace/dsh-action-cards}"

if [[ "$HERE" == "$MIRROR" ]]; then
  echo "dev-sync: this is the mirror at $MIRROR; run the canonical copy's script instead" >&2
  exit 1
fi
if [[ ! -d "$MIRROR" ]]; then
  echo "dev-sync: no mirror at $MIRROR (set DSH_ACTION_CARDS_MIRROR)" >&2
  exit 1
fi

if [[ "${1:-}" == "--check" ]]; then
  if diff -r "$HERE" "$MIRROR" >/dev/null 2>&1; then
    echo "dev-sync: in step — $MIRROR matches $HERE"
    exit 0
  fi
  echo "dev-sync: DRIFT — the mirror does not match the canonical copy:" >&2
  diff -rq "$HERE" "$MIRROR" 2>&1 | head -20 >&2
  exit 1
fi

rsync -a --delete "$HERE/" "$MIRROR/"
echo "dev-sync: mirrored $HERE"
echo "dev-sync:        -> $MIRROR"
if diff -r "$HERE" "$MIRROR" >/dev/null 2>&1; then
  echo "dev-sync: in step"
else
  echo "dev-sync: WARNING — the copies still differ after the copy" >&2
  exit 1
fi
