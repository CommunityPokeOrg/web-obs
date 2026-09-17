# OBS for Web

A browser-based, OBS-style live production studio: real-time canvas
compositing, scene/source management, remote control over WebSocket (with a
zero-infrastructure BroadcastChannel fallback), a cross-platform screen
capture daemon, a control CLI, and pluggable stream outputs.

```
┌─────────────┐   WS /ws    ┌──────────────┐   WS     ┌────────────────┐
│ Studio app  │◄───────────►│ relay server │◄────────►│ remote UI /    │
│ (index.html)│  state/cmd  │ (server/)    │          │ control CLI    │
│             │             │              │          └────────────────┘
│ canvas +    │             │  /bridge:    │          ┌────────────────┐
│ compositor ─┼────────────►│  webm record │          │ capture daemon │
│             │   frames    │  + RTMP out  │◄────────►│ (tools/capture)│
└─────────────┘             └──────────────┘  JPEG    └────────────────┘
       ▲                          ▲
       │ remote feed frames (JPEG, role=viewer on /ws)
       └──────────────────────────────────────────────┘
```

## Quickstart

```bash
npm install
cp .env.example .env        # optional; defaults work out of the box
npm run dev                 # studio UI → http://localhost:5173/
npm run server              # optional: relay server on :8480 (prints token if unset)
```

- Studio: `http://localhost:5173/`
- Remote UI: `http://localhost:5173/remote.html` (same-browser control works
  with **no server** via BroadcastChannel; cross-device control uses the relay)
- Production build: `npm run build` → `dist/` (the relay serves it statically
  when present, so `npm run server` alone can host a built app).

### Try it end-to-end without any hardware

```bash
npm run server                                   # terminal 1
node tools/capture.mjs --token dev-token --mock  # terminal 2: fake feed
# in the studio: Add source → "Remote feed" → pick the announced feed
node tools/control.mjs --token dev-token status  # terminal 3: remote control
```

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server (studio + remote pages) |
| `npm run build` | typecheck + production build → `dist/` |
| `npm run preview` | serve the built app |
| `npm test` | vitest: 80 unit + integration tests |
| `npm run lint` | eslint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run server` | relay server (control mux, capture fan-out, /bridge ingest, static dist) |

## Studio features

- **Compositing canvas** — 1280×720@30 program output rendered on a
  `<canvas>`: source order, visibility, per-item transforms, cut/fade
  transitions, transient overlays.
- **Sources**: `webcam`/`screen` (getUserMedia/getDisplayMedia), `media` and
  `image` (local files), `text`, `color`, `browser` (DOM overlay — see
  limitations), `remote` (capture-daemon feeds).
- **Audio mixer** — per-source volume/mute with live RMS meters, local
  monitor toggle (off by default), mixed track injected into output streams.
- **Overlays** — named timed banners, triggerable locally or remotely.
- **Studio mode** — preview + program scenes with CUT/FADE transitions.

## Remote control

Same protocol everywhere — remote web UI (`remote.html`), CLI
(`tools/control.mjs`), or your own client:

```bash
node tools/control.mjs --token $WEB_OBS_TOKEN status
node tools/control.mjs --token $WEB_OBS_TOKEN scenes
node tools/control.mjs --token $WEB_OBS_TOKEN scene "Be Right Back"
node tools/control.mjs --token $WEB_OBS_TOKEN transition fade
node tools/control.mjs --token $WEB_OBS_TOKEN hide Webcam
node tools/control.mjs --token $WEB_OBS_TOKEN volume Webcam 40
node tools/control.mjs --token $WEB_OBS_TOKEN mute Webcam
node tools/control.mjs --token $WEB_OBS_TOKEN overlay Announcement
node tools/control.mjs --token $WEB_OBS_TOKEN output record start
node tools/control.mjs --token $WEB_OBS_TOKEN watch
```

`--server` defaults to `ws://localhost:8480/ws`; `--room` defaults to
`default`. Names are resolved case-insensitively against the live state
snapshot.

### Transports

| Transport | When to use | Auth |
| --- | --- | --- |
| Relay server `/ws` | cross-device control, capture feeds | shared `WEB_OBS_TOKEN` |
| BroadcastChannel | same-browser tabs, zero infra | token (same-origin trust boundary) |

## Capture daemon

`tools/capture.mjs` publishes a local screen/window as an MJPEG feed over the
relay; the studio consumes it as a `remote` source.

```bash
node tools/capture.mjs --token dev-token --fps 10         # auto-detect backend
node tools/capture.mjs --list                             # show detected backend
node tools/capture.mjs --backend x11 --display :0         # force a backend
node tools/capture.mjs --window "My App"                  # window region (needs xdotool)
node tools/capture.mjs --mock                             # test pattern, no display/ffmpeg
```

| Platform | Backend | Requirements |
| --- | --- | --- |
| Linux X11 | `ffmpeg -f x11grab` | ffmpeg; `--window` also needs `xdotool` |
| Linux Wayland (wlroots) | `grim` per-frame | grim; GNOME/KDE portal capture is **not** supported — use a browser `screen` source |
| macOS | `ffmpeg -f avfoundation` | ffmpeg (`brew install ffmpeg`); grant Screen Recording permission; `--device N` picks the screen index |
| Windows | `ffmpeg -f gdigrab` | ffmpeg |
| any | `mock` | nothing — embedded test pattern |

The feed is preview-grade MJPEG over WS (~5–15 fps): great for remote monitor
feeds inside the studio; not contribution quality. For high-quality remote
contribution, point the studio's WHIP output at MediaMTX/similar instead.

## Outputs

| Output | Adapter | Infrastructure |
| --- | --- | --- |
| Local record | MediaRecorder → `.webm` download | none — works everywhere |
| Bridge | MediaRecorder chunks → relay `/bridge` | `npm run server`; records WebM, and remuxes to `RTMP_URL` via ffmpeg when set |
| WHIP | `RTCPeerConnection` non-trickle SDP | any WHIP endpoint (MediaMTX, Cloudflare Stream, …) via `VITE_WHIP_URL` |

Unavailable adapters surface a reason in the UI instead of failing — set the
env vars in `.env` (see `.env.example`) or URL params (`?ws=…&token=…&room=…`).

## Testing

```bash
npm test        # 80 tests: engine, protocol, commands, layout, compositor,
                # host↔client over BroadcastChannel, real relay server
                # integration (auth, cmd/ack relay, capture frame fan-out),
                # CLI arg/command/backend matrix, JPEG splitting.
```

## Layout

```
src/core/       engine + protocol + commands (pure TS, testable)
src/compositor/ canvas renderer (Draw2D interface → stubbed in tests)
src/sources/    media source manager + WebAudio mixer + remote-feed receiver
src/streaming/  recorder / bridge / WHIP adapters + OutputManager
src/remote/     transports, studio-side host, controller client
src/ui/         studio app · src/remote-ui/  remote controller app
server/         Node relay (control mux, capture fan-out, /bridge ingest, dist static)
tools/          capture.mjs daemon, control.mjs CLI, lib/ helpers
shared/         protocol.js — the single source of truth for the wire protocol
tests/          vitest unit + integration
docs/           ARCHITECTURE.md — deep dive incl. security boundaries
```

## Known limitations (honest list)

- **Browser sources** render as DOM overlays in the local studio preview
  only. Cross-origin iframe pixels can't be drawn to canvas, so they are not
  in the program stream — a placeholder tile is composited instead.
- **No in-browser RTMP.** Browsers can't speak RTMP; use the `/bridge`
  adapter (server → ffmpeg → RTMP) or WHIP.
- **WHIP is non-trickle** (single-shot SDP) — no renegotiation mid-stream.
- **Capture daemon MJPEG** is preview-grade; Wayland support is wlroots-only
  (GNOME/KDE need portal APIs not implemented here).
- **Auth is a shared token** — LAN/dev grade. See ARCHITECTURE.md for the
  boundary and hardening notes.
- **Audio monitoring** can feedback-loop on webcam mics — hence off by default.
