import fs from "fs";
import path from "path";
import type { McpGrade, McpIndex, McpIndexEntry } from "@guardbee/guard-core";

/**
 * The published files, under the GitHub Pages root:
 *   index/v1.json            the whole index (what the clients download)
 *   badges/<slug>.json       a shields.io endpoint per server
 *   index.html               a searchable page over v1.json
 *   RUBRIC.md                the rubric the grades were made with
 */

export const slug = (name: string) => name.replace(/[^A-Za-z0-9._-]+/g, "_");

const COLOR: Record<McpGrade, string> = { A: "brightgreen", B: "green", C: "yellow", D: "orange", F: "red" };

export function badge(entry: McpIndexEntry): Record<string, unknown> {
  return {
    schemaVersion: 1,
    label: "GuardBee",
    message: entry.grade ?? "not graded",
    color: entry.grade ? COLOR[entry.grade] : "lightgrey",
    cacheSeconds: 86_400,
  };
}

export function writeSite(index: McpIndex, out: string, rubric: string): void {
  fs.mkdirSync(path.join(out, "index"), { recursive: true });
  fs.mkdirSync(path.join(out, "badges"), { recursive: true });
  fs.writeFileSync(path.join(out, "index", "v1.json"), JSON.stringify(index));
  for (const entry of index.servers) fs.writeFileSync(path.join(out, "badges", `${slug(entry.name)}.json`), JSON.stringify(badge(entry)));
  fs.writeFileSync(path.join(out, "RUBRIC.md"), rubric);
  fs.writeFileSync(path.join(out, "index.html"), PAGE);
  fs.writeFileSync(path.join(out, ".nojekyll"), "");
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GuardBee MCP Index</title>
<style>
:root { --bg: #fff; --fg: #1a1a1a; --muted: #666; --line: #e5e5e5; --A: #1a7f37; --B: #4c9a2a; --C: #9a6700; --D: #bc4c00; --F: #cf222e; }
@media (prefers-color-scheme: dark) { :root { --bg: #0d1117; --fg: #e6edf3; --muted: #8b949e; --line: #30363d; } }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, sans-serif; }
main { max-width: 1100px; margin: 0 auto; padding: 24px 16px; }
h1 { margin: 0 0 4px; font-size: 26px; }
p.lead { color: var(--muted); margin: 0 0 16px; }
input { width: 100%; box-sizing: border-box; padding: 10px 12px; font-size: 15px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--fg); }
.stats { color: var(--muted); margin: 10px 0; font-size: 13px; }
table { width: 100%; border-collapse: collapse; }
td, th { text-align: left; padding: 8px 6px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-size: 12px; color: var(--muted); text-transform: uppercase; }
.grade { font-weight: 700; font-size: 18px; width: 40px; }
.g-A { color: var(--A); } .g-B { color: var(--B); } .g-C { color: var(--C); } .g-D { color: var(--D); } .g-F { color: var(--F); } .g-none { color: var(--muted); }
.name { font-weight: 600; word-break: break-all; }
.pkg, .note { color: var(--muted); font-size: 13px; word-break: break-all; }
details summary { cursor: pointer; color: var(--muted); font-size: 13px; }
details li { font-size: 13px; }
a { color: inherit; }
</style>
</head>
<body>
<main>
<h1>GuardBee MCP Index</h1>
<p class="lead">A–F trust grades for the servers in the official MCP Registry, rebuilt weekly from their published packages. <a href="RUBRIC.md">How grades are made</a> · <a href="index/v1.json">JSON</a> · <a href="https://github.com/GuardBee/guardbee-mcp/tree/main/packages/mcp-index#disputes-and-opt-out">Dispute or opt out</a></p>
<input id="q" type="search" placeholder="Search by server or package name" autocomplete="off">
<div class="stats" id="stats">Loading…</div>
<table><thead><tr><th>Grade</th><th>Server</th><th>Why</th></tr></thead><tbody id="rows"></tbody></table>
</main>
<script>
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
let all = [];
function render() {
  const q = document.getElementById("q").value.trim().toLowerCase();
  const list = all.filter((s) => !q || s.name.toLowerCase().includes(q) || s.packages.some((p) => p.identifier.toLowerCase().includes(q))).slice(0, 300);
  document.getElementById("rows").innerHTML = list.map((s) => {
    const g = s.grade ?? "none";
    const pkgs = s.packages.map((p) => esc(p.ecosystem + ":" + p.identifier + (p.version ? "@" + p.version : ""))).join(", ");
    const why = s.grade
      ? '<details><summary>' + s.score + '/100 · code ' + s.subscores.code + ' · supply chain ' + s.subscores.supplyChain + ' · maintenance ' + s.subscores.maintenance + '</summary><ul>' + s.reasons.map((r) => '<li>' + (r.points ? r.points + ' ' : '') + esc(r.category) + ': ' + esc(r.detail) + '</li>').join("") + '</ul></details>'
      : '<span class="note">' + esc(s.note) + '</span>';
    return '<tr><td class="grade g-' + g + '">' + (s.grade ?? "–") + '</td><td><div class="name">' + esc(s.title || s.name) + '</div><div class="pkg">' + esc(s.name) + (pkgs ? " · " + pkgs : "") + '</div></td><td>' + why + '</td></tr>';
  }).join("");
}
fetch("index/v1.json").then((r) => r.json()).then((index) => {
  all = index.servers;
  const graded = all.filter((s) => s.grade);
  const counts = ["A", "B", "C", "D", "F"].map((g) => g + " " + graded.filter((s) => s.grade === g).length).join(" · ");
  document.getElementById("stats").textContent = all.length + " servers, " + graded.length + " graded (" + counts + ") · rubric " + index.rubricVersion + " · " + new Date(index.generatedAt).toUTCString();
  render();
});
document.getElementById("q").addEventListener("input", render);
</script>
</body>
</html>
`;
