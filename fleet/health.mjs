/*
 * What a node says about itself on every heartbeat, beyond "I am alive".
 *
 * The admin views render this as the node's health card, so a dead Tailscale,
 * a full disk, a laptop on 4% battery or a missing `devin` binary is visible
 * from the panel instead of discovered by SSHing in. Everything here is cheap
 * and bounded; anything slow (executor versions) is cached.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { cpus, freemem, homedir, loadavg, networkInterfaces, platform, totalmem, uptime } from 'node:os';
import { run } from './executors.mjs';

const VERSION_TTL_MS = 10 * 60_000;
const versionCache = new Map(); // bin → { at, value }

/** Services worth watching on every node unless the config says otherwise. */
export function defaultWatch() {
  return platform() === 'darwin'
    ? [{ name: 'Tailscale', process: 'tailscaled|Tailscale' }]
    : [{ name: 'Tailscale', systemd: 'tailscaled' }];
}

async function sh(cmd, args) {
  try {
    return await run(cmd, args);
  } catch {
    return { code: -1, stdout: '', stderr: '' };
  }
}

/** Free and total space on the volume that holds the worktrees. */
async function disk(path) {
  const res = await sh('df', ['-k', path]);
  const line = res.stdout.trim().split('\n')[1];
  if (!line) return null;
  const parts = line.split(/\s+/);
  const totalKb = Number(parts[1]);
  const freeKb = Number(parts[3]);
  if (!Number.isFinite(totalKb) || !Number.isFinite(freeKb)) return null;
  return { freeGb: +(freeKb / 1048576).toFixed(1), totalGb: +(totalKb / 1048576).toFixed(1) };
}

/** Battery charge and whether it is plugged in. null on a machine without one. */
async function battery() {
  if (platform() === 'darwin') {
    const res = await sh('pmset', ['-g', 'batt']);
    const percent = res.stdout.match(/(\d+)%/);
    if (!percent) return null;
    return { percent: Number(percent[1]), onPower: /AC Power/.test(res.stdout), charging: /charging;/.test(res.stdout) };
  }
  try {
    const bat = readdirSync('/sys/class/power_supply').find((d) => d.startsWith('BAT'));
    if (!bat) return null;
    const base = `/sys/class/power_supply/${bat}`;
    const status = readFileSync(`${base}/status`, 'utf8').trim();
    return { percent: Number(readFileSync(`${base}/capacity`, 'utf8').trim()), onPower: status !== 'Discharging', charging: status === 'Charging' };
  } catch {
    return null;
  }
}

/** One watched service: running or not, by process name, launchd label or systemd unit. */
async function service(watch) {
  if (watch.systemd) {
    const res = await sh('systemctl', ['is-active', watch.systemd]);
    const user = res.code === 0 ? res : await sh('systemctl', ['--user', 'is-active', watch.systemd]);
    return { name: watch.name, up: user.code === 0, detail: user.stdout.trim() || 'inactive' };
  }
  if (watch.launchd) {
    const uid = process.getuid?.() ?? 501;
    const res = await sh('launchctl', ['print', `gui/${uid}/${watch.launchd}`]);
    const state = res.stdout.match(/\n\s*state = (\S+)/)?.[1];
    return { name: watch.name, up: state === 'running', detail: state ?? 'not loaded' };
  }
  if (watch.process) {
    const res = await sh('pgrep', ['-f', watch.process]);
    const pids = res.stdout.trim().split('\n').filter(Boolean);
    return { name: watch.name, up: pids.length > 0, detail: pids.length ? `pid ${pids[0]}` : 'not running' };
  }
  return { name: watch.name, up: false, detail: 'no check configured' };
}

/** Whether an executor binary runs, and its version. Cached. */
async function executorVersion(bin) {
  const hit = versionCache.get(bin);
  if (hit && Date.now() - hit.at < VERSION_TTL_MS) return hit.value;
  const res = await sh(bin, ['--version']);
  const value = res.code === 0 ? { ok: true, version: (res.stdout || res.stderr).trim().split('\n')[0].slice(0, 60) } : { ok: false, version: null };
  versionCache.set(bin, { at: Date.now(), value });
  return value;
}

/**
 * Memory headroom as a percentage. On macOS `freemem()` leaves out the file
 * cache and reads near zero on a healthy machine, so ask the kernel's own
 * pressure level instead.
 */
async function memFreePct() {
  if (platform() === 'darwin') {
    const res = await sh('sysctl', ['-n', 'kern.memorystatus_level']);
    const level = Number(res.stdout.trim());
    if (Number.isFinite(level) && res.code === 0) return level;
  } else {
    try {
      const available = Number(readFileSync('/proc/meminfo', 'utf8').match(/MemAvailable:\s+(\d+)/)?.[1]);
      if (Number.isFinite(available)) return Math.round((available * 1024 * 100) / totalmem());
    } catch {
      /* fall through */
    }
  }
  return Math.round((freemem() * 100) / totalmem());
}

/** How this process is kept alive. */
function supervisor() {
  if (process.env.INVOCATION_ID) return 'systemd';
  if (process.env.XPC_SERVICE_NAME && process.env.XPC_SERVICE_NAME !== '0') return 'launchd';
  return 'manual';
}

/**
 * The full report.
 * @param config - the node config (executors, watch list, worktree root).
 * @param state - `{ startedAt, lastError, version }` from the running node.
 */
export async function health(config, state) {
  const executors = {};
  for (const [name, ex] of Object.entries(config.executors)) {
    executors[name] = { bin: ex.bin, ...(await executorVersion(ex.bin)) };
  }
  const watch = config.watch ?? defaultWatch();
  const services = await Promise.all(watch.map(service));
  const tailscaleIp = Object.values(networkInterfaces())
    .flat()
    .find((i) => i?.family === 'IPv4' && i.address.startsWith('100.'))?.address ?? null;
  const [diskInfo, bat, memPct] = await Promise.all([
    disk(config.worktreeRoot.startsWith(homedir()) ? homedir() : config.worktreeRoot),
    battery(),
    memFreePct(),
  ]);

  return {
    at: Date.now(),
    system: {
      uptimeSec: Math.round(uptime()),
      load: loadavg().map((n) => +n.toFixed(2)),
      cpus: cpus().length,
      memFreePct: memPct,
      memTotalGb: +(totalmem() / 1073741824).toFixed(1),
      disk: diskInfo,
      battery: bat,
      tailscaleIp,
    },
    process: {
      pid: process.pid,
      version: state.version,
      node: process.version,
      supervisor: supervisor(),
      uptimeSec: Math.round((Date.now() - state.startedAt) / 1000),
      lastError: state.lastError,
    },
    executors,
    services,
  };
}
