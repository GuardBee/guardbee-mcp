import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type { Platform } from "./client.js";

export interface StackSignal {
  platform: Platform;
  evidence: string;
  /** Config file the fix can be diffed against (Nginx/Apache), relative to the project root. */
  configFile?: string;
}

export interface DetectedStack {
  signals: StackSignal[];
  /** Deploy/hosting hints that do not map to a GuardBee fix platform yet. */
  notes: string[];
}

const MAX_FILE_BYTES = 512_000;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "vendor", "coverage"]);

async function readSmall(path: string): Promise<string | null> {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_FILE_BYTES) return null;
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

/** Shallow walk (depth 3) for web server config files; never leaves the project root. */
async function findConfigs(root: string, depth = 0, out: string[] = []): Promise<string[]> {
  if (depth > 3 || out.length > 20) return out;
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(root, e.name);
    if (e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) await findConfigs(full, depth + 1, out);
    else if (e.isFile() && (/nginx.*\.conf$|\.nginx$/i.test(e.name) || /^(httpd|apache2?)\.conf$|\.htaccess$|vhost.*\.conf$/i.test(e.name))) out.push(full);
  }
  return out;
}

function pushOnce(signals: StackSignal[], signal: StackSignal): void {
  if (signals.some((s) => s.platform === signal.platform && s.configFile === signal.configFile && s.evidence === signal.evidence)) return;
  if (signal.configFile && signals.some((s) => s.platform === signal.platform && s.configFile === signal.configFile)) return;
  if (!signal.configFile && signals.some((s) => s.platform === signal.platform && !s.configFile)) {
    // Keep the first non-config signal for this platform; skip duplicates.
    return;
  }
  signals.push(signal);
}

/** Detects how the project is served from files in the user's own repository. */
export async function detectStack(projectRoot: string): Promise<DetectedStack> {
  const root = resolve(projectRoot);
  const signals: StackSignal[] = [];
  const notes: string[] = [];
  const pkgText = await readSmall(join(root, "package.json"));
  if (pkgText) {
    try {
      const pkg = JSON.parse(pkgText) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps["next"]) pushOnce(signals, { platform: "nextjs", evidence: `package.json depends on next@${deps["next"]}` });
      if (deps["express"]) pushOnce(signals, { platform: "express", evidence: `package.json depends on express@${deps["express"]}` });
      if (deps["wrangler"] || deps["@cloudflare/workers-types"] || deps["@cloudflare/workers-sdk"]) {
        pushOnce(signals, { platform: "cloudflare", evidence: `package.json depends on ${deps["wrangler"] ? `wrangler@${deps["wrangler"]}` : deps["@cloudflare/workers-types"] ? `@cloudflare/workers-types@${deps["@cloudflare/workers-types"]}` : `@cloudflare/workers-sdk@${deps["@cloudflare/workers-sdk"]}`}` });
      }
    } catch {
      /* not JSON: ignore */
    }
  }
  for (const f of ["next.config.js", "next.config.mjs", "next.config.ts"]) {
    if (!signals.some((s) => s.platform === "nextjs") && (await readSmall(join(root, f))) !== null) {
      pushOnce(signals, { platform: "nextjs", evidence: `${f} found` });
    }
  }
  if ((await readSmall(join(root, "wrangler.toml"))) !== null || (await readSmall(join(root, "wrangler.jsonc"))) !== null) {
    pushOnce(signals, { platform: "cloudflare", evidence: "wrangler config found" });
  }
  if ((await readSmall(join(root, "vercel.json"))) !== null) {
    pushOnce(signals, { platform: "nextjs", evidence: "vercel.json found" });
  }
  if ((await readSmall(join(root, "netlify.toml"))) !== null) {
    // Netlify [[headers]] / _headers are closest to Cloudflare Pages-style static header fixes.
    pushOnce(signals, { platform: "cloudflare", evidence: "netlify.toml found" });
  }
  for (const headersPath of ["public/_headers", "_headers"]) {
    if ((await readSmall(join(root, headersPath))) !== null) {
      pushOnce(signals, { platform: "cloudflare", evidence: `${headersPath} found`, configFile: headersPath });
      break;
    }
  }
  const dockerfile = await readSmall(join(root, "Dockerfile"));
  if (dockerfile !== null) {
    if (/\bnginx\b/i.test(dockerfile)) {
      pushOnce(signals, { platform: "nginx", evidence: "Dockerfile references nginx" });
    } else {
      notes.push("Dockerfile found (container image; pass platform explicitly to get_fix if headers are set at the edge)");
    }
  }
  if ((await readSmall(join(root, "fly.toml"))) !== null) {
    notes.push("fly.toml found (Fly.io; pass platform explicitly unless an Nginx/Apache config is also present)");
  }
  if ((await readSmall(join(root, "firebase.json"))) !== null) {
    notes.push("firebase.json found (Firebase Hosting; pass platform explicitly to get_fix)");
  }
  for (const file of await findConfigs(root)) {
    const rel = relative(root, file).split(sep).join("/");
    const isApache = /httpd|apache|\.htaccess|vhost/i.test(rel) && !/nginx/i.test(rel);
    const platform: Platform = isApache ? "apache" : "nginx";
    if (!signals.some((s) => s.platform === platform && s.configFile)) {
      pushOnce(signals, { platform, evidence: `${rel} found`, configFile: rel });
    }
  }
  return { signals, notes };
}

/** Reads a config file only if it is inside the project root (no path traversal). */
export async function readProjectFile(projectRoot: string, path: string): Promise<string> {
  const root = resolve(projectRoot);
  const full = resolve(root, path);
  if (full !== root && !full.startsWith(root + sep)) throw new Error("Path is outside the project root");
  const text = await readSmall(full);
  if (text === null) throw new Error(`Cannot read ${path} (missing or larger than ${MAX_FILE_BYTES} bytes)`);
  return text;
}
