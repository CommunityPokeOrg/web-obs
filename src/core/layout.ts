import type { Transform, CanvasSpec } from './types';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Largest rect of aspect `srcW:srcH` contained in `dstW x dstH` (letterbox). */
export function fitRect(srcW: number, srcH: number, dstW: number, dstH: number): Rect {
  if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const scale = Math.min(dstW / srcW, dstH / srcH);
  const width = srcW * scale;
  const height = srcH * scale;
  return { x: (dstW - width) / 2, y: (dstH - height) / 2, width, height };
}

/** Smallest rect of aspect `srcW:srcH` covering `dstW x dstH` (crop fill). */
export function coverRect(srcW: number, srcH: number, dstW: number, dstH: number): Rect {
  if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const scale = Math.max(dstW / srcW, dstH / srcH);
  const width = srcW * scale;
  const height = srcH * scale;
  return { x: (dstW - width) / 2, y: (dstH - height) / 2, width, height };
}

/** Clamp a transform so the item stays inside the canvas and keeps a
 * minimum size. Values are rounded to whole pixels. */
export function clampTransform(t: Transform, canvas: CanvasSpec): Transform {
  const min = 8;
  const width = Math.max(min, Math.min(Math.round(t.width), canvas.width));
  const height = Math.max(min, Math.min(Math.round(t.height), canvas.height));
  const x = Math.max(0, Math.min(Math.round(t.x), canvas.width - width));
  const y = Math.max(0, Math.min(Math.round(t.y), canvas.height - height));
  return { x, y, width, height };
}

/** Full-canvas transform for a source that should fill the frame
 * preserving its intrinsic aspect (contain). */
export function fullFrame(srcW: number, srcH: number, canvas: CanvasSpec): Transform {
  const r = fitRect(srcW, srcH, canvas.width, canvas.height);
  return r;
}
