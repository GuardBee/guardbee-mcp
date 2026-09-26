import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import type { ServerBaseline } from "./types.js";

export function baselinePath(baseDir: string, serverId: string): string {
  return join(baseDir, `${serverId}.json`);
}

export function loadBaseline(baseDir: string, serverId: string): ServerBaseline | null {
  const p = baselinePath(baseDir, serverId);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as ServerBaseline;
  } catch {
    return null;
  }
}

export function saveBaseline(baseDir: string, baseline: ServerBaseline): void {
  mkdirSync(baseDir, { recursive: true });
  writeFileSync(baselinePath(baseDir, baseline.serverId), JSON.stringify(baseline, null, 2), "utf8");
}

export function listBaselines(baseDir: string): ServerBaseline[] {
  if (!existsSync(baseDir)) return [];
  const files = readdirSync(baseDir).filter((f) => f.endsWith(".json"));
  const baselines: ServerBaseline[] = [];
  for (const f of files) {
    try {
      baselines.push(JSON.parse(readFileSync(join(baseDir, f), "utf8")) as ServerBaseline);
    } catch {
      // skip a corrupt baseline file rather than failing the whole listing
    }
  }
  return baselines;
}
