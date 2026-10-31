#!/bin/sh
# Syntax-check JSX files without building the site: scripts/i18n-check-jsx.sh file.jsx …
E=$(ls -d node_modules/.pnpm/esbuild@*/node_modules/esbuild/bin/esbuild | tail -1)
for f in "$@"; do "$E" "$f" --loader:.jsx=jsx --loader:.js=jsx --log-level=error >/dev/null && echo "ok $f"; done
