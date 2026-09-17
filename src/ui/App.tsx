import { useStudio } from './store';
import type { AppContext } from './context';
import { PreviewCanvas } from './PreviewCanvas';
import { AddSourcePanel, OverlaysPanel, ScenesPanel, SourcesPanel } from './panels';
import { MixerPanel, OutputPanel, RemotePanel, TransitionBar } from './controls';

export function App({ ctx }: { ctx: AppContext }) {
  const state = useStudio(ctx.engine);
  return (
    <div className="app">
      <header className="topbar">
        <h1>OBS for Web</h1>
        <span className="badge">
          {state.canvas.width}×{state.canvas.height} @{state.canvas.fps}fps
        </span>
        <span className="spacer" />
        <span className="hint">scene sources are editable locally; remote clients get the same command API</span>
      </header>
      <div className="main">
        <div className="col">
          <ScenesPanel ctx={ctx} />
          <SourcesPanel ctx={ctx} />
          <AddSourcePanel ctx={ctx} />
        </div>
        <div className="stage">
          <PreviewCanvas ctx={ctx} />
          <TransitionBar ctx={ctx} />
        </div>
        <div className="col">
          <MixerPanel ctx={ctx} />
          <OutputPanel ctx={ctx} />
          <RemotePanel ctx={ctx} />
          <OverlaysPanel ctx={ctx} />
        </div>
      </div>
    </div>
  );
}
