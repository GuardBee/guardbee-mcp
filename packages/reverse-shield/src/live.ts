import { bySeverity, grade } from "./finding.js";
import type { Finding } from "./finding.js";
import type { ScanResult } from "./scanner.js";
import { analyzeJavaScript, parseSourceMap, sourceMapFinding, sourceMappingUrl } from "./web.js";

export interface UrlScanOptions {
  maxScripts?: number;
  timeoutMs?: number;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
}

const MAX_PAGE_BYTES = 5 * 1024 * 1024;
const MAX_SCRIPT_BYTES = 20 * 1024 * 1024;
const MAX_MAP_BYTES = 50 * 1024 * 1024;
const USER_AGENT = "guardbee-reverse-shield (+https://guardbee.ai)";

const SCRIPT_SRC = /<script\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
const MODULE_PRELOAD = /<link\b[^>]*?\brel\s*=\s*["']modulepreload["'][^>]*?\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi;
const INLINE_SCRIPT = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;

async function fetchText(url: string, limit: number, options: Required<Pick<UrlScanOptions, "timeoutMs">> & { fetchImpl: typeof fetch }): Promise<{ status: number; text: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const res = await options.fetchImpl(url, { signal: controller.signal, redirect: "follow", headers: { "user-agent": USER_AGENT } });
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > limit) return { status: res.status, text: "" };
    if (!res.body) return { status: res.status, text: await res.text() };
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) {
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
    return { status: res.status, text: Buffer.concat(chunks).toString("utf8") };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Same site: the page's host or another host under the same last two labels (cdn.example.com for www.example.com). */
function sameSite(a: URL, b: URL): boolean {
  const root = (h: string) => h.split(".").slice(-2).join(".");
  return a.hostname === b.hostname || root(a.hostname) === root(b.hostname);
}

async function probeMap(mapUrl: string, scriptUrl: string, referenced: boolean, opts: { timeoutMs: number; fetchImpl: typeof fetch }): Promise<Finding | null> {
  const res = await fetchText(mapUrl, MAX_MAP_BYTES, opts);
  if (!res || res.status !== 200) return null;
  const info = parseSourceMap(res.text);
  if (!info) return null;
  const f = sourceMapFinding(info, scriptUrl, "sourcemap_publicly_reachable");
  f.match = `${mapUrl}${referenced ? "" : " (not referenced by the bundle, but served)"} — ${f.match}`;
  return f;
}

/**
 * Loads a live page, then checks the same-site scripts it pulls in the way
 * an analyst would start: read the bundles, follow their source map comments,
 * and try `<bundle>.map` even when the comment was stripped.
 */
export async function scanUrl(pageUrl: string, options: UrlScanOptions = {}): Promise<ScanResult> {
  const start = Date.now();
  const opts = { timeoutMs: options.timeoutMs ?? 10_000, fetchImpl: options.fetchImpl ?? fetch };
  const maxScripts = options.maxScripts ?? 25;

  const page = new URL(pageUrl);
  if (page.protocol !== "http:" && page.protocol !== "https:") throw new Error(`Only http(s) URLs can be scanned: ${pageUrl}`);

  const findings: Finding[] = [];
  const notes: string[] = [];
  const res = await fetchText(page.href, MAX_PAGE_BYTES, opts);
  if (!res) throw new Error(`Could not fetch ${page.href}`);
  if (res.status >= 400) notes.push(`${page.href} answered HTTP ${res.status}`);
  const html = res.text;

  const scripts: string[] = [];
  let thirdParty = 0;
  for (const re of [SCRIPT_SRC, MODULE_PRELOAD]) {
    for (const m of html.matchAll(re)) {
      let u: URL;
      try {
        u = new URL(m[1], page);
      } catch {
        continue;
      }
      if (!sameSite(page, u)) {
        thirdParty++;
        continue;
      }
      if (!scripts.includes(u.href)) scripts.push(u.href);
    }
  }
  if (thirdParty > 0) notes.push(`${thirdParty} third-party script(s) not checked`);
  if (scripts.length > maxScripts) notes.push(`Checked the first ${maxScripts} of ${scripts.length} same-site scripts`);

  let inline = 0;
  for (const m of html.matchAll(INLINE_SCRIPT)) {
    if (m[1].trim().length === 0) continue;
    inline++;
    findings.push(...analyzeJavaScript(m[1], `${page.href} (inline script ${inline})`, { skipMinifyCheck: true }));
  }

  let scanned = 0;
  for (const scriptUrl of scripts.slice(0, maxScripts)) {
    const script = await fetchText(scriptUrl, MAX_SCRIPT_BYTES, opts);
    if (!script || script.status !== 200) {
      notes.push(`${scriptUrl}: ${script ? `HTTP ${script.status}` : "fetch failed"}`);
      continue;
    }
    scanned++;
    const ref = sourceMappingUrl(script.text);
    const external = ref !== null && !ref.startsWith("data:");
    const mapUrl = external ? new URL(ref, scriptUrl).href : `${scriptUrl.split(/[?#]/)[0]}.map`;
    const exposed = await probeMap(mapUrl, scriptUrl, external, opts);

    for (const f of analyzeJavaScript(script.text, scriptUrl)) {
      if (exposed && f.patternId === "sourcemap_reference") continue;
      findings.push(f);
    }
    if (exposed) findings.push(exposed);
  }

  if (scripts.length === 0 && inline === 0) notes.push("No scripts found in the page HTML (client-rendered shell loaded another way?)");
  const sorted = findings.sort(bySeverity);
  return {
    target: page.href,
    kinds: ["web"],
    grade: grade(sorted),
    scannedFiles: scanned + (inline > 0 ? 1 : 0),
    totalFindings: sorted.length,
    findings: sorted,
    notes,
    truncated: scripts.length > maxScripts,
    durationMs: Date.now() - start,
  };
}
