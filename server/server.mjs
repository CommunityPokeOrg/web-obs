/**
 * web-obs relay server — single Node process providing:
 *
 *   GET  /health          liveness probe → {"ok":true}
 *   GET  /                room/feed summary (debug)
 *   GET  /*               static files from dist/ when it exists
 *   WS   /ws              multiplexed control + capture channel
 *       role=studio       the studio uplink (one per room)
 *       role=controller   remote-control clients (UI remote or CLI)
 *       role=capture      capture daemon publishing JPEG frames (binary)
 *       role=viewer       studio-side receiver subscribing to one feed
 *   WS   /bridge          program-out media ingest: hello then binary WebM
 *                        chunks → recorded file (+ optional ffmpeg→RTMP)
 *
 * Auth: every hello carries `token`; it must equal WEB_OBS_TOKEN. This is
 * dev-grade shared-secret auth over localhost/LAN — see docs/ARCHITECTURE.md
 * "Security boundaries" before exposing it further.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { parseMessage, encode } from '../shared/protocol.js';

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function log(...args) {
  console.log(`[relay ${new Date().toISOString().slice(11, 19)}]`, ...args);
}

/**
 * @param {object} opts
 * @param {number} opts.port
 * @param {string} opts.token        shared secret; empty string → generate one
 * @param {string} [opts.rtmpUrl]    push program feed here via ffmpeg when set
 * @param {string} [opts.recordDir]  directory for bridge recordings
 * @param {string} [opts.staticDir]  directory to serve over HTTP (e.g. dist/)
 * @param {boolean} [opts.quiet]
 */
export function createRelayServer(opts) {
  const token = opts.token || crypto.randomBytes(12).toString('hex');
  const generatedToken = !opts.token;
  const recordDir = opts.recordDir || 'recordings';
  const staticDir = opts.staticDir;
  const quiet = !!opts.quiet;
  const say = (...a) => !quiet && log(...a);

  /** rooms: name → { studio, controllers:Map(cid→ws), feeds:Map(feedId→{ws,label}), viewers:Map(feedId→Set), lastState:string|null } */
  const rooms = new Map();
  const roomOf = (name) => {
    if (!rooms.has(name)) {
      rooms.set(name, { studio: null, controllers: new Map(), feeds: new Map(), viewers: new Map(), lastState: null });
    }
    return rooms.get(name);
  };

  function broadcastFeeds(room, roomName) {
    const msg = encode({
      kind: 'feeds',
      feeds: [...room.feeds.entries()].map(([id, f]) => ({ id, label: f.label })),
    });
    room.studio?.send(msg);
    for (const ws of room.controllers.values()) ws.send(msg);
    say(`room ${roomName}: feeds = [${[...room.feeds.keys()].join(', ')}]`);
  }

  // ── HTTP ────────────────────────────────────────────────────────────────
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          service: 'web-obs relay',
          rooms: [...rooms.entries()].map(([name, r]) => ({
            name,
            studio: !!r.studio,
            controllers: r.controllers.size,
            feeds: [...r.feeds.keys()],
          })),
        }),
      );
      return;
    }
    if (staticDir && req.method === 'GET') {
      const safe = path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, '');
      let file = path.join(staticDir, safe);
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      if (fs.existsSync(file)) {
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
        fs.createReadStream(file).pipe(res);
        return;
      }
    }
    res.writeHead(404);
    res.end('not found');
  });

  // ── WS /ws (control + capture mux) ──────────────────────────────────────
  const wss = new WebSocketServer({ noServer: true });
  let nextCid = 1;

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => (ws.isAlive = true));

    const helloTimer = setTimeout(() => ws.close(4000, 'no hello'), 5000);
    let role = null;
    let room = null;
    let roomName = null;
    let cid = null;
    let feedId = null;

    ws.on('message', (data, isBinary) => {
      // Binary frames only flow capture → viewers.
      if (isBinary) {
        if (role === 'capture' && room && feedId) {
          const viewers = room.viewers.get(feedId);
          if (viewers) for (const v of viewers) if (v.readyState === 1) v.send(data, { binary: true });
        }
        return;
      }
      const text = data.toString();
      if (!role) {
        const parsed = parseMessage(text);
        if (!parsed.ok || parsed.msg.kind !== 'hello') {
          ws.send(encode({ kind: 'error', code: 'handshake', message: 'expected hello' }));
          ws.close(4001, 'expected hello');
          return;
        }
        const h = parsed.msg;
        if (h.token !== token) {
          ws.send(encode({ kind: 'error', code: 'auth', message: 'bad token' }));
          ws.close(4003, 'bad token');
          return;
        }
        clearTimeout(helloTimer);
        role = h.role;
        roomName = h.room;
        room = roomOf(roomName);

        if (role === 'studio') {
          if (room.studio && room.studio.readyState === 1) {
            ws.send(encode({ kind: 'error', code: 'conflict', message: 'a studio is already attached' }));
            ws.close(4009, 'studio exists');
            return;
          }
          room.studio = ws;
        } else if (role === 'controller') {
          cid = `ctrl-${nextCid++}`;
          room.controllers.set(cid, ws);
          ws._needsLastState = true;
        } else if (role === 'capture') {
          feedId = h.feedId;
          room.feeds.set(feedId, { ws, label: h.label ?? feedId });
        } else if (role === 'viewer') {
          feedId = h.feedId;
          if (!room.viewers.has(feedId)) room.viewers.set(feedId, new Set());
          room.viewers.get(feedId).add(ws);
        }
        ws.send(encode({ kind: 'welcome', role, room: roomName }));
        if (ws._needsLastState && room.lastState) ws.send(room.lastState);
        say(`room ${roomName}: ${role} joined${feedId ? ` feed=${feedId}` : ''}`);
        if (role === 'capture' || role === 'studio' || role === 'controller') broadcastFeeds(room, roomName);
        return;
      }

      // Post-handshake messages.
      const parsed = parseMessage(text);
      if (!parsed.ok) {
        ws.send(encode({ kind: 'error', code: 'bad_message', message: parsed.error }));
        return;
      }
      const m = parsed.msg;
      if (role === 'controller' && m.kind === 'cmd') {
        if (!room.studio) {
          ws.send(encode({ kind: 'ack', id: m.id, ok: false, error: 'no studio attached' }));
          return;
        }
        room.studio.send(encode({ kind: 'cmd', id: m.id, cid, command: m.command }));
        return;
      }
      if (role === 'studio' && m.kind === 'ack') {
        const target = m.cid && room.controllers.get(m.cid);
        if (target) target.send(encode({ kind: 'ack', id: m.id, ok: m.ok, error: m.error }));
        return;
      }
      if (role === 'studio' && m.kind === 'state') {
        room.lastState = text;
        for (const c of room.controllers.values()) if (c.readyState === 1) c.send(text);
        return;
      }
    });

    ws.on('close', () => {
      clearTimeout(helloTimer);
      if (!room) return;
      if (role === 'studio' && room.studio === ws) {
        room.studio = null;
        say(`room ${roomName}: studio left`);
      } else if (role === 'controller' && cid) {
        room.controllers.delete(cid);
      } else if (role === 'capture' && feedId) {
        room.feeds.delete(feedId);
        room.viewers.get(feedId)?.forEach((v) => v.close(4000, 'feed ended'));
        room.viewers.delete(feedId);
        broadcastFeeds(room, roomName);
      } else if (role === 'viewer' && feedId) {
        room.viewers.get(feedId)?.delete(ws);
      }
    });
  });

  // ── WS /bridge (media ingest) ───────────────────────────────────────────
  const bridgeWss = new WebSocketServer({ noServer: true });
  let ffmpeg = null;

  bridgeWss.on('connection', (ws) => {
    let authed = false;
    let out = null;
    let outPath = null;

    const finalize = () => {
      out?.end();
      out = null;
      if (ffmpeg) {
        ffmpeg.stdin?.end();
      }
    };

    ws.on('message', (data, isBinary) => {
      if (!isBinary) {
        const parsed = parseMessage(data.toString());
        if (parsed.ok && parsed.msg.kind === 'hello' && parsed.msg.token === token) {
          authed = true;
          ws.send(encode({ kind: 'welcome', role: 'studio', room: parsed.msg.room ?? 'default' }));
          return;
        }
        ws.send(encode({ kind: 'error', code: 'auth', message: 'bad hello/token' }));
        ws.close(4003, 'auth');
        return;
      }
      if (!authed) return;
      if (!out) {
        fs.mkdirSync(recordDir, { recursive: true });
        outPath = path.join(recordDir, `web-obs-${Date.now()}.webm`);
        out = fs.createWriteStream(outPath);
        say(`bridge: recording → ${outPath}`);
        if (opts.rtmpUrl) {
          ffmpeg = spawn('ffmpeg', [
            '-y', '-loglevel', 'warning', '-i', 'pipe:0',
            '-c:v', 'libx264', '-preset', 'veryfast', '-g', '60',
            '-c:a', 'aac', '-b:a', '128k', '-f', 'flv', opts.rtmpUrl,
          ]);
          ffmpeg.stderr.on('data', (d) => say(`ffmpeg: ${d.toString().trim()}`));
          ffmpeg.on('exit', (code) => {
            say(`ffmpeg exited ${code}`);
            ffmpeg = null;
          });
          say(`bridge: restreaming → ${opts.rtmpUrl.replace(/\/[^/]*$/, '/<key>')}`);
        }
      }
      out.write(data);
      ffmpeg?.stdin?.write(data);
    });

    ws.on('close', () => {
      finalize();
      if (outPath) say(`bridge: closed ${outPath}`);
    });
  });

  server.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (pathname === '/ws') wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    else if (pathname === '/bridge') bridgeWss.handleUpgrade(req, socket, head, (ws) => bridgeWss.emit('connection', ws, req));
    else socket.destroy();
  });

  // Liveness sweep — drop dead sockets.
  const sweep = setInterval(() => {
    for (const ws of [...wss.clients, ...bridgeWss.clients]) {
      if (ws.isAlive === false) ws.terminate();
      else {
        ws.isAlive = false;
        ws.ping();
      }
    }
  }, 30000);
  sweep.unref();

  return new Promise((resolve) => {
    server.listen(opts.port ?? 8480, () => {
      const port = server.address().port;
      resolve({
        port,
        token,
        generatedToken,
        url: `ws://localhost:${port}`,
        close: () =>
          new Promise((r) => {
            clearInterval(sweep);
            ffmpeg?.kill('SIGKILL');
            for (const ws of [...wss.clients, ...bridgeWss.clients]) ws.terminate();
            server.closeAllConnections?.();
            server.close(() => r());
          }),
      });
    });
  });
}

// ── direct execution ──────────────────────────────────────────────────────
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const port = Number(process.env.WEB_OBS_PORT ?? 8480);
  const staticDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
  createRelayServer({
    port,
    token: process.env.WEB_OBS_TOKEN ?? '',
    rtmpUrl: process.env.RTMP_URL || undefined,
    recordDir: process.env.RECORD_DIR || 'recordings',
    staticDir: fs.existsSync(staticDir) ? staticDir : undefined,
  }).then((srv) => {
    log(`listening on :${srv.port}`);
    log(`endpoints: ws://<host>:${srv.port}/ws  ws://<host>:${srv.port}/bridge`);
    if (srv.generatedToken) {
      log(`generated dev token (set WEB_OBS_TOKEN to fix it): ${srv.token}`);
      log(`studio URL: http://localhost:5173/?ws=ws://localhost:${srv.port}/ws&token=${srv.token}`);
    }
    if (process.env.RTMP_URL) log(`bridge restream: rtmp configured`);
  });
}
