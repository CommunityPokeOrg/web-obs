/**
 * JPEG frame utilities for the capture daemon: split an MJPEG byte stream
 * into individual frames by SOI/EOI markers, and synthesize test frames.
 */

const SOI = 0xd8; // FF D8 — start of image
const EOI = 0xd9; // FF D9 — end of image

/** Incremental splitter: feed arbitrary chunks, get complete JPEG buffers. */
export class JpegSplitter {
  constructor() {
    this.buf = Buffer.alloc(0);
  }

  /** @param {Buffer} chunk @returns {Buffer[]} complete JPEG frames */
  push(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    const frames = [];
    let start = -1;
    for (let i = 0; i + 1 < this.buf.length; i++) {
      if (this.buf[i] === 0xff) {
        const marker = this.buf[i + 1];
        if (marker === SOI) {
          // New frame starts; flush any trailing junk before it.
          if (start >= 0) frames.push(this.buf.subarray(start, i));
          start = i;
        } else if (marker === EOI && start >= 0) {
          frames.push(this.buf.subarray(start, i + 2));
          start = -1;
        }
      }
    }
    this.buf = start >= 0 ? this.buf.subarray(start) : Buffer.alloc(0);
    return frames;
  }
}

/** True when a buffer looks like a complete JPEG. */
export function isJpeg(buf) {
  return buf.length > 4 && buf[0] === 0xff && buf[1] === SOI && buf[buf.length - 2] === 0xff && buf[buf.length - 1] === EOI;
}
