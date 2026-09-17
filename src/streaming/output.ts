import { Emitter } from '../core/events';

export type OutputStatus = 'idle' | 'starting' | 'active' | 'stopping' | 'error';

export interface OutputAdapter {
  readonly id: string;
  readonly label: string;
  readonly statusChanged: Emitter<OutputStatus>;
  readonly status: OutputStatus;
  /** Human-readable reason the adapter can't run, or null when usable. */
  unavailableReason(): string | null;
  start(getStream: () => MediaStream): Promise<void>;
  stop(): Promise<void>;
}

export interface OutputInfo {
  id: string;
  label: string;
  status: OutputStatus;
  unavailableReason: string | null;
}

/** Coordinates output adapters; never throws on missing infrastructure —
 * adapters report `unavailableReason()` and the UI disables them. */
export class OutputManager {
  readonly changed = new Emitter<OutputInfo[]>();

  constructor(private adapters: OutputAdapter[]) {
    for (const a of adapters) a.statusChanged.subscribe(() => this.changed.emit(this.infos()));
  }

  infos(): OutputInfo[] {
    return this.adapters.map((a) => ({
      id: a.id,
      label: a.label,
      status: a.status,
      unavailableReason: a.unavailableReason(),
    }));
  }

  adapter(id: string): OutputAdapter {
    const a = this.adapters.find((x) => x.id === id);
    if (!a) throw new Error(`unknown output ${id}`);
    return a;
  }

  async start(id: string, getStream: () => MediaStream): Promise<void> {
    const a = this.adapter(id);
    const reason = a.unavailableReason();
    if (reason) throw new Error(`output ${id} unavailable: ${reason}`);
    if (a.status === 'active' || a.status === 'starting') return;
    await a.start(getStream);
  }

  async stop(id: string): Promise<void> {
    const a = this.adapter(id);
    if (a.status === 'idle') return;
    await a.stop();
  }

  async stopAll(): Promise<void> {
    await Promise.all(
      this.adapters.filter((a) => a.status === 'active' || a.status === 'starting').map((a) => a.stop()),
    );
  }
}

/** Small shared base: status bookkeeping + error state. */
export abstract class BaseOutput implements OutputAdapter {
  abstract readonly id: string;
  abstract readonly label: string;
  readonly statusChanged = new Emitter<OutputStatus>();
  protected _status: OutputStatus = 'idle';
  protected _error: string | null = null;

  get status(): OutputStatus {
    return this._status;
  }

  get error(): string | null {
    return this._error;
  }

  protected setStatus(s: OutputStatus, error?: string): void {
    this._status = s;
    this._error = error ?? null;
    this.statusChanged.emit(s);
  }

  abstract unavailableReason(): string | null;
  abstract start(getStream: () => MediaStream): Promise<void>;
  abstract stop(): Promise<void>;
}
