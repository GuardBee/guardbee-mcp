import { closeSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, rmSync, writeSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { isModelFile, scanModelFile } from "./scanner.js";
import type { Finding, ScanResult } from "./scanner.js";

const REPO_ID = /^[A-Za-z0-9][\w.-]{0,95}(\/[A-Za-z0-9][\w.-]{0,95})?$/;
const REVISION = /^[\w.\/-]{1,200}$/;
const DEFAULT_MAX_FILES = 200;
/** Files up to this size are downloaded whole. */
const DEFAULT_FULL_BYTES = 256 * 1024 * 1024;
/** Larger files: this much from the start, and from the end for zip containers; that holds every header the scanners read. */
const DEFAULT_EDGE_BYTES = 64 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

export interface HfScanOptions {
  revision?: string;
  maxFiles?: number;
  /** Defaults to HF_TOKEN / HUGGING_FACE_HUB_TOKEN, for gated and private repos. */
  token?: string;
  endpoint?: string;
  fullBytes?: number;
  edgeBytes?: number;
  fetchImpl?: typeof fetch;
}

export interface HfScanResult extends ScanResult {
  repo: string;
  revision: string;
  /** The commit every file was read from. */
  sha: string;
  /** Model files in the repo, as paths inside it. */
  modelFiles: string[];
  /** Files larger than the full-download limit, of which only the start (and a zip's end) was fetched. */
  partialFiles: string[];
  /** Model files beyond maxFiles, not scanned. */
  notScanned: string[];
}

interface Sibling {
  rfilename: string;
  size?: number;
  lfs?: { size?: number };
}

export class HfError extends Error {}

function safeRepoPath(p: string): boolean {
  return p.length > 0 && !p.startsWith("/") && !p.includes("\\") && !p.split("/").some((s) => s === ".." || s === "." || s === "");
}

/**
 * Scans the model files of a Hugging Face model repo at one commit. The
 * revision (branch, tag or sha) is resolved to a commit sha first and every
 * file is read from that sha, so the result describes a fixed snapshot.
 */
export async function scanHfRepo(repo: string, options: HfScanOptions = {}): Promise<HfScanResult> {
  const start = Date.now();
  const revision = options.revision ?? "main";
  if (!REPO_ID.test(repo)) throw new HfError(`Not a Hugging Face repo id: ${repo} (expected "owner/name")`);
  if (!REVISION.test(revision) || revision.split("/").includes("..")) throw new HfError(`Not a valid revision: ${revision}`);
  const endpoint = (options.endpoint ?? process.env.HF_ENDPOINT ?? "https://huggingface.co").replace(/\/+$/, "");
  const token = options.token ?? process.env.HF_TOKEN ?? process.env.HUGGING_FACE_HUB_TOKEN;
  const doFetch = options.fetchImpl ?? fetch;
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const fullBytes = options.fullBytes ?? DEFAULT_FULL_BYTES;
  const edgeBytes = options.edgeBytes ?? DEFAULT_EDGE_BYTES;

  const infoRes = await doFetch(`${endpoint}/api/models/${repo}/revision/${encodeURIComponent(revision)}?blobs=true`, {
    headers,
    signal: AbortSignal.timeout(60_000),
  });
  if (infoRes.status === 401 || infoRes.status === 403) {
    throw new HfError(`${repo}@${revision}: access denied (HTTP ${infoRes.status}). For gated or private repos set HF_TOKEN.`);
  }
  if (infoRes.status === 404) throw new HfError(`${repo}@${revision}: repo or revision not found`);
  if (!infoRes.ok) throw new HfError(`${repo}@${revision}: Hugging Face API returned HTTP ${infoRes.status}`);
  const info = (await infoRes.json()) as { sha?: string; siblings?: Sibling[] };
  if (!info.sha || !/^[0-9a-f]{40}$/.test(info.sha)) throw new HfError(`${repo}@${revision}: the API response has no commit sha`);
  const sha = info.sha;

  const candidates = (info.siblings ?? []).filter((s) => safeRepoPath(s.rfilename) && isModelFile(s.rfilename));
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const selected = candidates.slice(0, maxFiles);
  const fileUrl = (p: string) => `${endpoint}/${repo}/resolve/${sha}/${p.split("/").map(encodeURIComponent).join("/")}`;

  const readRange = async (url: string, from: number, length: number): Promise<Buffer> => {
    const res = await doFetch(url, { headers: { ...headers, Range: `bytes=${from}-${from + length - 1}` }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok || !res.body) throw new HfError(`download failed: HTTP ${res.status}`);
    if (res.status !== 206 && from > 0) {
      await res.body.cancel();
      throw new HfError("the server ignored the Range request");
    }
    const chunks: Buffer[] = [];
    let got = 0;
    const reader = res.body.getReader();
    while (got < length) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
      got += value.length;
    }
    await reader.cancel().catch(() => undefined);
    return Buffer.concat(chunks).subarray(0, length);
  };

  const dir = mkdtempSync(join(tmpdir(), "gb-model-scanner-hf-"));
  const findings: Finding[] = [];
  const partialFiles: string[] = [];
  let scannedFiles = 0;
  let skippedFiles = 0;
  try {
    for (const s of selected) {
      const size = s.lfs?.size ?? s.size ?? 0;
      const local = join(dir, s.rfilename);
      mkdirSync(dirname(local), { recursive: true });
      const fd = openSync(local, "w");
      try {
        if (size <= fullBytes) {
          if (size > 0) writeSync(fd, await readRange(fileUrl(s.rfilename), 0, size), 0, undefined, 0);
        } else {
          // A sparse file of the real size with both ends filled in: offsets
          // and size checks in the scanners see the same file as on the hub.
          ftruncateSync(fd, size);
          const head = await readRange(fileUrl(s.rfilename), 0, edgeBytes);
          writeSync(fd, head, 0, undefined, 0);
          // Only zip containers (PyTorch, .keras, .npz) keep what is read at the end: the central directory.
          if (head.readUInt32LE(0) === 0x04034b50) {
            writeSync(fd, await readRange(fileUrl(s.rfilename), size - edgeBytes, edgeBytes), 0, undefined, size - edgeBytes);
          }
          partialFiles.push(s.rfilename);
        }
      } catch (e) {
        throw new HfError(`${s.rfilename}: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        closeSync(fd);
      }
    }

    const prefix = `hf://${repo}@${sha}/`;
    for (const s of selected) {
      const result = scanModelFile(join(dir, s.rfilename));
      if (result.skipped) {
        skippedFiles++;
        continue;
      }
      scannedFiles++;
      for (const f of result.findings) {
        findings.push({ ...f, file: prefix + s.rfilename, context: f.context.split(dir + "/").join(prefix) });
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  return {
    repo,
    revision,
    sha,
    modelFiles: candidates.map((s) => s.rfilename),
    partialFiles,
    notScanned: candidates.slice(maxFiles).map((s) => s.rfilename),
    scannedFiles,
    skippedFiles,
    totalFindings: findings.length,
    findings,
    durationMs: Date.now() - start,
  };
}

/** "hf://owner/name@revision" or "hf://owner/name" → repo and revision. */
export function parseHfTarget(target: string): { repo: string; revision?: string } | null {
  const m = /^hf:\/\/([^@]+?)(?:@(.+))?$/.exec(target);
  return m ? { repo: m[1], revision: m[2] } : null;
}
