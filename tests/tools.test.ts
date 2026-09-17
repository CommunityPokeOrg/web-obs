import { describe, expect, it } from 'vitest';
import {
  parseArgs as parseCapture,
  selectBackend,
  ffmpegArgs,
  MOCK_FRAME,
  type CaptureOptions,
} from '../tools/capture.mjs';
import { parseArgs as parseControl, buildCommand, renderAction, type SnapshotShape } from '../tools/control.mjs';
import { JpegSplitter, isJpeg } from '../tools/lib/jpeg.mjs';

// ── capture arg parsing ──────────────────────────────────────────────────

describe('capture parseArgs', () => {
  it('applies defaults', () => {
    const o = parseCapture([]);
    expect(o.server).toBe('ws://localhost:8480/ws');
    expect(o.fps).toBe(10);
    expect(o.room).toBe('default');
  });
  it('parses flags and values', () => {
    const o = parseCapture(['--server', 'ws://x/ws', '--fps', '15', '--feed', 'f1', '--mock']);
    expect(o.server).toBe('ws://x/ws');
    expect(o.fps).toBe(15);
    expect(o.feed).toBe('f1');
    expect(o.mock).toBe(true);
  });
  it('rejects unknown flags and bad fps', () => {
    expect(() => parseCapture(['--bogus'])).toThrow('unknown option');
    expect(() => parseCapture(['--fps', '0'])).toThrow('1..60');
    expect(() => parseCapture(['--fps'])).toThrow('needs a value');
  });
});

// ── backend selection matrix ─────────────────────────────────────────────

const allBins = () => true;
const noFfmpeg = (b: string) => b !== 'ffmpeg';

describe('selectBackend', () => {
  it('linux x11 prefers x11grab', () => {
    const b = selectBackend({ platform: 'linux', sessionType: 'x11', display: ':0', has: allBins });
    expect(b.id).toBe('x11');
  });
  it('linux wayland uses grim when present', () => {
    const b = selectBackend({ platform: 'linux', sessionType: 'wayland', has: allBins });
    expect(b.id).toBe('grim');
  });
  it('linux wayland without grim falls back to mock', () => {
    const b = selectBackend({ platform: 'linux', sessionType: 'wayland', has: () => false });
    expect(b.id).toBe('mock');
  });
  it('darwin uses avfoundation', () => {
    const b = selectBackend({ platform: 'darwin', has: allBins });
    expect(b.id).toBe('avfoundation');
  });
  it('win32 uses gdigrab', () => {
    const b = selectBackend({ platform: 'win32', has: allBins });
    expect(b.id).toBe('gdigrab');
  });
  it('x11 with --window requires xdotool', () => {
    const b = selectBackend({ platform: 'linux', sessionType: 'x11', display: ':0', window: 'app', has: allBins });
    expect(b.id).toBe('x11');
    const noXd = selectBackend({ platform: 'linux', sessionType: 'x11', display: ':0', window: 'app', has: (x) => x !== 'xdotool' });
    expect(noXd.id).toBe('mock');
  });
  it('missing ffmpeg degrades gracefully to mock', () => {
    const b = selectBackend({ platform: 'darwin', has: noFfmpeg });
    expect(b.id).toBe('mock');
  });
  it('forced unavailable backend errors with reason', () => {
    expect(() =>
      selectBackend({ platform: 'linux', sessionType: 'x11', display: ':0', force: 'gdigrab', has: allBins }),
    ).toThrow(/unavailable|no capture backend/);
  });
});

describe('ffmpegArgs', () => {
  const opts = parseCapture(['--fps', '12', '--quality', '7']) as CaptureOptions;
  it('x11 produces image2pipe mjpeg', () => {
    const a = ffmpegArgs('x11', opts, ':0');
    expect(a).toContain('x11grab');
    expect(a).toContain('image2pipe');
    expect(a).toContain('12');
  });
  it('gdigrab window title variant', () => {
    const w = { ...opts, window: 'My App' };
    const a = ffmpegArgs('gdigrab', w);
    expect(a).toContain('title=My App');
  });
  it('avfoundation uses device index', () => {
    const a = ffmpegArgs('avfoundation', { ...opts, device: 3 });
    expect(a).toContain('3:none');
  });
});

// ── control CLI ──────────────────────────────────────────────────────────

describe('control parseArgs', () => {
  it('splits flags from action/args', () => {
    const o = parseControl(['--room', 'r2', 'scene', 'Main']);
    expect(o.room).toBe('r2');
    expect(o.action).toBe('scene');
    expect(o.args).toEqual(['Main']);
  });
  it('errors without action', () => {
    expect(() => parseControl(['--room', 'x'])).toThrow('missing action');
  });
});

const snap: SnapshotShape = {
  canvas: { width: 1280, height: 720, fps: 30 },
  scenes: [
    { id: 's1', name: 'Main Stage', items: [] },
    { id: 's2', name: 'Be Right Back', items: [] },
  ],
  sources: [
    { id: 'cam1', name: 'Webcam', kind: 'webcam', enabled: true },
    { id: 'txt1', name: 'Title', kind: 'text', enabled: true },
  ],
  overlays: [{ id: 'o1', name: 'Announcement' }],
  previewSceneId: 's1',
  programSceneId: 's1',
  transition: null,
};

describe('buildCommand', () => {
  it('resolves scene names to ids', () => {
    const { command } = buildCommand('scene', ['be right back'], snap);
    expect(command).toEqual({ type: 'set_preview_scene', sceneId: 's2' });
  });
  it('volume maps 0-100 to 0-1', () => {
    const { command } = buildCommand('volume', ['Webcam', '40'], snap);
    expect(command).toMatchObject({ type: 'set_source_volume', sourceId: 'cam1', volume: 0.4 });
  });
  it('show/hide toggles visibility', () => {
    expect(buildCommand('hide', ['cam1'], snap).command).toMatchObject({ visible: false });
    expect(buildCommand('show', ['cam1'], snap).command).toMatchObject({ visible: true });
  });
  it('text joins multiword args', () => {
    const { command } = buildCommand('text', ['Title', 'the', 'big', 'news'], snap);
    expect(command).toMatchObject({ text: 'the big news' });
  });
  it('transform parses numeric args', () => {
    const { command } = buildCommand('transform', ['cam1', '10', '20', '300', '200'], snap);
    expect(command).toMatchObject({ transform: { x: 10, y: 20, width: 300, height: 200 } });
  });
  it('output start/stop', () => {
    expect(buildCommand('output', ['record', 'start'], snap).command).toMatchObject({ action: 'start' });
    expect(() => buildCommand('output', ['record', 'rev'], snap)).toThrow('start|stop');
  });
  it('raw accepts JSON', () => {
    const { command } = buildCommand('raw', ['{"type":"transition","mode":"cut"}'], snap);
    expect(command).toEqual({ type: 'transition', mode: 'cut' });
  });
  it('friendly errors for bad names/values', () => {
    expect(() => buildCommand('scene', ['nope'], snap)).toThrow('no scene');
    expect(() => buildCommand('volume', ['nope', '50'], snap)).toThrow('no source');
    expect(() => buildCommand('volume', ['cam1', '150'], snap)).toThrow('0-100');
    expect(() => buildCommand('overlay', ['nope'], snap)).toThrow('no overlay');
    expect(() => buildCommand('bogus', [], snap)).toThrow('unknown action');
  });
});

describe('renderAction', () => {
  it('scenes lists with program marker', () => {
    const out = renderAction('scenes', [], snap)!;
    expect(out).toContain('P s1');
    expect(out).toContain('s2');
  });
  it('status summarizes', () => {
    expect(renderAction('status', [], snap)).toContain('1280x720@30');
  });
  it('returns null for command actions', () => {
    expect(renderAction('transition', [], snap)).toBeNull();
  });
});

// ── jpeg splitting ───────────────────────────────────────────────────────

describe('JpegSplitter', () => {
  const j1 = Buffer.from([0xff, 0xd8, 1, 2, 0xff, 0xd9]);
  const j2 = Buffer.from([0xff, 0xd8, 3, 0xff, 0xd9]);
  it('extracts frames across arbitrary chunk boundaries', () => {
    const s = new JpegSplitter();
    const both = Buffer.concat([j1, j2]);
    expect(s.push(both.subarray(0, 3))).toEqual([]);
    const frames = s.push(both.subarray(3));
    expect(frames).toHaveLength(2);
    expect(isJpeg(frames[0])).toBe(true);
    expect(isJpeg(frames[1])).toBe(true);
  });
  it('skips junk before SOI', () => {
    const s = new JpegSplitter();
    const frames = s.push(Buffer.concat([Buffer.from([9, 9, 9]), j1]));
    expect(frames).toHaveLength(1);
  });
});

describe('MOCK_FRAME', () => {
  it('is a complete jpeg', () => {
    expect(isJpeg(MOCK_FRAME)).toBe(true);
  });
});
