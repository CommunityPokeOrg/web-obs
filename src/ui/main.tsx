import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StudioEngine } from '../core/studio';
import { AudioMixer } from '../sources/mixer';
import { MediaSourceManager } from '../sources/manager';
import { Compositor } from '../compositor/compositor';
import { RemoteHost } from '../remote/host';
import { BroadcastChannelTransport, WebSocketTransport } from '../remote/transport';
import { OutputManager } from '../streaming/output';
import { LocalRecorderOutput } from '../streaming/recorder';
import { BridgeOutput } from '../streaming/bridge';
import { WhipOutput } from '../streaming/whip';
import { App } from './App';
import type { AppContext, StudioEnv } from './context';
import './styles.css';

function readEnv(): StudioEnv {
  const p = new URLSearchParams(location.search);
  const v = (k: string) => p.get(k) ?? (import.meta.env[k] as string | undefined) ?? null;
  return {
    controlUrl: v('ws') ?? v('VITE_CONTROL_WS_URL'),
    room: v('room') ?? v('VITE_ROOM') ?? 'default',
    token: v('token') ?? v('VITE_TOKEN') ?? 'dev-token',
    bridgeUrl: v('bridge') ?? v('VITE_BRIDGE_WS_URL'),
    whipUrl: v('whip') ?? v('VITE_WHIP_URL'),
  };
}

function defaultProject(engine: StudioEngine): void {
  const a = engine.addScene('Main Stage');
  engine.addSourceToScene(a.id, 'color', 'Backdrop', { fill: '#14161c' });
  engine.addSourceToScene(a.id, 'text', 'Title', {
    text: 'OBS for Web',
    fontSize: 72,
    color: '#ffffff',
  });
  const b = engine.addScene('Second Scene');
  engine.addSourceToScene(b.id, 'color', 'Backdrop', { fill: '#1d1712' });
  engine.addSourceToScene(b.id, 'text', 'Heading', { text: 'Second scene', fontSize: 48 });
  engine.addOverlay('Announcement', 'Stream starting soon', 5000);
  engine.setPreviewScene(a.id);
}

function bootstrap(): AppContext {
  const env = readEnv();
  const engine = new StudioEngine();
  defaultProject(engine);

  const mixer = new AudioMixer();
  // Mixer channel state follows engine audio state.
  engine.changed.subscribe((s) => {
    for (const src of s.sources) mixer.setChannel(src.id, src.audio.volume, src.audio.muted);
  });

  const sources = new MediaSourceManager(mixer, (feedId) => ({
    url: env.controlUrl!,
    room: env.room,
    token: env.token,
    feedId,
  }));

  const canvas = document.createElement('canvas');
  canvas.width = engine.state.canvas.width;
  canvas.height = engine.state.canvas.height;
  const ctx2d = canvas.getContext('2d');
  if (!ctx2d) throw new Error('2d canvas unavailable');
  const compositor = new Compositor(engine, sources, ctx2d);
  compositor.start();

  const programStream = () => {
    const stream = canvas.captureStream(engine.state.canvas.fps);
    const audio = mixer.outputTrack();
    if (audio) stream.addTrack(audio);
    return stream;
  };

  const outputs = new OutputManager([
    new LocalRecorderOutput(),
    new BridgeOutput(env.bridgeUrl ? { url: env.bridgeUrl, room: env.room, token: env.token } : null),
    new WhipOutput(
      env.whipUrl
        ? { url: env.whipUrl, token: (import.meta.env.VITE_WHIP_TOKEN as string | undefined) ?? undefined }
        : null,
    ),
  ]);

  const host = new RemoteHost(engine, {
    token: env.token,
    onOutput: (id, action) => {
      void (action === 'start' ? outputs.start(id, programStream) : outputs.stop(id));
    },
  });

  if (env.controlUrl) {
    void host.attachServer(new WebSocketTransport(env.controlUrl), env.room);
  }
  if ('BroadcastChannel' in window) {
    host.attachPeer(new BroadcastChannelTransport(BroadcastChannelTransport.channelName(env.room)));
  }

  // AudioContext needs a user gesture in most browsers.
  const unlock = () => mixer.resume();
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });

  return { engine, mixer, sources, host, outputs, env, canvas, programStream };
}

const ctx = bootstrap();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App ctx={ctx} />
  </StrictMode>,
);
