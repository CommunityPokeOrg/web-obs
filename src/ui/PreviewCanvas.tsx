import { useEffect, useRef, useState } from 'react';
import { useStudio } from './store';
import type { AppContext } from './context';

interface StageRect {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Mounts the compositor's canvas and overlays <iframe>s for browser sources
 * on top of it, scaled to the displayed canvas size. iframes are a DOM
 * overlay for local preview only — they can NOT be composited into the
 * canvas/outgoing stream (browsers forbid it cross-origin); the compositor
 * draws a placeholder tile in the actual program feed.
 */
export function PreviewCanvas({ ctx }: { ctx: AppContext }) {
  const state = useStudio(ctx.engine);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<StageRect>({ scale: 1, offsetX: 0, offsetY: 0 });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    el.appendChild(ctx.canvas);
    const update = () => {
      const cr = ctx.canvas.getBoundingClientRect();
      const wr = el.getBoundingClientRect();
      setRect({
        scale: state.canvas.width ? cr.width / state.canvas.width : 1,
        offsetX: cr.left - wr.left,
        offsetY: cr.top - wr.top,
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    ro.observe(ctx.canvas);
    return () => ro.disconnect();
  }, [ctx.canvas]);

  const program = state.scenes.find((s) => s.id === state.programSceneId);
  const overlays = (program?.items ?? [])
    .map((item) => ({ item, src: state.sources.find((s) => s.id === item.sourceId) }))
    .filter((x) => x.item.visible && x.src?.kind === 'browser' && x.src.enabled && x.src.props.url);

  return (
    <div className="stagewrap" ref={wrapRef}>
      <div className="browserlayer">
        {overlays.map(({ item, src }) => (
          <iframe
            key={item.id}
            className="browserframe"
            src={src!.props.url}
            title={src!.name}
            style={{
              left: rect.offsetX + item.transform.x * rect.scale,
              top: rect.offsetY + item.transform.y * rect.scale,
              width: item.transform.width * rect.scale,
              height: item.transform.height * rect.scale,
            }}
          />
        ))}
      </div>
    </div>
  );
}
