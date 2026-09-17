#!/usr/bin/env node
/**
 * web-obs capture daemon — publishes a local screen/window as a low-latency
 * MJPEG-over-WebSocket feed into a web-obs room, where the studio attaches it
 * as a "remote" source.
 *
 *   node tools/capture.mjs --server ws://localhost:8480/ws --room default \
 *     --token $WEB_OBS_TOKEN [--feed my-screen] [--fps 10]
 *
 * Backends (auto-detected, override with --backend):
 *   linux/x11      ffmpeg x11grab on $DISPLAY
 *   linux/wayland  `grim` on wlroots compositors (sway etc.) — one screenshot
 *                  per frame. GNOME/KDE Wayland require xdg-desktop-portal and
 *                  are NOT supported here — use a browser "screen" source or
 *                  the WebRTC/WHIP output instead.
 *   macos          ffmpeg avfoundation (grant Screen Recording permission)
 *   windows        ffmpeg gdigrab
 *   mock           embedded test pattern — no display or ffmpeg needed,
 *                  for CI and protocol/integration testing.
 *
 * MJPEG-over-WS is a preview-grade transport (cheap, robust, ~5-15 fps).
 * It is not contribution-quality — see docs/ARCHITECTURE.md.
 */
import { spawn, spawnSync } from 'node:child_process';
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { connectWs } from './lib/node-client.mjs';
import { JpegSplitter } from './lib/jpeg.mjs';

/** Tiny valid JPEG test frame, embedded so --mock needs zero native tools. */
const MOCK_JPEG_B64 =
  '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';

export const MOCK_FRAME = Buffer.from(MOCK_JPEG_B64, 'base64');

export const USAGE = `Usage: node tools/capture.mjs [options]

  --server <url>     relay ws endpoint (default ws://localhost:8480/ws)
  --room <name>      room to publish into (default "default")
  --token <token>    shared secret (or WEB_OBS_TOKEN env)
  --feed <id>        feed id/label (default "<hostname>-screen")
  --fps <n>          frames per second (default 10)
  --quality <1-31>   mjpeg quality, lower=better (default 5)
  --backend <id>     force backend: x11|grim|avfoundation|gdigrab|mock
  --window <title>   capture a window region (x11: needs xdotool; win: gdigrab title)
  --display <disp>   X11 display (default $DISPLAY or :0)
  --device <n>       avfoundation screen device index (macOS, default 1)
  --list             list detected backends and exit
  --dry-run          print the resolved capture command and exit
  --mock             shorthand for --backend mock
`;

// ── argument parsing ─────────────────────────────────────────────────────

export function parseArgs(argv) {
  const opts = {
    server: 'ws://localhost:8480/ws',
    room: 'default',
    token: process.env.WEB_OBS_TOKEN ?? '',
    feed: `${hostname()}-screen`,
    fps: 10,
    quality: 5,
    backend: null,
    window: null,
    display: null,
    device: 1,
    list: false,
    dryRun: false,
    mock: false,
    help: false,
  };
  const args = [...argv];
  while (args.length) {
    const a = args.shift();
    const take = () => {
      if (!args.length) throw new Error(`${a} needs a value`);
      return args.shift();
    };
    switch (a) {
      case '--server': opts.server = take(); break;
      case '--room': opts.room = take(); break;
      case '--token': opts.token = take(); break;
      case '--feed': opts.feed = take(); break;
      case '--fps': opts.fps = Number(take()); break;
      case '--quality': opts.quality = Number(take()); break;
      case '--backend': opts.backend = take(); break;
      case '--window': opts.window = take(); break;
      case '--display': opts.display = take(); break;
      case '--device': opts.device = Number(take()); break;
      case '--list': opts.list = true; break;
      case '--dry-run': opts.dryRun = true; break;
      case '--mock': opts.mock = true; break;
      case '-h': case '--help': opts.help = true; break;
      default: throw new Error(`unknown option ${a}`);
    }
  }
  if (!(opts.fps > 0 && opts.fps <= 60)) throw new Error('--fps must be 1..60');
  return opts;
}

// ── backend selection ────────────────────────────────────────────────────

export function hasBin(name, which = defaultWhich) {
  return which(name);
}

function defaultWhich(name) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim().length > 0;
}

/**
 * Choose a capture backend. `env` is injectable for tests:
 *   { platform, sessionType, display, has(bin) }
 * Returns { id, describe, spawn() -> child_process } or throws with reasons.
 */
export function selectBackend(env) {
  const { platform, sessionType, display, has } = env;
  const wins = env.window;

  const candidates = [];

  if (platform === 'linux' || platform === 'freebsd') {
    if (sessionType !== 'wayland' && display) {
      candidates.push({
        id: 'x11',
        available: has('ffmpeg') && (!wins || has('xdotool')),
        reason: !has('ffmpeg') ? 'ffmpeg not installed' : wins && !has('xdotool') ? 'xdotool needed for --window' : null,
        describe: () => `x11grab on ${display}${wins ? ` window "${wins}"` : ''}`,
      });
    }
    if (sessionType === 'wayland') {
      candidates.push({
        id: 'grim',
        available: has('grim'),
        reason: has('grim') ? null : 'grim not found (wlroots only)',
        describe: () => 'grim per-frame (wlroots Wayland)',
      });
    }
  } else if (platform === 'darwin') {
    candidates.push({
      id: 'avfoundation',
      available: has('ffmpeg'),
      reason: has('ffmpeg') ? null : 'ffmpeg not installed (brew install ffmpeg)',
      describe: () => `avfoundation screen ${env.device ?? 1} (grant Screen Recording permission)`,
    });
  } else if (platform === 'win32') {
    candidates.push({
      id: 'gdigrab',
      available: has('ffmpeg'),
      reason: has('ffmpeg') ? null : 'ffmpeg not installed',
      describe: () => (wins ? `gdigrab window "${wins}"` : 'gdigrab desktop'),
    });
  }

  candidates.push({ id: 'mock', available: true, reason: null, describe: () => 'embedded test pattern' });

  const forced = env.force;
  const pick = forced
    ? candidates.find((c) => c.id === forced)
    : candidates.find((c) => c.available);

  if (!pick) {
    const why = candidates
      .map((c) => `  - ${c.id}: ${c.available ? 'available' : c.reason}`)
      .join('\n');
    throw new Error(`no capture backend for ${platform}/${sessionType ?? 'x11'}:\n${why}`);
  }
  if (!pick.available) {
    throw new Error(`forced backend ${pick.id} unavailable: ${pick.reason}`);
  }
  return pick;
}

/** ffmpeg argv for stream-producing backends (frames to stdout as mjpeg). */
export function ffmpegArgs(backendId, opts, display) {
  const fps = String(opts.fps);
  const q = String(opts.quality);
  const out = ['-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', q, 'pipe:1'];
  switch (backendId) {
    case 'x11': {
      const inp = display ?? ':0';
      const geom = opts.window ? resolveWindowGeometry(opts.window, inp) : null;
      const base = ['-f', 'x11grab', '-framerate', fps];
      const spec = geom
        ? [...base, '-video_size', `${geom.width}x${geom.height}`, '-i', `${inp}+${geom.x},${geom.y}`]
        : [...base, '-i', inp];
      return [...spec, ...out];
    }
    case 'avfoundation':
      return ['-f', 'avfoundation', '-framerate', fps, '-capture_cursor', '1', '-i', `${opts.device}:none`, ...out];
    case 'gdigrab':
      return ['-f', 'gdigrab', '-framerate', fps, '-i', opts.window ? `title=${opts.window}` : 'desktop', ...out];
    case 'mock':
      return ['-f', 'lavfi', '-i', `testsrc2=size=640x360:rate=${fps}`, ...out];
    default:
      throw new Error(`backend ${backendId} does not use ffmpeg`);
  }
}

function resolveWindowGeometry(title, display) {
  const r = spawnSync('xdotool', ['search', '--name', title], { encoding: 'utf8', env: { ...process.env, DISPLAY: display } });
  const wid = r.stdout?.trim().split('\n').pop();
  if (r.status !== 0 || !wid) throw new Error(`no window matching "${title}" on ${display}`);
  const g = spawnSync('xdotool', ['getwindowgeometry', '--shell', wid], { encoding: 'utf8' });
  const m = Object.fromEntries(
    g.stdout.split('\n').map((l) => l.split('=')).filter((p) => p.length === 2),
  );
  return { x: +m.X, y: +m.Y, width: +m.WIDTH, height: +m.HEIGHT };
}

/** Frame producer for grim (wlroots): one `grim -t jpeg -` per frame. */
export function* grimDelays(fps) {
  yield Math.max(16, Math.round(1000 / fps));
}

// ── daemon ───────────────────────────────────────────────────────────────

export async function runCapture(opts, deps = {}) {
  const log = deps.log ?? ((...a) => console.log('[capture]', ...a));
  const env = {
    platform: deps.platform ?? process.platform,
    sessionType: deps.sessionType ?? process.env.XDG_SESSION_TYPE,
    display: deps.display ?? opts.display ?? process.env.DISPLAY,
    device: opts.device,
    window: opts.window,
    force: opts.backend ?? (opts.mock ? 'mock' : null),
    has: deps.has ?? ((b) => hasBin(b)),
  };
  const backend = selectBackend(env);

  if (opts.list || opts.dryRun) {
    log(`backend: ${backend.id} (${backend.describe()})`);
    if (backend.id !== 'grim' && backend.id !== 'mock-embedded') {
      log(`ffmpeg ${ffmpegArgs(backend.id, opts, env.display).join(' ')}`);
    }
    return 0;
  }

  const { ws } = await connectWs({
    url: opts.server,
    role: 'capture',
    room: opts.room,
    token: opts.token,
    extra: { feedId: opts.feed, label: opts.feed },
  });
  log(`connected feed=${opts.feed} room=${opts.room} backend=${backend.id}`);

  let frames = 0;
  const stats = setInterval(() => log(`sent ${frames} frames`), 5000);
  stats.unref?.();

  const OPEN = ws.constructor.OPEN ?? 1; // ws.OPEN is a static, not per-instance
  const send = (frame) => {
    if (ws.readyState === OPEN) {
      ws.send(frame, { binary: true });
      frames++;
    }
  };

  let child = null;
  let grimTimer = null;
  let mockTimer = null;

  const stopProducers = () => {
    clearInterval(stats);
    if (grimTimer) clearInterval(grimTimer);
    if (mockTimer) clearInterval(mockTimer);
    child?.kill('SIGKILL');
  };
  ws.on('close', stopProducers);

  if (backend.id === 'mock') {
    // Prefer real ffmpeg for animated mock frames when present.
    if (env.has('ffmpeg')) {
      child = spawn('ffmpeg', ['-loglevel', 'error', ...ffmpegArgs('mock', opts)]);
      const splitter = new JpegSplitter();
      child.stdout.on('data', (chunk) => splitter.push(chunk).forEach(send));
      child.on('exit', (c) => log(`ffmpeg exited ${c}`));
    } else {
      // Zero-dependency embedded frame (static image at --fps cadence).
      const interval = Math.max(16, Math.round(1000 / opts.fps));
      mockTimer = setInterval(() => send(MOCK_FRAME), interval);
    }
  } else if (backend.id === 'grim') {
    const interval = Math.max(16, Math.round(1000 / opts.fps));
    grimTimer = setInterval(() => {
      const g = spawn('grim', ['-t', 'jpeg', '-']);
      const chunks = [];
      g.stdout.on('data', (d) => chunks.push(d));
      g.on('close', (c) => {
        if (c === 0) send(Buffer.concat(chunks));
      });
    }, interval);
  } else {
    child = spawn('ffmpeg', ['-loglevel', 'error', ...ffmpegArgs(backend.id, opts, env.display)]);
    const splitter = new JpegSplitter();
    child.stdout.on('data', (chunk) => splitter.push(chunk).forEach(send));
    child.stderr.on('data', (d) => log(`ffmpeg: ${d.toString().trim()}`));
    child.on('exit', (c) => {
      log(`ffmpeg exited ${c}`);
      ws.close();
    });
  }

  const shutdown = () => {
    stopProducers();
    ws.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return { ws, frames: () => frames };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    console.error(USAGE);
    process.exit(2);
  }
  if (opts.help) {
    console.log(USAGE);
    process.exit(0);
  }
  if (!opts.token && !opts.list && !opts.dryRun) {
    console.error('missing --token (or WEB_OBS_TOKEN env)');
    process.exit(2);
  }
  runCapture(opts).then((r) => {
    if (typeof r === 'number') process.exit(r);
  }).catch((e) => {
    console.error(`[capture] ${e.message}`);
    process.exit(1);
  });
}
