#!/usr/bin/env node
/**
 * Dev-only preview of the real AdminApp with synthetic data. Run from any directory:
 *   node packages/admin-ui/preview/workbench-preview.mjs [light|dark|both]
 * Requires the repo dependencies, Python Playwright, and system Google Chrome.
 * Browser assets and screenshots are written under /tmp/aw-shots, never to src.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const mode = process.argv[2] ?? 'both';
if (!['light', 'dark', 'both'].includes(mode) || process.argv.length > 3) {
  console.error('Usage: node packages/admin-ui/preview/workbench-preview.mjs [light|dark|both]');
  process.exit(2);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.env.AW_SHOTS ?? '/tmp/aw-shots';
const require = createRequire(path.resolve(here, '../../../package.json'));
const astroRequire = createRequire(require.resolve('astro/package.json'));
const { build } = await import(pathToFileURL(astroRequire.resolve('esbuild')).href);
const reactModules = ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'];

const bundle = await build({
  stdin: {
    contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { AdminApp } from '../src/app.jsx';
      import { api } from './workbench-fixtures.mjs';

      if (new URLSearchParams(location.search).get('theme') === 'dark') {
        document.documentElement.dataset.theme = 'dark';
      }
      createRoot(document.getElementById('root')).render(<AdminApp api={api} platform="web" fullscreen />);
    `,
    sourcefile: 'workbench-preview.jsx',
    resolveDir: here,
    loader: 'jsx',
  },
  alias: Object.fromEntries(reactModules.map(name => [name, require.resolve(name)])),
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  // Keep React's development diagnostics enabled for the screenshot report.
  define: { 'process.env.NODE_ENV': '"development"' },
});

mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, 'harness.js'), bundle.outputFiles[0].contents);
const html = path.join(out, 'index.html');
writeFileSync(html, `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Admin workbench preview</title>
  <style>
    html, body { margin: 0; height: 100%; background: var(--bone, #fff); }
    /* AdminApp derives its web palette from the host tokens. */
    :root[data-theme="dark"] {
      color-scheme: dark;
      --bone: #141519;
      --paper: #1b1d23;
      --rule: #292d37;
      --rule-strong: #3a3f4b;
      --ink: #eceef4;
      --ink-soft: #a2a8b6;
      --orange: #ff7a33;
    }
  </style>
</head>
<body><div id="root"></div><script src="./harness.js"></script></body>
</html>
`);

const themes = mode === 'both' ? ['light', 'dark'] : [mode];
const result = spawnSync('python3', [path.join(here, 'shoot-workbench.py'), pathToFileURL(html).href, ...themes], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
