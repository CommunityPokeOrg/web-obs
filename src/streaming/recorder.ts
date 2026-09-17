import { BaseOutput } from './output';

export const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4',
];

/** Pick the first container/codec combo MediaRecorder supports. */
export function pickMimeType(isSupported: (t: string) => boolean): string | null {
  return MIME_CANDIDATES.find(isSupported) ?? null;
}

export interface RecorderHooks {
  /** Called when recording stops — default: browser download. */
  saveBlob?: (blob: Blob, fileName: string) => void;
  timesliceMs?: number;
}

/**
 * Local recording output: MediaRecorder → .webm download. The only output
 * that works in every browser with zero infrastructure.
 */
export class LocalRecorderOutput extends BaseOutput {
  readonly id = 'record';
  readonly label = 'Record locally (.webm)';
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  mimeType: string | null = null;

  constructor(private hooks: RecorderHooks = {}) {
    super();
  }

  unavailableReason(): string | null {
    if (typeof MediaRecorder === 'undefined') return 'MediaRecorder unsupported in this browser';
    if (!pickMimeType((t) => MediaRecorder.isTypeSupported(t))) return 'no supported recording mime type';
    return null;
  }

  async start(getStream: () => MediaStream): Promise<void> {
    if (this.recorder) return;
    const stream = getStream();
    this.mimeType = pickMimeType((t) => MediaRecorder.isTypeSupported(t));
    if (!this.mimeType) {
      this.setStatus('error', 'no supported mime');
      throw new Error('MediaRecorder: no supported mime type');
    }
    this.chunks = [];
    this.setStatus('starting');
    const rec = new MediaRecorder(stream, { mimeType: this.mimeType, videoBitsPerSecond: 6_000_000 });
    this.recorder = rec;
    rec.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    rec.onerror = () => this.setStatus('error', 'recorder error');
    rec.onstop = () => {
      const ext = this.mimeType?.includes('mp4') ? 'mp4' : 'webm';
      const blob = new Blob(this.chunks, { type: this.mimeType ?? 'video/webm' });
      this.chunks = [];
      this.recorder = null;
      this.setStatus('idle');
      if (blob.size) this.save(blob, `web-obs-${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`);
    };
    rec.start(this.hooks.timesliceMs ?? 1000);
    this.setStatus('active');
  }

  async stop(): Promise<void> {
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.setStatus('stopping');
      this.recorder.stop();
    }
  }

  private save(blob: Blob, fileName: string): void {
    if (this.hooks.saveBlob) {
      this.hooks.saveBlob(blob, fileName);
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
  }
}
