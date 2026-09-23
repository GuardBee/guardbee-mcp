import { readSync } from "fs";
import { inflateRawSync } from "zlib";

export interface ZipEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

const EOCD_SIG = 0x06054b50;
const EOCD64_LOC_SIG = 0x07064b50;
const EOCD64_SIG = 0x06064b50;
const CD_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;
const EOCD_SEARCH_WINDOW = 65557; // 22-byte EOCD record + max 65535-byte comment
const MAX_CENTRAL_DIR_BYTES = 20 * 1024 * 1024;

function readAt(fd: number, offset: number, length: number): Buffer {
  if (length <= 0) return Buffer.alloc(0);
  const buf = Buffer.alloc(length);
  const bytesRead = readSync(fd, buf, 0, length, offset);
  return bytesRead === length ? buf : buf.subarray(0, bytesRead);
}

/**
 * Reads a ZIP archive's central directory without loading the whole file —
 * PyTorch checkpoints saved with the default zip container can be many
 * gigabytes (mostly raw tensor bytes), but we only ever need the small
 * `data.pkl` metadata entry. Handles the Zip64 EOCD locator/record for
 * archives whose central directory offset overflows 32 bits.
 */
export function readZipEntries(fd: number, fileSize: number): ZipEntry[] {
  const windowSize = Math.min(fileSize, EOCD_SEARCH_WINDOW);
  const tail = readAt(fd, fileSize - windowSize, windowSize);

  let eocdOffsetInTail = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === EOCD_SIG) {
      eocdOffsetInTail = i;
      break;
    }
  }
  if (eocdOffsetInTail === -1) return [];

  let totalEntries = tail.readUInt16LE(eocdOffsetInTail + 10);
  let cdOffset = tail.readUInt32LE(eocdOffsetInTail + 16);

  if (cdOffset === 0xffffffff || totalEntries === 0xffff) {
    const locOffsetInTail = eocdOffsetInTail - 20;
    if (locOffsetInTail >= 0 && tail.readUInt32LE(locOffsetInTail) === EOCD64_LOC_SIG) {
      const zip64EocdOffset = Number(tail.readBigUInt64LE(locOffsetInTail + 8));
      const zip64Rec = readAt(fd, zip64EocdOffset, 56);
      if (zip64Rec.length === 56 && zip64Rec.readUInt32LE(0) === EOCD64_SIG) {
        totalEntries = Number(zip64Rec.readBigUInt64LE(32));
        cdOffset = Number(zip64Rec.readBigUInt64LE(48));
      }
    }
  }

  const cdBuf = readAt(fd, cdOffset, Math.min(MAX_CENTRAL_DIR_BYTES, Math.max(0, fileSize - cdOffset)));

  const entries: ZipEntry[] = [];
  let p = 0;
  for (let i = 0; i < totalEntries && p + 46 <= cdBuf.length; i++) {
    if (cdBuf.readUInt32LE(p) !== CD_SIG) break;

    let compressionMethod = cdBuf.readUInt16LE(p + 10);
    let compressedSize = cdBuf.readUInt32LE(p + 20);
    let uncompressedSize = cdBuf.readUInt32LE(p + 24);
    const nameLen = cdBuf.readUInt16LE(p + 28);
    const extraLen = cdBuf.readUInt16LE(p + 30);
    const commentLen = cdBuf.readUInt16LE(p + 32);
    let localHeaderOffset = cdBuf.readUInt32LE(p + 42);
    const name = cdBuf.toString("utf8", p + 46, p + 46 + nameLen);

    if (localHeaderOffset === 0xffffffff || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      let ep = p + 46 + nameLen;
      const eEnd = ep + extraLen;
      while (ep + 4 <= eEnd) {
        const id = cdBuf.readUInt16LE(ep);
        const size = cdBuf.readUInt16LE(ep + 2);
        if (id === 0x0001) {
          let vp = ep + 4;
          if (uncompressedSize === 0xffffffff && vp + 8 <= eEnd) {
            uncompressedSize = Number(cdBuf.readBigUInt64LE(vp));
            vp += 8;
          }
          if (compressedSize === 0xffffffff && vp + 8 <= eEnd) {
            compressedSize = Number(cdBuf.readBigUInt64LE(vp));
            vp += 8;
          }
          if (localHeaderOffset === 0xffffffff && vp + 8 <= eEnd) {
            localHeaderOffset = Number(cdBuf.readBigUInt64LE(vp));
            vp += 8;
          }
        }
        ep += 4 + size;
      }
    }

    entries.push({ name, compressionMethod, compressedSize, uncompressedSize, localHeaderOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

/** Extracts one entry's decompressed bytes. Supports STORED and DEFLATE only. */
export function extractZipEntry(fd: number, entry: ZipEntry): Buffer | null {
  const lfh = readAt(fd, entry.localHeaderOffset, 30);
  if (lfh.length < 30 || lfh.readUInt32LE(0) !== LFH_SIG) return null;

  const nameLen = lfh.readUInt16LE(26);
  const extraLen = lfh.readUInt16LE(28);
  const dataStart = entry.localHeaderOffset + 30 + nameLen + extraLen;
  const compressed = readAt(fd, dataStart, entry.compressedSize);

  if (entry.compressionMethod === 0) return compressed;
  if (entry.compressionMethod === 8) {
    try {
      return inflateRawSync(compressed);
    } catch {
      return null;
    }
  }
  return null;
}
