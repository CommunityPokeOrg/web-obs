import { useMemo, useState } from 'react';
import { RemoteClient } from '../remote/client';
import { BroadcastChannelTransport, WebSocketTransport, type Transport } from '../remote/transport';
import type { Command } from '../core/protocol';

function readParams() {
  const p = new URLSearchParams(location.search);
  const v = (k: string) => p.get(k) ?? (import.meta.env[k] as string | undefined) ?? '';
  return {
    ws: v('ws') || v('VITE_CONTROL_WS_URL'),
    room: v('room') || v('VITE_ROOM') || 'default',
    token: v('token') || v('VITE_TOKEN') || 'dev-token',
  };
}

export function RemoteApp() {
  const defaults = useMemo(readParams, []);
  const [ws, setWs] = useState(defaults.ws);
  const [room, setRoom] = useState(defaults.room);
  const [token, setToken] = useState(defaults.token);
  const [client, setClient] = useState<RemoteClient | null>(null);
  const [, force] = useState(0);
  const [lastAck, setLastAck] = useState('');

  const connect = async (mode: 'ws' | 'bc') => {
    const t: Transport =
      mode === 'bc'
        ? new BroadcastChannelTransport(BroadcastChannelTransport.channelName(room))
        : new WebSocketTransport(ws);
    const c = new RemoteClient(t, { role: 'controller', room, token });
    c.changed.subscribe(() => force((n) => n + 1));
    setClient(c);
    try {
      await c.connect();
    } catch {
      /* status surfaces via 'error'/'closed' */
    }
  };

  const cmd = async (command: Command) => {
    if (!client) return;
    const r = await client.sendCommand(command);
    setLastAck(r.ok ? `ok: ${command.type}` : `rejected ${command.type}: ${r.error}`);
  };

  if (!client || client.status !== 'connected' || !client.snapshot) {
    return (
      <div className="remote">
        <h1>OBS for Web — Remote</h1>
        <div className="connectform">
          <label>
            Relay WebSocket URL
            <input className="grow" style={{ width: '100%' }} value={ws} onChange={(e) => setWs(e.target.value)} placeholder="ws://host:8480/ws" />
          </label>
          <label>
            Room
            <input style={{ width: '100%' }} value={room} onChange={(e) => setRoom(e.target.value)} />
          </label>
          <label>
            Token
            <input style={{ width: '100%' }} value={token} onChange={(e) => setToken(e.target.value)} type="password" />
          </label>
          <div className="row" style={{ gap: 8 }}>
            <button className="primary" onClick={() => void connect('ws')} disabled={!ws}>
              Connect via relay
            </button>
            <button onClick={() => void connect('bc')}>Connect same-browser (BroadcastChannel)</button>
          </div>
          {client && (
            <div className="hint" style={{ color: 'var(--warn)' }}>
              {client.status} {client.statusDetail}
            </div>
          )}
        </div>
      </div>
    );
  }

  const snap = client.snapshot;
  const preview = snap.scenes.find((s) => s.id === snap.previewSceneId);
  const program = snap.scenes.find((s) => s.id === snap.programSceneId);
  const programItems = program?.items ?? [];

  return (
    <div className="remote">
      <h1>OBS for Web — Remote</h1>
      <div className="hint">{lastAck}</div>

      <div className="panel">
        <h2>Scenes</h2>
        <div className="scenes">
          {snap.scenes.map((s) => (
            <button
              key={s.id}
              className={`scenebtn ${s.id === snap.programSceneId ? 'program' : s.id === snap.previewSceneId ? 'preview' : ''}`}
              onClick={() => void cmd({ type: 'set_preview_scene', sceneId: s.id })}
            >
              {s.name}
            </button>
          ))}
        </div>
        <div className="row">
          <button onClick={() => void cmd({ type: 'transition', mode: 'cut' })} disabled={!preview || preview.id === program?.id}>CUT</button>
          <button className="primary" onClick={() => void cmd({ type: 'transition', mode: 'fade' })} disabled={!preview || preview.id === program?.id}>FADE</button>
        </div>
      </div>

      <div className="panel">
        <h2>Feeds in {program?.name ?? 'program'}</h2>
        {programItems.map((item) => {
          const src = snap.sources.find((s) => s.id === item.sourceId);
          if (!src) return null;
          return (
            <div key={item.id} className="row">
              <button className="small" onClick={() => void cmd({ type: 'set_item_visible', sourceId: src.id, visible: !item.visible })}>
                {item.visible ? 'hide' : 'show'}
              </button>
              <span className="grow">{src.name}</span>
              <span className="badge">{src.kind}</span>
              <button
                className="small"
                onClick={() => void cmd({ type: 'set_source_enabled', sourceId: src.id, enabled: !src.enabled })}
              >
                {src.enabled ? 'kill feed' : 'enable'}
              </button>
            </div>
          );
        })}
      </div>

      <div className="panel">
        <h2>Audio</h2>
        {snap.sources
          .filter((s) => ['webcam', 'screen', 'media', 'remote'].includes(s.kind))
          .map((s) => (
            <div key={s.id} className="mixerrow">
              <span>{s.name}</span>
              <input
                type="range" min={0} max={100} value={Math.round(s.audio.volume * 100)}
                onChange={(e) => void cmd({ type: 'set_source_volume', sourceId: s.id, volume: Number(e.target.value) / 100 })}
              />
              <button className="small" onClick={() => void cmd({ type: 'set_source_muted', sourceId: s.id, muted: !s.audio.muted })}>
                {s.audio.muted ? 'unmute' : 'mute'}
              </button>
            </div>
          ))}
      </div>

      <div className="panel">
        <h2>Overlays</h2>
        {snap.overlays.map((o) => (
          <div key={o.id} className="row">
            <span className="grow">{o.name}</span>
            {o.activeUntil !== null && <span className="badge live">live</span>}
            <button className="small" onClick={() => void cmd({ type: 'trigger_overlay', overlayId: o.id })}>trigger</button>
          </div>
        ))}
      </div>

      <div className="panel">
        <h2>Outputs</h2>
        {['record', 'whip', 'bridge'].map((id) => (
          <div key={id} className="row">
            <span className="grow">{id}</span>
            <button className="small" onClick={() => void cmd({ type: 'set_output', output: id, action: 'start' })}>start</button>
            <button className="small danger" onClick={() => void cmd({ type: 'set_output', output: id, action: 'stop' })}>stop</button>
          </div>
        ))}
      </div>
    </div>
  );
}
