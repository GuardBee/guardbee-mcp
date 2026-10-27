import { closeSync, existsSync, openSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { readAt } from "./fsutil.js";
import type { ArtifactFile } from "./web.js";

interface AsarNode {
  files?: Record<string, AsarNode>;
  size?: number;
  offset?: string;
  unpacked?: boolean;
  link?: string;
}

const MAX_HEADER_BYTES = 64 * 1024 * 1024;

/**
 * Lists an ASAR archive's files. Layout: a Chromium Pickle holding the header
 * size (u32 4, u32 headerPickleSize), then a Pickle holding the JSON index
 * (u32 payloadSize, u32 jsonLength, json). File data starts right after the
 * header pickle; each entry's offset is relative to that. Entries marked
 * `unpacked` live in `<archive>.unpacked/` instead.
 */
export function readAsar(archivePath: string): ArtifactFile[] | null {
  const fileSize = statSync(archivePath).size;
  if (fileSize < 16) return null;
  const fd = openSync(archivePath, "r");
  let header: AsarNode;
  let dataStart: number;
  try {
    const prefix = readAt(fd, 0, 16);
    const headerPickleSize = prefix.readUInt32LE(4);
    const jsonLength = prefix.readUInt32LE(12);
    if (prefix.readUInt32LE(0) !== 4 || jsonLength > MAX_HEADER_BYTES || 16 + jsonLength > fileSize) return null;
    header = JSON.parse(readAt(fd, 16, jsonLength).toString("utf8")) as AsarNode;
    dataStart = 8 + headerPickleSize;
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }

  const files: ArtifactFile[] = [];
  const unpackedRoot = `${archivePath}.unpacked`;

  const visit = (node: AsarNode, prefix: string): void => {
    for (const [name, child] of Object.entries(node.files ?? {})) {
      const key = prefix ? `${prefix}/${name}` : name;
      if (child.files) {
        visit(child, key);
        continue;
      }
      if (child.link !== undefined || typeof child.size !== "number") continue;
      const size = child.size;
      const display = `${archivePath}!/${key}`;
      if (child.unpacked) {
        const onDisk = join(unpackedRoot, ...key.split("/"));
        files.push({ key, display, size, read: () => (existsSync(onDisk) ? readFileSync(onDisk) : null) });
      } else {
        const offset = dataStart + Number(child.offset ?? 0);
        files.push({
          key,
          display,
          size,
          read: () => {
            const rfd = openSync(archivePath, "r");
            try {
              return readAt(rfd, offset, size);
            } finally {
              closeSync(rfd);
            }
          },
        });
      }
    }
  };

  visit(header, "");
  return files;
}
