import { randomBytes } from "crypto";
import { PROBES, type Probe, type ProbeCategory } from "./probes.js";
import type { ProbeTarget } from "./target.js";

export interface ProbeResult {
  probeId: string;
  probeName: string;
  category: ProbeCategory;
  severity: Probe["severity"];
  bypassed: boolean;
  /** Never logged/returned raw beyond a short preview — see `responsePreview`. */
  responsePreview: string;
  recommendation: string;
  error?: string;
}

export interface SuiteResult {
  results: ProbeResult[];
  bypassedCount: number;
  totalCount: number;
  durationMs: number;
}

const MAX_PREVIEW_LENGTH = 300;

/** Random per-run token — never appears in the target's training data or in any earlier run. */
export function generateCanary(): string {
  return `GB${randomBytes(6).toString("hex").toUpperCase()}`;
}

function buildPrompt(probe: Probe, canary: string): string {
  if (probe.buildPrompt) return probe.buildPrompt(canary);
  return probe.template.replace("{{CANARY}}", canary);
}

function checkBypassed(probe: Probe, response: string, canary: string): boolean {
  if (probe.isBypassed) return probe.isBypassed(response, canary);
  return response.includes(canary);
}

export async function runProbe(target: ProbeTarget, probe: Probe): Promise<ProbeResult> {
  const canary = generateCanary();
  const prompt = buildPrompt(probe, canary);

  try {
    const response = await target.send(prompt);
    return {
      probeId: probe.id,
      probeName: probe.name,
      category: probe.category,
      severity: probe.severity,
      bypassed: checkBypassed(probe, response, canary),
      responsePreview: response.trim().slice(0, MAX_PREVIEW_LENGTH),
      recommendation: probe.recommendation,
    };
  } catch (err) {
    return {
      probeId: probe.id,
      probeName: probe.name,
      category: probe.category,
      severity: probe.severity,
      bypassed: false,
      responsePreview: "",
      recommendation: probe.recommendation,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runSuite(
  target: ProbeTarget,
  options: { categories?: ProbeCategory[]; probeIds?: string[]; maxProbes?: number } = {}
): Promise<SuiteResult> {
  const start = Date.now();

  let selected = PROBES;
  if (options.probeIds) {
    const wanted = new Set(options.probeIds);
    selected = selected.filter((p) => wanted.has(p.id));
  }
  if (options.categories) {
    const wanted = new Set(options.categories);
    selected = selected.filter((p) => wanted.has(p.category));
  }
  if (options.maxProbes) {
    selected = selected.slice(0, options.maxProbes);
  }

  const results: ProbeResult[] = [];
  for (const probe of selected) {
    results.push(await runProbe(target, probe));
  }

  return {
    results,
    bypassedCount: results.filter((r) => r.bypassed).length,
    totalCount: results.length,
    durationMs: Date.now() - start,
  };
}
