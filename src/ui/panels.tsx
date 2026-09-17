import { useEffect, useRef, useState } from 'react';
import { useStudio } from './store';
import type { AppContext } from './context';
import type { SourceKind } from '../core/types';
import type { FeedInfo } from '../core/protocol';

const KIND_LABEL: Record<SourceKind, string> = {
  webcam: 'Webcam',
  screen: 'Screen',
  media: 'Media file',
  image: 'Image',
  browser: 'Browser',
  remote: 'Remote feed',
  text: 'Text',
  color: 'Color',
};

export function ScenesPanel({ ctx }: { ctx: AppContext }) {
  const state = useStudio(ctx.engine);
  const e = ctx.engine;
  return (
    <div className="panel">
      <h2>Scenes</h2>
      <div className="list">
        {state.scenes.map((s) => (
          <div
            key={s.id}
            className={`listitem ${s.id === state.programSceneId ? 'program' : s.id === state.previewSceneId ? 'preview' : ''}`}
            onClick={() => e.setPreviewScene(s.id)}
            onDoubleClick={() => e.renameScene(s.id, prompt('Scene name', s.name) ?? s.name)}
            title="Click: preview · Double-click: rename"
          >
            <span className="name">{s.name}</span>
            <span className="badge">{s.items.length} src</span>
            {state.scenes.length > 1 && (
              <button
                className="small danger"
                onClick={(ev) => {
                  ev.stopPropagation();
                  e.removeScene(s.id);
                }}
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      <button className="small" onClick={() => e.addScene(`Scene ${state.scenes.length + 1}`)}>
        + Add scene
      </button>
    </div>
  );
}

export function SourcesPanel({ ctx }: { ctx: AppContext }) {
  const state = useStudio(ctx.engine);
  const e = ctx.engine;
  const scene = state.scenes.find((s) => s.id === state.previewSceneId);
  const items = [...(scene?.items ?? [])].reverse(); // top layer first
  return (
    <div className="panel">
      <h2>Sources — {scene?.name ?? '—'}</h2>
      {items.length === 0 && <div className="hint">No sources in this scene.</div>}
      <div className="list">
        {items.map((item) => {
          const src = state.sources.find((s) => s.id === item.sourceId);
          if (!src) return null;
          return (
            <div key={item.id} className="listitem">
              <button
                className="small"
                title={item.visible ? 'Hide' : 'Show'}
                onClick={() => e.setItemVisible(scene!.id, item.sourceId, !item.visible)}
              >
                {item.visible ? '👁' : '–'}
              </button>
              <span className="name" title={src.name}>
                {src.name}
              </span>
              <span className="badge">{KIND_LABEL[src.kind]}</span>
              <button
                className="small"
                title={src.enabled ? 'Disable feed' : 'Enable feed'}
                onClick={() => e.setSourceEnabled(src.id, !src.enabled)}
              >
                {src.enabled ? '⏻' : '○'}
              </button>
              <button className="small" title="Layer up" onClick={() => e.moveItem(scene!.id, item.sourceId, 1)}>
                ↑
              </button>
              <button className="small" title="Layer down" onClick={() => e.moveItem(scene!.id, item.sourceId, -1)}>
                ↓
              </button>
              <button
                className="small danger"
                title="Remove from scene"
                onClick={() => e.removeFromScene(scene!.id, item.sourceId)}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function AddSourcePanel({ ctx }: { ctx: AppContext }) {
  const state = useStudio(ctx.engine);
  const e = ctx.engine;
  const [kind, setKind] = useState<SourceKind>('webcam');
  const [name, setName] = useState('');
  const [text, setText] = useState('Hello stream');
  const [url, setUrl] = useState('https://example.com');
  const [feedId, setFeedId] = useState('');
  const [fill, setFill] = useState('#7c5cff');
  const [feeds, setFeeds] = useState<FeedInfo[]>([]);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => ctx.host.feeds.subscribe(setFeeds), [ctx.host]);

  const sceneId = state.previewSceneId;
  if (!sceneId) return null;

  const add = async () => {
    setError('');
    const srcName = name.trim() || KIND_LABEL[kind];
    const file = fileRef.current?.files?.[0];
    const props =
      kind === 'text'
        ? { text, fontSize: 40, color: '#ffffff' }
        : kind === 'color'
          ? { fill }
          : kind === 'browser'
            ? { url }
            : kind === 'remote'
              ? { feedId }
              : kind === 'media' || kind === 'image'
                ? { fileName: file?.name }
                : {};

    const src = e.addSource(kind, srcName, props);
    try {
      await ctx.sources.attach(src, file);
    } catch (err) {
      e.removeSource(src.id);
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    const size = ctx.sources.intrinsicSize(src.id);
    const t = size
      ? { x: 0, y: 0, width: state.canvas.width, height: state.canvas.height }
      : { x: 40, y: 40, width: state.canvas.width - 80, height: state.canvas.height - 80 };
    e.addToScene(sceneId, src.id, t);
    setName('');
  };

  return (
    <div className="panel">
      <h2>Add source</h2>
      <div className="row">
        <select value={kind} onChange={(ev) => setKind(ev.target.value as SourceKind)}>
          {Object.entries(KIND_LABEL).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <input className="grow" placeholder="Name (optional)" value={name} onChange={(ev) => setName(ev.target.value)} />
      </div>
      {(kind === 'media' || kind === 'image') && <input ref={fileRef} type="file" accept={kind === 'image' ? 'image/*' : 'video/*,audio/*'} />}
      {kind === 'text' && <input value={text} onChange={(ev) => setText(ev.target.value)} placeholder="Text" />}
      {kind === 'browser' && <input value={url} onChange={(ev) => setUrl(ev.target.value)} placeholder="https://…" />}
      {kind === 'color' && <input type="color" value={fill} onChange={(ev) => setFill(ev.target.value)} />}
      {kind === 'remote' && (
        <>
          {feeds.length > 0 ? (
            <select value={feedId} onChange={(ev) => setFeedId(ev.target.value)}>
              <option value="">pick a feed…</option>
              {feeds.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          ) : (
            <input value={feedId} onChange={(ev) => setFeedId(ev.target.value)} placeholder="feed id (no feeds announced)" />
          )}
        </>
      )}
      {kind === 'remote' && !ctx.env.controlUrl && (
        <div className="hint">Remote feeds need a control server (VITE_CONTROL_WS_URL).</div>
      )}
      {error && <div className="hint" style={{ color: 'var(--program)' }}>{error}</div>}
      <button className="primary" onClick={() => void add()} disabled={kind === 'remote' && !feedId}>
        Add to scene
      </button>
    </div>
  );
}

export function OverlaysPanel({ ctx }: { ctx: AppContext }) {
  const state = useStudio(ctx.engine);
  const e = ctx.engine;
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  return (
    <div className="panel">
      <h2>Overlays</h2>
      <div className="list">
        {state.overlays.map((ov) => (
          <div key={ov.id} className="listitem">
            <span className="name" title={ov.text}>{ov.name}</span>
            {ov.activeUntil !== null && <span className="badge live">live</span>}
            <button className="small" onClick={() => e.triggerOverlay(ov.id, Date.now())}>
              trigger
            </button>
            <button className="small danger" onClick={() => e.removeOverlay(ov.id)}>×</button>
          </div>
        ))}
      </div>
      <div className="row">
        <input className="grow" placeholder="Name" value={name} onChange={(ev) => setName(ev.target.value)} />
        <input className="grow" placeholder="Text" value={text} onChange={(ev) => setText(ev.target.value)} />
        <button
          className="small"
          onClick={() => {
            if (name.trim()) e.addOverlay(name.trim(), text || name.trim());
            setName('');
            setText('');
          }}
        >
          +
        </button>
      </div>
    </div>
  );
}
