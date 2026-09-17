#!/usr/bin/env node
/**
 * web-obs remote-control CLI — drives a studio over the relay's control
 * channel. Same protocol as the remote web UI and any third-party client.
 *
 *   node tools/control.mjs --server ws://localhost:8480/ws --room default \
 *     --token $WEB_OBS_TOKEN <action> [args]
 *
 * Actions:
 *   status                        print studio snapshot summary
 *   watch                         live state stream (Ctrl-C to stop)
 *   scenes                        list scenes (P=program, p=preview)
 *   scene <id|name>               put scene on preview
 *   transition [cut|fade]         transition preview→program
 *   show|hide <source> [scene]    toggle a scene item (default: program)
 *   enable|disable <source>       master feed switch
 *   volume <source> <0-100>       source volume percent
 *   mute|unmute <source>          source mute
 *   text <source> <string>        set text/browser-source content
 *   overlay <id|name>             trigger an overlay
 *   transform <source> x y w h [scene]
 *   output <id> <start|stop>      start/stop an output (record|whip|bridge)
 *   raw '<json>'                  send an arbitrary command object
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ControlClient } from './lib/node-client.mjs';

const USAGE = `Usage: node tools/control.mjs [connection options] <action> [args]

Connection options:
  --server <url>   relay ws endpoint (default ws://localhost:8480/ws)
  --room <name>    room (default "default")
  --token <token>  shared secret (or WEB_OBS_TOKEN env)

Run without arguments to see the action list (read the file header or run
with --help).`;

export function parseArgs(argv) {
  const opts = {
    server: 'ws://localhost:8480/ws',
    room: 'default',
    token: process.env.WEB_OBS_TOKEN ?? '',
    help: false,
  };
  const rest = [];
  const args = [...argv];
  while (args.length) {
    const a = args.shift();
    switch (a) {
      case '--server': opts.server = args.shift(); break;
      case '--room': opts.room = args.shift(); break;
      case '--token': opts.token = args.shift(); break;
      case '-h': case '--help': opts.help = true; break;
      default: rest.push(a);
    }
  }
  if (!rest.length) throw new Error('missing action\n\n' + USAGE);
  opts.action = rest[0];
  opts.args = rest.slice(1);
  return opts;
}

// ── name/id resolution helpers ────────────────────────────────────────────

export function findScene(snap, ref) {
  return snap.scenes.find((s) => s.id === ref) ??
    snap.scenes.find((s) => s.name.toLowerCase() === String(ref).toLowerCase());
}

export function findSource(snap, ref) {
  return snap.sources.find((s) => s.id === ref) ??
    snap.sources.find((s) => s.name.toLowerCase() === String(ref).toLowerCase());
}

export function findOverlay(snap, ref) {
  return snap.overlays.find((o) => o.id === ref) ??
    snap.overlays.find((o) => o.name.toLowerCase() === String(ref).toLowerCase());
}

// ── command builder ───────────────────────────────────────────────────────

/**
 * Translate a CLI action + args against a state snapshot into a wire
 * Command. Pure & exported for tests.
 * @returns {{command: object} | {error: string}}
 */
export function buildCommand(action, args, snap) {
  const need = (n, what) => {
    if (args.length < n) throw new Error(`${action} needs ${what}`);
  };
  const src = (ref) => {
    const s = findSource(snap, ref);
    if (!s) throw new Error(`no source "${ref}"`);
    return s;
  };
  const sceneRef = (ref) => {
    if (ref === undefined) return undefined;
    const sc = findScene(snap, ref);
    if (!sc) throw new Error(`no scene "${ref}"`);
    return sc.id;
  };

  switch (action) {
    case 'scene': {
      need(1, 'a scene id or name');
      return { command: { type: 'set_preview_scene', sceneId: sceneRef(args[0]) } };
    }
    case 'transition':
      return { command: { type: 'transition', mode: args[0] === 'cut' ? 'cut' : 'fade' } };
    case 'show':
    case 'hide': {
      need(1, 'a source id or name');
      const s = src(args[0]);
      return {
        command: {
          type: 'set_item_visible',
          sourceId: s.id,
          sceneId: sceneRef(args[1]),
          visible: action === 'show',
        },
      };
    }
    case 'enable':
    case 'disable': {
      need(1, 'a source id or name');
      return { command: { type: 'set_source_enabled', sourceId: src(args[0]).id, enabled: action === 'enable' } };
    }
    case 'volume': {
      need(2, 'a source and 0-100');
      const v = Number(args[1]);
      if (!(v >= 0 && v <= 100)) throw new Error('volume must be 0-100');
      return { command: { type: 'set_source_volume', sourceId: src(args[0]).id, volume: v / 100 } };
    }
    case 'mute':
    case 'unmute': {
      need(1, 'a source id or name');
      return { command: { type: 'set_source_muted', sourceId: src(args[0]).id, muted: action === 'mute' } };
    }
    case 'text': {
      need(2, 'a source and text');
      return { command: { type: 'set_text', sourceId: src(args[0]).id, text: args.slice(1).join(' ') } };
    }
    case 'overlay': {
      need(1, 'an overlay id or name');
      const ov = findOverlay(snap, args[0]);
      if (!ov) throw new Error(`no overlay "${args[0]}"`);
      return { command: { type: 'trigger_overlay', overlayId: ov.id } };
    }
    case 'transform': {
      need(5, 'source x y w h');
      const [x, y, width, height] = args.slice(1, 5).map(Number);
      if ([x, y, width, height].some((n) => !Number.isFinite(n))) {
        throw new Error('transform values must be numbers');
      }
      return {
        command: {
          type: 'set_item_transform',
          sourceId: src(args[0]).id,
          sceneId: sceneRef(args[5]),
          transform: { x, y, width, height },
        },
      };
    }
    case 'output': {
      need(2, 'output id and start|stop');
      if (args[1] !== 'start' && args[1] !== 'stop') throw new Error('output action must be start|stop');
      return { command: { type: 'set_output', output: args[0], action: args[1] } };
    }
    case 'raw': {
      need(1, 'a JSON command');
      let c;
      try {
        c = JSON.parse(args[0]);
      } catch {
        throw new Error('raw needs valid JSON');
      }
      return { command: c };
    }
    default:
      throw new Error(`unknown action "${action}"`);
  }
}

/** Read-only actions that render state instead of sending a command. */
export function renderAction(action, args, snap) {
  switch (action) {
    case 'status': {
      const line = [];
      line.push(`canvas ${snap.canvas.width}x${snap.canvas.height}@${snap.canvas.fps}`);
      line.push(`scenes: ${snap.scenes.map((s) => `${s.name}${s.id === snap.programSceneId ? '[P]' : s.id === snap.previewSceneId ? '[p]' : ''}`).join('  ')}`);
      line.push(`sources: ${snap.sources.map((s) => `${s.name}(${s.kind}${s.enabled ? '' : ' DISABLED'})`).join('  ')}`);
      if (snap.transition) line.push(`transition: fade ${Math.round(snap.transition.progress * 100)}%`);
      return line.join('\n');
    }
    case 'scenes':
      return snap.scenes
        .map((s) => {
          const mark = s.id === snap.programSceneId ? 'P' : s.id === snap.previewSceneId ? 'p' : ' ';
          return `${mark} ${s.id}  ${s.name}  (${s.items.length} items)`;
        })
        .join('\n');
    default:
      return null;
  }
}

// ── main ──────────────────────────────────────────────────────────────────

export async function runControl(argv, deps = {}) {
  const log = deps.log ?? ((...a) => console.log(...a));
  const opts = parseArgs(argv);
  if (opts.help) {
    log(USAGE);
    return 0;
  }
  if (!opts.token) throw new Error('missing --token (or WEB_OBS_TOKEN env)');

  const client = new ControlClient({ url: opts.server, room: opts.room, token: opts.token });
  await client.connect();
  const snap = await client.nextState();

  if (opts.action === 'watch') {
    log(renderAction('status', [], snap));
    client.onState = (s) => log(`\n${renderAction('status', [], s)}`);
    await new Promise(() => {}); // until Ctrl-C
    return 0;
  }

  const rendered = renderAction(opts.action, opts.args, snap);
  if (rendered !== null) {
    log(rendered);
    client.close();
    return 0;
  }

  const { command } = buildCommand(opts.action, opts.args, snap);
  const ack = await client.sendCommand(command);
  client.close();
  if (!ack.ok) {
    log(`rejected: ${ack.error}`);
    return 1;
  }
  log('ok');
  return 0;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  runControl(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error(`[control] ${e.message}`);
      process.exit(1);
    });
}
