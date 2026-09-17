import { useEffect, useState } from 'react';
import { useStudio } from './store';
import type { AppContext } from './context';
import type { OutputInfo } from '../streaming/output';

const AUDIO_KINDS = new Set(['webcam', 'screen', 'media', 'remote']);

export function TransitionBar({ ctx }: { ctx: AppContext }) {
  const state = useStudio(ctx.engine);
  const e = ctx.engine;
  const preview = state.scenes.find((s) => s.id === state.previewSceneId);
  const program = state.scenes.find((s) => s.id === state.programSceneId);
  const busy = !!state.transition;
  return (
    <div className="transitionbar">
      <span className="statuschip"><i className="dot" style={{ background: 'var(--preview)' }} /> preview: {preview?.name ?? '—'}</span>
      <button onClick={() => e.transition('cut')} disabled={busy || preview?.id === program?.id}>
        CUT
      </button>
      <button className="primary" onClick={() => e.transition('fade')} disabled={busy || preview?.id === program?.id}>
        {busy ? `FADE ${Math.round((state.transition?.progress ?? 0) * 100)}%` : 'FADE'}
      </button>
      <span className="statuschip"><i className="dot err" /> program: {program?.name ?? '—'}</span>
    </div>
  );
}

export function MixerPanel({ ctx }: { ctx: AppContext }) {
  const state = useStudio(ctx.engine);
  const [levels, setLevels] = useState<Record<string, number>>({});
  const audioSources = state.sources.filter((s) => AUDIO_KINDS.has(s.kind));

  useEffect(() => {
    const t = setInterval(() => {
      const next: Record<string, number> = {};
      for (const s of audioSources) next[s.id] = ctx.mixer.getLevel(s.id);
      setLevels(next);
    }, 200);
    return () => clearInterval(t);
  }, [audioSources.map((s) => s.id).join(',')]);

  return (
    <div className="panel">
      <h2>Audio mixer</h2>
      {audioSources.length === 0 && <div className="hint">No audio-capable sources yet.</div>}
      {audioSources.map((s) => {
        const lvl = levels[s.id] ?? 0;
        return (
          <div key={s.id} className="mixerrow">
            <span className="name" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
            <input
              type="range" min={0} max={100} value={Math.round(s.audio.volume * 100)}
              onChange={(ev) => ctx.engine.setSourceVolume(s.id, Number(ev.target.value) / 100)}
            />
            <div className="meter" title={`${Math.round(lvl * 100)}%`}>
              <i style={{ height: `${Math.round(lvl * 100)}%` }} />
            </div>
            <button className="small" onClick={() => ctx.engine.setSourceMuted(s.id, !s.audio.muted)}>
              {s.audio.muted ? '🔇' : '🔊'}
            </button>
          </div>
        );
      })}
      <div className="row">
        <label className="hint">
          <input
            type="checkbox"
            checked={ctx.mixer.monitorOn}
            onChange={(ev) => ctx.mixer.setMonitorEnabled(ev.target.checked)}
          />{' '}
          monitor audio locally
        </label>
      </div>
    </div>
  );
}

export function OutputPanel({ ctx }: { ctx: AppContext }) {
  const [infos, setInfos] = useState<OutputInfo[]>(() => ctx.outputs.infos());
  const [err, setErr] = useState('');
  useEffect(() => ctx.outputs.changed.subscribe(setInfos), [ctx.outputs]);

  const run = async (info: OutputInfo, action: 'start' | 'stop') => {
    setErr('');
    try {
      if (action === 'start') await ctx.outputs.start(info.id, ctx.programStream);
      else await ctx.outputs.stop(info.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="panel">
      <h2>Outputs</h2>
      {infos.map((i) => (
        <div key={i.id} className="outputrow">
          <span className="grow">
            {i.label}
            {i.unavailableReason && <div className="hint">{i.unavailableReason}</div>}
          </span>
          <span className={`badge ${i.status === 'active' ? 'live' : i.status === 'error' ? 'off' : ''}`}>{i.status}</span>
          {i.status === 'active' || i.status === 'starting' ? (
            <button className="small danger" onClick={() => void run(i, 'stop')}>stop</button>
          ) : (
            <button className="small" disabled={!!i.unavailableReason} onClick={() => void run(i, 'start')}>start</button>
          )}
        </div>
      ))}
      {err && <div className="hint" style={{ color: 'var(--program)' }}>{err}</div>}
      <div className="hint">
        Bridge/WHIP are optional adapters — configure endpoints via <span className="code">.env</span> or URL params.
      </div>
    </div>
  );
}

export function RemotePanel({ ctx }: { ctx: AppContext }) {
  const [, force] = useState(0);
  const [showToken, setShowToken] = useState(false);
  useEffect(() => ctx.host.uplinkChanged.subscribe(() => force((n) => n + 1)), [ctx.host]);

  const uplink = ctx.host.uplinkStatus;
  const remoteUrl = `${location.origin}/remote.html?room=${encodeURIComponent(ctx.env.room)}&token=${encodeURIComponent(ctx.env.token)}${ctx.env.controlUrl ? `&ws=${encodeURIComponent(ctx.env.controlUrl)}` : ''}`;

  return (
    <div className="panel">
      <h2>Remote control</h2>
      <div className="row">
        <span className="statuschip">
          <i className={`dot ${uplink === 'connected' ? 'ok' : uplink === 'error' ? 'err' : uplink === 'connecting' ? 'warn' : ''}`} />
          relay: {uplink}
        </span>
      </div>
      {ctx.host.uplinkError && <div className="hint" style={{ color: 'var(--program)' }}>{ctx.host.uplinkError}</div>}
      <div className="hint">
        Open <span className="code">remote.html</span> in another tab/device — same room + token.
        BroadcastChannel fallback works between tabs with no server.
      </div>
      <div className="row">
        <input
          className="grow kbd" readOnly
          value={showToken ? remoteUrl : remoteUrl.replace(ctx.env.token, '••••')}
          onFocus={(ev) => ev.target.select()}
        />
        <button className="small" onClick={() => setShowToken((v) => !v)}>{showToken ? 'hide' : 'show'}</button>
        <button className="small" onClick={() => void navigator.clipboard?.writeText(remoteUrl)}>copy</button>
      </div>
      <div className="row">
        <a href="/remote.html" target="_blank" rel="noreferrer">
          <button className="small">open remote (new tab)</button>
        </a>
      </div>
    </div>
  );
}
