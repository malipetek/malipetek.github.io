/**
 * Live proof that an external ACP agent can receive an image.
 *
 * Part 1 — a turn with an image and a question about it. The image is a solid
 * red square generated here, so a correct answer can only come from the agent
 * having received the pixels.
 *
 * Part 2 — an **image-only** turn, with no caption at all. That is the case the
 * adapter used to treat as "no request" and answer with nothing.
 *
 *   node test/images-live.mjs devin acp
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AcpConnection, buildEnv } from '../index.js';
import { AcpModelAdapter } from '../llm-adapter.js';

const command = process.argv[2] ?? 'devin';
const args = process.argv.slice(3);
const workspace = mkdtempSync(join(tmpdir(), 'dsh-images-'));
const pngPath = join(workspace, 'red.png');
execFileSync('python3', ['-c', `
from PIL import Image
Image.new('RGB', (64, 64), (220, 20, 20)).save(${JSON.stringify(pngPath)})
`]);
const image = { type: 'image', data: readFileSync(pngPath).toString('base64'), mimeType: 'image/png' };

const connection = new AcpConnection({
  id: command, label: command, command, args, cwd: workspace,
  env: buildEnv('minimal', {}), timeoutMs: 180_000, catalogueTimeoutMs: 60_000, approval: 'allow',
});
const adapter = new AcpModelAdapter({
  connection,
  provider: `acp-${command}`,
  label: command,
  approvalPolicy: 'allow',
  resolveSessionKey: () => 'images-live',
  resolveCwd: () => workspace,
  // The attachment store is the harness's; here the bytes are already in hand.
  resolveImage: () => ({ data: image.data, mimeType: 'image/png' }),
  note: (line) => console.log(`  [note] ${line}`),
  logger: { warn: (line) => console.log(`  [warn] ${line}`), debug: () => {} },
});

/** One turn. @param messages - harness messages. */
async function turn(messages) {
  let text = '';
  for await (const chunk of adapter.stream({ provider: `acp-${command}`, messages })) {
    if (chunk.type === 'text-delta') text += chunk.text;
  }
  return text.trim();
}

try {
  console.log('Part 1 — image plus a question:');
  const withText = await turn([{
    role: 'user',
    content: [
      { type: 'text', text: 'What is the dominant colour of this image? Reply with one word.' },
      { type: 'image', attachment: { attachmentId: 'probe', mediaType: 'image/png' } },
    ],
  }]);
  console.log(`  reply: ${JSON.stringify(withText.slice(0, 120))}`);
  const part1 = /red|crimson|scarlet/i.test(withText);

  console.log('\nPart 2 — image only, no caption:');
  const imageOnly = await turn([{
    role: 'user',
    content: [{ type: 'image', attachment: { attachmentId: 'probe', mediaType: 'image/png' } }],
  }]);
  console.log(`  reply: ${JSON.stringify(imageOnly.slice(0, 120))}`);
  const part2 = imageOnly.length > 0;

  console.log(`\npart 1 (image received): ${part1 ? 'PASS' : 'FAIL'}`);
  console.log(`part 2 (image-only turn answered): ${part2 ? 'PASS' : 'FAIL'}`);
  console.log(part1 && part2 ? '\nRESULT: PASS' : '\nRESULT: FAIL');
} catch (error) {
  console.log(`\nRESULT: FAIL — ${String(error?.message ?? error)}`);
} finally {
  connection.dispose();
  setTimeout(() => {
    try { rmSync(workspace, { recursive: true, force: true }); } catch { /* best effort */ }
    process.exit(0);
  }, 500);
}
