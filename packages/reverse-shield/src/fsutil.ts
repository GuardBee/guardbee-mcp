import { closeSync, openSync, readSync, readdirSync, statSync } from "fs";
import { join } from "path";

export function readAt(fd: number, offset: number, length: number): Buffer {
  if (length <= 0) return Buffer.alloc(0);
  const buf = Buffer.alloc(length);
  const bytesRead = readSync(fd, buf, 0, length, offset);
  return bytesRead === length ? buf : buf.subarray(0, bytesRead);
}

export function readPrefix(filePath: string, length: number): Buffer {
  const fd = openSync(filePath, "r");
  try {
    return readAt(fd, 0, length);
  } finally {
    closeSync(fd);
  }
}

/**
 * Finds every offset of `needle` in a file without loading it whole — the
 * Electron framework binary that carries the fuse wire is 150–250 MB.
 */
export function findInFile(filePath: string, needle: Buffer, maxHits = 8): number[] {
  const CHUNK = 16 * 1024 * 1024;
  const size = statSync(filePath).size;
  const hits: number[] = [];
  const fd = openSync(filePath, "r");
  try {
    for (let pos = 0; pos < size && hits.length < maxHits; pos += CHUNK) {
      const chunk = readAt(fd, pos, Math.min(CHUNK + needle.length - 1, size - pos));
      for (let i = chunk.indexOf(needle); i !== -1 && hits.length < maxHits; i = chunk.indexOf(needle, i + 1)) {
        if (i < CHUNK) hits.push(pos + i);
      }
    }
  } finally {
    closeSync(fd);
  }
  return hits;
}

export interface WalkOptions {
  maxFiles: number;
  include?: string[];
  exclude?: string[];
  /** Directory names never descended into. */
  skipDirs: Set<string>;
  /** Called for directories; returning true stops the walk from descending (the caller handles it as a unit). */
  claimDir?: (path: string) => boolean;
}

export function walkFiles(root: string, options: WalkOptions, onFile: (path: string) => void): { truncated: boolean } {
  let count = 0;
  let truncated = false;

  const visit = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (count >= options.maxFiles) {
        truncated = true;
        return;
      }
      const full = join(dir, entry.name);
      if (options.exclude?.some((e) => full.includes(e))) continue;
      if (entry.isDirectory()) {
        if (options.skipDirs.has(entry.name)) continue;
        if (options.claimDir?.(full)) continue;
        visit(full);
      } else if (entry.isFile()) {
        if (options.include && options.include.length > 0 && !options.include.some((i) => full.includes(i))) continue;
        count++;
        onFile(full);
      }
    }
  };

  visit(root);
  return { truncated };
}
