import { BaseOutput } from './output';

export interface WhipConfig {
  /** WHIP endpoint URL (e.g. MediaMTX, Cloudflare Stream, Dolby). */
  url: string;
  /** Optional bearer token. */
  token?: string;
}

function waitIceComplete(pc: RTCPeerConnection, timeoutMs = 5000): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ICE gather timeout')), timeoutMs);
    const onChange = () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(timer);
        pc.removeEventListener('icegatheringstatechange', onChange);
        resolve();
      }
    };
    pc.addEventListener('icegatheringstatechange', onChange);
  });
}

/**
 * WebRTC program output via WHIP (draft-ietf-wish-whip): non-trickle
 * SDP offer/answer. Works with MediaMTX, Cloudflare Stream, Dolby.io and
 * other WHIP ingests. Low-latency path; requires a reachable WHIP endpoint.
 */
export class WhipOutput extends BaseOutput {
  readonly id = 'whip';
  readonly label = 'WebRTC (WHIP ingest)';
  private pc: RTCPeerConnection | null = null;
  private resourceUrl: string | null = null;

  constructor(private cfg: WhipConfig | null) {
    super();
  }

  unavailableReason(): string | null {
    if (!this.cfg?.url) return 'no VITE_WHIP_URL configured';
    if (typeof RTCPeerConnection === 'undefined') return 'WebRTC unsupported';
    return null;
  }

  async start(getStream: () => MediaStream): Promise<void> {
    if (this.pc) return;
    const reason = this.unavailableReason();
    if (reason) throw new Error(reason);
    this.setStatus('starting');
    try {
      const pc = new RTCPeerConnection();
      this.pc = pc;
      for (const track of getStream().getTracks()) pc.addTrack(track);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitIceComplete(pc);

      const res = await fetch(this.cfg!.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/sdp',
          ...(this.cfg!.token ? { authorization: `Bearer ${this.cfg!.token}` } : {}),
        },
        body: pc.localDescription!.sdp,
      });
      if (!res.ok) throw new Error(`WHIP ${res.status}: ${await res.text().catch(() => 'no body')}`);
      const answer = await res.text();
      this.resourceUrl = res.headers.get('location');
      await pc.setRemoteDescription({ type: 'answer', sdp: answer });
      this.setStatus('active');
    } catch (e) {
      this.pc?.close();
      this.pc = null;
      this.setStatus('error', e instanceof Error ? e.message : String(e));
      throw e;
    }
  }

  async stop(): Promise<void> {
    if (!this.pc) return;
    this.setStatus('stopping');
    const resource = this.resourceUrl;
    this.resourceUrl = null;
    if (resource) {
      // Best-effort session teardown per WHIP spec.
      await fetch(new URL(resource, this.cfg!.url), {
        method: 'DELETE',
        headers: this.cfg!.token ? { authorization: `Bearer ${this.cfg!.token}` } : {},
      }).catch(() => undefined);
    }
    this.pc.close();
    this.pc = null;
    this.setStatus('idle');
  }
}
