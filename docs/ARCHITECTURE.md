# Architecture

OBS for Web is four components on one shared wire protocol:

| Component | Path | Runtime |
| --- | --- | --- |
| Studio app | `src/` → `index.html` | browser |
| Remote controller UI | `src/remote-ui/` → `remote.html` | browser |
| Relay server | `server/server.mjs` | Node ≥ 18, `ws` |
| CLI tools | `tools/capture.mjs`, `tools/control.mjs` | Node ≥ 18, `ws` |
| Wire protocol | `shared/protocol.js` (+ `.d.ts`) | all of the above |

Everything speaks the same JSON protocol from `shared/protocol.js` — plain
ESM with zero dependencies so browsers, the server, and the CLIs all import
it directly. The `.d.ts` gives it TypeScript types.

## Studio core

```
StudioEngine (core/studio.ts)
├─ scenes[] ── items[] → transform, visible, sourceId
├─ sources{}  registry: webcam|screen|media|image|text|color|browser|remote
├─ previewSceneId / programSceneId + transition{cut|fade,progress}
├─ overlays[] (timed)
└─ outputs[] (recorded externally by OutputManager)
```

- **Pure state machine.** The engine holds state and validates mutations;
  it touches no DOM, no network, no timers. `tick(now)` advances transition
  progress — rendering and ticking are driven by the caller's RAF loop.
- **Commands** (`core/commands.ts`): every state mutation — from local UI,
  remote UI, or CLI — funnels through `applyCommand(engine, cmd, deps)`.
  Unknown ids/types raise `EngineError`/`CommandError`, which the remote
  layer turns into `ack {ok:false, error}` replies.
- **Compositor** (`compositor/compositor.ts`) draws a `StudioState` to any
  `Draw2D` context (a structural subset of `CanvasRenderingContext2D`, so
  tests stub it). Order: black clear → program scene items (back→front,
  transforms applied) → crossfade layer → timed overlays.

## Sources & audio

`MediaSourceManager` (`sources/manager.ts`) binds engine sources to real
media: `getUserMedia`/`getDisplayMedia` for webcam/screen, `URL.createObjectURL`
for files, `RemoteFeedReceiver` (`sources/remote-feed.ts`) for capture-daemon
JPEG frames (binary WS, `createImageBitmap`, exp-backoff reconnect).

`AudioMixer` (`sources/mixer.ts`): WebAudio graph per enabled source —
`MediaStream`/`MediaElement` source → gain → analyser (RMS meter) →
`MediaStreamDestination` (program audio) + optional monitor output (default
silent to avoid feedback).

## Remote control

Two transports implement the same `{send(string|binary), onData, onClose}`:

- **`WebSocketTransport`** — to the relay server.
- **`BroadcastChannelTransport`** — zero-server control between the studio
  tab and remote.html in the same browser.

**Host side** (`remote/host.ts`): `RemoteHost` listens on both transports.
Each `cmd` gets `applyCommand` → `ack`. Engine changes broadcast a throttled
`state` (default 150 ms) and a `feeds` announcement on change.

**Client side** (`remote/client.ts`, `tools/lib/node-client.mjs`):
`RemoteClient`/`ControlClient` — hello/welcome handshake, pending-ack map
keyed by command id with timeouts, latest `state` snapshot cache.

### Relay server (`server/server.mjs`)

One `ws` server, one room map: `{studio, controllers, feeds, viewers, lastState}`.

- `/ws` multiplexes four roles: `studio` (uplink), `controller`,
  `capture` (publishes a feedId + binary frames), `viewer` (subscribes to a
  feedId; receives frames).
- Server routes `cmd` → studio, `ack` → originating controller (by `cid`),
  `state` → all controllers + `lastState` cache (replayed to controllers
  joining after the fact), `feeds` → studio.
- `/bridge` is a second WS endpoint: authenticated, receives a MediaRecorder
  WebM stream → writes `recordings/*.webm`, and when `RTMP_URL` is set pipes
  through `ffmpeg -i pipe: -c copy -f flv $RTMP_URL`.
- Also serves `dist/` statically + `/health`.
- 30 s ping sweep, 5 s hello timeout, `close()` for tests.

## Protocol (`shared/protocol.js`)

```json
hello     {kind:"hello", v:1, role, room, token, label?/feedId?}
welcome   {kind:"welcome", role, room}
error     {kind:"error", code, message}
cmd       {kind:"cmd", id, cid, command:{type,...}}
ack       {kind:"ack", id, cid, ok, error?}
state     {kind:"state", snapshot}
feeds     {kind:"feeds", feeds:[{id,label}]}
```

Commands: `set_preview_scene`, `transition`, `set_item_visible`,
`set_item_transform`, `set_source_enabled`, `set_source_volume`,
`set_source_muted`, `set_text`, `trigger_overlay`, `set_output`.

Capture video is out-of-band: one JPEG per binary WS frame, relayed
capture→viewers without parsing.

## Security boundaries

- **Auth**: shared bearer token `WEB_OBS_TOKEN`, checked by the relay for
  every role and by the studio for BroadcastChannel peers. If unset, the
  server generates one and prints it — dev-grade only.
- **Boundary statement**: the token guards command authority and media
  ingest. Anything holding it can control the studio and inject feeds. There
  is no per-role authz (a token-holder can act as studio or controller) and
  no transport encryption — terminate TLS in front (`wss://`, reverse proxy)
  for any real deployment. Never expose the relay on the open internet
  without TLS + a real secret.
- **Command validation** happens at the engine (`applyCommand` whitelist) —
  unknown commands/errors come back as `ack{ok:false}`; a bad controller
  can't crash the studio.
- The studio holds the token in-memory only; URL-param config means it can
  appear in browser history — prefer `.env` for anything shared.

## Transport & output decisions

| Choice | Why | Trade-off |
| --- | --- | --- |
| MJPEG over WS for capture feeds | every frame independently decodable; trivial relay; works in tests without ffmpeg | bandwidth-heavy, preview-grade only |
| MediaRecorder chunks to `/bridge` | only spec'd way to get encoded video out of a browser | chunked WebM; server remuxes for RTMP |
| WHIP (non-trickle) | the standard-ish browser→server ingest | endpoint required; no mid-stream renegotiation |
| BroadcastChannel peer mode | the remote UI works with literally zero infrastructure | same-browser only |

## Platform capture matrix

| OS | backend | notes |
| --- | --- | --- |
| Linux/X11 | `x11grab` | `--window` needs `xdotool` |
| Linux/Wayland | `grim` (per frame) | wlroots only; GNOME/KDE portals unsupported |
| macOS | `avfoundation` | screen index via `--device`; TCC permission |
| Windows | `gdigrab` | `--window <title>` supported |
| any | `mock` | embedded test pattern — for CI/headless |

Backends are auto-detected (`selectBackend` checks `WAYLAND_DISPLAY`,
`DISPLAY`, `process.platform`, `which(ffmpeg)`); `--backend` forces one. The
mock is a real code path used by `capture.integration.test.ts`.

## Testing approach

- Core is pure TS → direct unit tests (engine, commands, layout, protocol).
- Compositor draws to a stub `Draw2D` recording call order.
- Host↔client tested over real `BroadcastChannel` (vitest node env has it).
- Relay tested for real: `createRelayServer` on `127.0.0.1:0`, real `ws`
  sockets, real `ControlClient` — covering hello timeout, token rejection,
  cmd/ack routing, lastState replay, and capture→viewer binary fan-out.
- CLI parsing (`parseArgs`, `buildCommand`, backend selection, `JpegSplitter`)
  covered without spawning processes.
