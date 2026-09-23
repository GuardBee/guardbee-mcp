import { readFileSync, statSync, readdirSync } from "fs";
import { join, relative, extname } from "path";
import { extractLangGraph } from "./extractors/langgraph.js";
import { extractCrewAI } from "./extractors/crewai.js";
import { extractAutoGen } from "./extractors/autogen.js";
import { mergeGraphs, findReachableCapabilities, type ExtractedGraph } from "./graph.js";

export interface Finding {
  patternId: string;
  patternName: string;
  category: string;
  severity: "critical" | "high" | "medium";
  recommendation: string;
  file?: string;
  line: number;
  column: number;
  match: string;
  context: string;
}

export interface ScanResult {
  scannedFiles: number;
  skippedFiles: number;
  totalFindings: number;
  findings: Finding[];
  durationMs: number;
}

const SKIP_DIRS = new Set(["node_modules", ".git", "__pycache__", ".mypy_cache", ".pytest_cache", "venv", ".venv", "dist", "build"]);
const SCANNABLE_EXTENSIONS = new Set([".py"]);
const MAX_FILE_SIZE = 1 * 1024 * 1024;

export function extractGraphFromFile(filePath: string, content: string): ExtractedGraph {
  return mergeGraphs([
    extractLangGraph(content, filePath),
    extractCrewAI(content, filePath),
    extractAutoGen(content, filePath),
  ]);
}

function findingsFromGraph(graph: ExtractedGraph, filePath?: string): Finding[] {
  const reachable = findReachableCapabilities(graph);
  return reachable.map((r) => {
    const pathLabels = r.path.map((id) => graph.nodes.find((n) => n.id === id)?.label ?? id);
    const kind = r.viaDelegation ? "transitive" : "direct";
    return {
      patternId: `agency_${kind}_${r.capability.id}`,
      patternName: `${r.viaDelegation ? "Transitive" : "Direct"} excessive agency: reaches ${r.capability.id}`,
      category: r.capability.category,
      severity: r.viaDelegation ? "critical" : r.capability.severity,
      recommendation: r.viaDelegation
        ? `Agent "${r.agentLabel}" has no direct dangerous tool, but reaches "${r.toolLabel}" through ${pathLabels.length - 2} hop(s) of delegation/group membership. ${r.capability.recommendation}`
        : `Agent "${r.agentLabel}" directly holds "${r.toolLabel}". ${r.capability.recommendation}`,
      file: filePath,
      line: 1,
      column: 1,
      match: `${r.agentLabel} → ${pathLabels.slice(1).join(" → ")}`,
      context: `path: ${pathLabels.join(" -> ")}`,
    };
  });
}

export function scanText(text: string, label?: string): Finding[] {
  const graph = extractGraphFromFile(label ?? "input", text);
  return findingsFromGraph(graph, label);
}

export function scanFile(filePath: string): { findings: Finding[]; skipped: boolean } {
  const ext = extname(filePath).toLowerCase();
  if (!SCANNABLE_EXTENSIONS.has(ext)) return { findings: [], skipped: true };

  let stat;
  try {
    stat = statSync(filePath);
  } catch {
    return { findings: [], skipped: true };
  }
  if (!stat.isFile() || stat.size > MAX_FILE_SIZE) return { findings: [], skipped: true };

  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return { findings: [], skipped: true };
  }

  const graph = extractGraphFromFile(filePath, content);
  return { findings: findingsFromGraph(graph, filePath), skipped: false };
}

export function scanDirectory(
  dirPath: string,
  options: { maxFiles?: number; include?: string[]; exclude?: string[] } = {}
): ScanResult {
  const start = Date.now();
  const { maxFiles = 2000, include, exclude } = options;

  // Each file's graph is extracted independently (variable references don't
  // resolve across files — a real limitation of a regex-based extractor, not
  // import-aware), then merged so findings from every file are reported
  // together. A Crew/GroupChat whose members are defined in a different file
  // than the Crew()/GroupChat() call itself won't be connected; see README.
  const graphs: ExtractedGraph[] = [];
  let scannedFiles = 0;
  let skippedFiles = 0;

  function walk(dir: string) {
    if (scannedFiles + skippedFiles >= maxFiles) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        if (exclude?.some((ex) => entry.name === ex || fullPath.includes(ex))) continue;
        walk(fullPath);
      } else if (entry.isFile()) {
        const relPath = relative(dirPath, fullPath);
        if (exclude?.some((ex) => relPath.includes(ex))) {
          skippedFiles++;
          continue;
        }
        if (include && !include.some((inc) => relPath.includes(inc))) {
          skippedFiles++;
          continue;
        }

        const ext = extname(fullPath).toLowerCase();
        if (!SCANNABLE_EXTENSIONS.has(ext)) {
          skippedFiles++;
          continue;
        }

        let stat;
        try {
          stat = statSync(fullPath);
        } catch {
          skippedFiles++;
          continue;
        }
        if (!stat.isFile() || stat.size > MAX_FILE_SIZE) {
          skippedFiles++;
          continue;
        }

        let content: string;
        try {
          content = readFileSync(fullPath, "utf8");
        } catch {
          skippedFiles++;
          continue;
        }

        graphs.push(extractGraphFromFile(fullPath, content));
        scannedFiles++;
      }
    }
  }

  walk(dirPath);

  const merged = mergeGraphs(graphs);
  const findings = findingsFromGraph(merged);

  return {
    scannedFiles,
    skippedFiles,
    totalFindings: findings.length,
    findings,
    durationMs: Date.now() - start,
  };
}
