/*
 * Shrink a Harness session log that the Admin panel flooded with `/admin …`
 * commands (before the loopback bridge, every poll was logged with its full
 * JSON result). Panel traffic — `api`, `localinfo`, `open`, `hello`, `bridge` —
 * keeps its `command/run` / `command/done` events, so every seq stays where it
 * was, but the result text becomes a short stub. Commands typed by a person
 * are untouched. The original is kept beside the log as `*.bak-<time>`.
 *
 * The log is a chain of independent, checksummed Zstandard frames, and the
 * Harness requires the first frame to hold exactly the header line. So the
 * frames are kept as they are: each is decoded on its own, rewritten line by
 * line, and re-encoded the way the Harness writes them; a frame with nothing
 * to stub keeps its original bytes.
 *
 * Quit the Harness first: it holds the session open and would write over it.
 *
 *   node packages/dsh-admin/slim-session.mjs <session dir> [--dry-run]
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { constants, zstdCompressSync, zstdDecompressSync } from 'node:zlib';

const PANEL_VERBS = new Set(['api', 'localinfo', 'open', 'hello', 'bridge']);
const ZSTD_MAGIC = 0xfd2fb528;
const CHECKSUMMED = { params: { [constants.ZSTD_c_checksumFlag]: 1 } };
const MIB = 1024 * 1024;

const [dir, flag] = process.argv.slice(2);
const dryRun = flag === '--dry-run';
const log = dir && resolve(dir, 'session.v4.jsonl.zstd');
if (!log || !existsSync(log)) {
  console.error('Usage: node slim-session.mjs <session dir> [--dry-run]');
  process.exit(1);
}

/** Frame ranges, read from the frame and block headers (as the Harness does). */
function frames(buffer) {
  const out = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error(`no frame magic at byte ${offset}`);
    const descriptor = buffer.readUInt8(offset + 4);
    const sizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const dictionaryBytes = [0, 1, 2, 4][descriptor & 3];
    const sizeBytes = sizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << sizeFlag;
    offset += 5 + (singleSegment ? 0 : 1) + dictionaryBytes + sizeBytes;
    for (;;) {
      const header = buffer.readUIntLE(offset, 3);
      offset += 3 + (((header >>> 1) & 3) === 1 ? 1 : header >>> 3);
      if (header & 1) break;
    }
    if (descriptor & 4) offset += 4;
    if (offset > buffer.length) throw new Error(`torn frame at byte ${start}`);
    out.push(buffer.subarray(start, offset));
  }
  return out;
}

const original = readFileSync(log);
const panelIds = new Set();
let stubbed = 0;
let before = 0;
let after = 0;
const rewritten = frames(original).map((frame) => {
  const text = zstdDecompressSync(frame).toString('utf8');
  let changed = false;
  const lines = text.split('\n').map((line) => {
    if (line.length === 0) return line;
    const event = JSON.parse(line);
    const data = event.data ?? {};
    if (event.type === 'command/run' && data.name === 'admin' && PANEL_VERBS.has(String(data.args ?? '').trim().split(/\s+/)[0])) {
      panelIds.add(data.commandId);
    }
    if (event.type === 'command/done' && panelIds.has(data.commandId) && typeof data.text === 'string' && data.text.length > 64) {
      stubbed += 1;
      changed = true;
      return JSON.stringify({ ...event, data: { ...data, text: `[admin panel result, ${data.text.length} chars, removed]` } });
    }
    return line;
  });
  const slim = lines.join('\n');
  before += text.length;
  after += slim.length;
  return changed ? zstdCompressSync(Buffer.from(slim, 'utf8'), CHECKSUMMED) : frame;
});

const output = Buffer.concat(rewritten);
console.log(`${panelIds.size} panel command(s), ${stubbed} result(s) stubbed, ${rewritten.length} frame(s)`);
console.log(`uncompressed ${(before / MIB).toFixed(1)} MiB → ${(after / MIB).toFixed(1)} MiB; file ${(original.length / MIB).toFixed(1)} MiB → ${(output.length / MIB).toFixed(1)} MiB`);

// The Harness's own checks: same frame count, a one-line header frame, and
// every frame decodable on its own.
const check = frames(output);
const header = zstdDecompressSync(check[0]).toString('utf8');
if (check.length !== rewritten.length || header.indexOf('\n') !== header.length - 1) throw new Error('Rewritten log failed validation; nothing written.');
for (const frame of check) zstdDecompressSync(frame);

if (dryRun || stubbed === 0) process.exit(0);
const backup = `${log}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
copyFileSync(log, backup);
writeFileSync(log, output);
console.log(`wrote ${log}; backup ${backup}`);
