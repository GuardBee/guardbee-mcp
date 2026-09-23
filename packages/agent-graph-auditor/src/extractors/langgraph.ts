import type { ExtractedGraph, GraphNode, GraphEdge } from "../graph.js";

const SKIP_NODE_IDS = new Set(["START", "END", "__start__", "__end__"]);

function stripQuotes(s: string): string {
  return s.trim().replace(/^["']|["']$/g, "");
}

function splitTopLevelIdentifiers(listBody: string): string[] {
  const matches = listBody.match(/\b[A-Za-z_]\w*\b/g) ?? [];
  return [...new Set(matches)];
}

/**
 * LangGraph is the one framework in this package where the graph is (mostly)
 * literally in the source: `add_node`/`add_edge`/`add_conditional_edges` calls
 * ARE the orchestration graph, no inference needed. Tool bindings are a
 * separate step (`.bind_tools([...])` / `create_react_agent(..., tools=[...])`)
 * that we best-effort associate back to a node by matching the handler
 * variable name passed to `add_node`.
 */
export function extractLangGraph(text: string, file: string): ExtractedGraph {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  // node id -> handler variable name (e.g. add_node("researcher", researcher_agent))
  const handlerByNodeId = new Map<string, string>();
  const addNodeRe = /\.add_node\(\s*["']([^"']+)["']\s*,\s*([A-Za-z_]\w*)/g;
  let m: RegExpExecArray | null;
  while ((m = addNodeRe.exec(text)) !== null) {
    const nodeId = `${file}::${m[1]}`;
    handlerByNodeId.set(nodeId, m[2]);
    nodes.set(nodeId, { id: nodeId, kind: "agent", label: m[1], framework: "langgraph" });
  }

  const addEdgeRe = /\.add_edge\(\s*(\w+|["'][^"']+["'])\s*,\s*(\w+|["'][^"']+["'])\s*\)/g;
  while ((m = addEdgeRe.exec(text)) !== null) {
    const from = stripQuotes(m[1]);
    const to = stripQuotes(m[2]);
    if (SKIP_NODE_IDS.has(from) || SKIP_NODE_IDS.has(to)) continue;
    edges.push({ from: `${file}::${from}`, to: `${file}::${to}`, kind: "delegates_to" });
  }

  const condEdgeRe = /\.add_conditional_edges\(\s*["']([^"']+)["']\s*,\s*\w+\s*,\s*\{([^}]*)\}\s*\)/g;
  while ((m = condEdgeRe.exec(text)) !== null) {
    const from = m[1];
    const destPairRe = /:\s*["']?(\w+)["']?/g;
    let d: RegExpExecArray | null;
    while ((d = destPairRe.exec(m[2])) !== null) {
      if (SKIP_NODE_IDS.has(d[1])) continue;
      edges.push({ from: `${file}::${from}`, to: `${file}::${d[1]}`, kind: "delegates_to" });
    }
  }

  // Best-effort tool-binding association
  const toolsByVar = new Map<string, string[]>();
  const createReactRe = /([A-Za-z_]\w*)\s*=\s*create_react_agent\(\s*\w+\s*,\s*(?:tools\s*=\s*)?\[([^\]]*)\]/g;
  while ((m = createReactRe.exec(text)) !== null) {
    toolsByVar.set(m[1], splitTopLevelIdentifiers(m[2]));
  }
  const bindToolsRe = /([A-Za-z_]\w*)\s*=\s*[A-Za-z_]\w*\.bind_tools\(\s*\[([^\]]*)\]\s*\)/g;
  while ((m = bindToolsRe.exec(text)) !== null) {
    toolsByVar.set(m[1], splitTopLevelIdentifiers(m[2]));
  }

  for (const [nodeId, handlerVar] of handlerByNodeId) {
    const tools = toolsByVar.get(handlerVar);
    if (!tools) continue;
    for (const toolName of tools) {
      const toolId = `${file}::tool::${toolName}`;
      if (!nodes.has(toolId)) nodes.set(toolId, { id: toolId, kind: "tool", label: toolName, framework: "langgraph" });
      edges.push({ from: nodeId, to: toolId, kind: "has_tool" });
    }
  }

  return { nodes: Array.from(nodes.values()), edges };
}
