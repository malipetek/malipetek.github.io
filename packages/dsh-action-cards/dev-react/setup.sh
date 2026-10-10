#!/usr/bin/env bash
#
# Install the three packages the real-React render test needs.
#
# They go into a scratch directory rather than this package, so the plugin keeps
# its zero-dependency property: `render.mjs` resolves React, React DOM and jsdom
# from wherever this put them.
#
#   ./dev-react/setup.sh && node dev-react/render.mjs
#
set -euo pipefail

DIR="${DSH_ACTION_CARDS_REACT_DIR:-/tmp/dsh-action-cards-react}"
REACT_VERSION="${DSH_ACTION_CARDS_REACT_VERSION:-18.3.1}"
JSDOM_VERSION="${DSH_ACTION_CARDS_JSDOM_VERSION:-24}"

mkdir -p "$DIR"
cd "$DIR"
if [[ ! -f package.json ]]; then
  printf '{ "name": "dsh-action-cards-react-test", "private": true, "version": "1.0.0" }\n' > package.json
fi

# pnpm is the package manager the Harness itself bundles. npm is deliberately
# left out: on a machine with a gated npm, `setup.sh` should not be the thing
# that trips it.
if command -v pnpm >/dev/null 2>&1; then
  pnpm add "react@$REACT_VERSION" "react-dom@$REACT_VERSION" "jsdom@$JSDOM_VERSION"
else
  echo "setup: pnpm not found — install react@$REACT_VERSION react-dom@$REACT_VERSION jsdom@$JSDOM_VERSION into $DIR yourself" >&2
  exit 1
fi

echo
echo "setup: installed into $DIR"
echo "setup: run the test with  node dev-react/render.mjs"
