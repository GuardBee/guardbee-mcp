import { classifyToolName, type CapabilityRule } from "./capabilities.js";

export type NodeKind = "agent" | "tool";
export type EdgeKind = "has_tool" | "delegates_to" | "group_member" | "executes_via";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  framework: "langgraph" | "crewai" | "autogen";
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: EdgeKind;
}

export interface ExtractedGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export function mergeGraphs(graphs: ExtractedGraph[]): ExtractedGraph {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  for (const g of graphs) {
    for (const n of g.nodes) if (!nodes.has(n.id)) nodes.set(n.id, n);
    edges.push(...g.edges);
  }
  return { nodes: Array.from(nodes.values()), edges };
}

export interface ReachabilityFinding {
  agentId: string;
  agentLabel: string;
  toolId: string;
  toolLabel: string;
  capability: CapabilityRule;
  /** true if reaching the tool required at least one delegation/group/executes_via hop — the novel "transitive" case. */
  viaDelegation: boolean;
  path: string[];
}

/**
 * BFS from every agent node over the merged graph. `has_tool` edges taken
 * straight off the starting agent are a *direct* grant (the same thing a
 * single-server auditor like mcp-server-auditor already catches). The moment
 * a path crosses a `delegates_to` / `group_member` / `executes_via` edge
 * before reaching a capability-tagged tool, that's transitive excessive
 * agency: the agent was never directly given the dangerous tool, but nothing
 * stops it getting there through another agent it's allowed to hand off to.
 */
export function findReachableCapabilities(graph: ExtractedGraph): ReachabilityFinding[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const adjacency = new Map<string, GraphEdge[]>();
  for (const e of graph.edges) {
    if (!adjacency.has(e.from)) adjacency.set(e.from, []);
    adjacency.get(e.from)!.push(e);
  }

  const findings: ReachabilityFinding[] = [];
  const agents = graph.nodes.filter((n) => n.kind === "agent");

  for (const start of agents) {
    const visited = new Set<string>([start.id]);
    const queue: Array<{ id: string; path: string[]; viaDelegation: boolean }> = [{ id: start.id, path: [start.id], viaDelegation: false }];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const node = byId.get(current.id);
      if (!node) continue;

      if (node.kind === "tool" && current.path.length > 1) {
        const rule = classifyToolName(node.label);
        if (rule) {
          findings.push({
            agentId: start.id,
            agentLabel: start.label,
            toolId: node.id,
            toolLabel: node.label,
            capability: rule,
            viaDelegation: current.viaDelegation,
            path: current.path,
          });
        }
        continue; // don't traverse past a tool node
      }

      for (const edge of adjacency.get(current.id) ?? []) {
        if (visited.has(edge.to)) continue;
        visited.add(edge.to);
        const crossesDelegation = current.viaDelegation || edge.kind !== "has_tool";
        queue.push({ id: edge.to, path: [...current.path, edge.to], viaDelegation: crossesDelegation });
      }
    }
  }

  return findings;
}
