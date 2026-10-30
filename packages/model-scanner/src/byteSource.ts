import { readSync } from "fs";

const WINDOW_BYTES = 4 * 1024 * 1024;

/**
 * Random access to a file through a small read window, so parsers can walk
 * headers and metadata of multi-gigabyte models (GGUF, joblib) without
 * loading them, and skip over tensor data by moving an offset.
 */
export class ByteSource {
  private window: Buffer = Buffer.alloc(0);
  private windowStart = 0;

  constructor(private readonly fd: number, readonly length: number) {}

  static fromBuffer(buf: Buffer): ByteSource {
    const src = new ByteSource(-1, buf.length);
    src.window = buf;
    return src;
  }

  /** `len` bytes at `offset`, or null if they run past the end of the file. */
  slice(offset: number, len: number): Buffer | null {
    if (offset < 0 || len < 0 || offset + len > this.length) return null;
    if (offset >= this.windowStart && offset + len <= this.windowStart + this.window.length) {
      return this.window.subarray(offset - this.windowStart, offset - this.windowStart + len);
    }
    if (this.fd < 0) return null;
    const size = Math.min(Math.max(len, WINDOW_BYTES), this.length - offset);
    const buf = Buffer.alloc(size);
    const read = readSync(this.fd, buf, 0, size, offset);
    if (read < len) return null;
    this.window = buf.subarray(0, read);
    this.windowStart = offset;
    return this.window.subarray(0, len);
  }

  u8(offset: number): number | null {
    const b = this.slice(offset, 1);
    return b ? b[0] : null;
  }
}
