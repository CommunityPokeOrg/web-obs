/**
 * WebAudio mixer: one gain+analyser channel per audio-producing source,
 * summed into a master gain feeding a MediaStreamDestination that output
 * adapters (recorder/WHIP/bridge) can attach to the program stream.
 *
 * Monitoring (local playback) is routed through a separate gain and is off
 * by default — monitoring your own webcam mic is a feedback trap.
 */
export class AudioMixer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private monitor: GainNode | null = null;
  private dest: MediaStreamAudioDestinationNode | null = null;
  private channels = new Map<
    string,
    { gain: GainNode; analyser: AnalyserNode; node: AudioNode; scratch: Float32Array<ArrayBuffer> }
  >();
  private monitorEnabled = false;

  private ensure(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.monitor = this.ctx.createGain();
      this.monitor.gain.value = 0;
      this.dest = this.ctx.createMediaStreamDestination();
      this.master.connect(this.monitor);
      this.monitor.connect(this.ctx.destination);
      this.master.connect(this.dest);
    }
    return this.ctx;
  }

  /** Resume after a user gesture (autoplay policy). Safe to call often. */
  resume(): void {
    void this.ctx?.resume();
  }

  setMonitorEnabled(on: boolean): void {
    this.monitorEnabled = on;
    if (this.monitor) this.monitor.gain.value = on ? 1 : 0;
  }

  get monitorOn(): boolean {
    return this.monitorEnabled;
  }

  attachStream(sourceId: string, stream: MediaStream): void {
    const ctx = this.ensure();
    if (!stream.getAudioTracks().length) return;
    this.attachNode(sourceId, ctx.createMediaStreamSource(stream));
  }

  attachElement(sourceId: string, el: HTMLMediaElement): void {
    const ctx = this.ensure();
    // Route through WebAudio; mute the element itself to avoid double output.
    el.muted = true;
    this.attachNode(sourceId, ctx.createMediaElementSource(el));
  }

  private attachNode(sourceId: string, node: AudioNode): void {
    const ctx = this.ensure();
    this.detach(sourceId);
    const gain = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    node.connect(gain);
    gain.connect(analyser);
    analyser.connect(this.master!);
    this.channels.set(sourceId, {
      gain,
      analyser,
      node,
      scratch: new Float32Array(new ArrayBuffer(analyser.fftSize * 4)),
    });
  }

  detach(sourceId: string): void {
    const ch = this.channels.get(sourceId);
    if (!ch) return;
    try {
      ch.node.disconnect();
      ch.gain.disconnect();
      ch.analyser.disconnect();
    } catch {
      /* already disconnected */
    }
    this.channels.delete(sourceId);
  }

  setChannel(sourceId: string, volume: number, muted: boolean): void {
    const ch = this.channels.get(sourceId);
    if (ch) ch.gain.gain.value = muted ? 0 : volume;
  }

  /** RMS level 0..1 for metering. */
  getLevel(sourceId: string): number {
    const ch = this.channels.get(sourceId);
    if (!ch) return 0;
    const buf = ch.scratch;
    ch.analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return Math.min(1, Math.sqrt(sum / buf.length) * 3);
  }

  /** Audio track to mix into the outgoing program stream, or null if the
   * mixer was never activated (no audio-capable sources attached). */
  outputTrack(): MediaStreamTrack | null {
    return this.dest?.stream.getAudioTracks()[0] ?? null;
  }

  hasChannel(sourceId: string): boolean {
    return this.channels.has(sourceId);
  }
}
