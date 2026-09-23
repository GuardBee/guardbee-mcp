import type { ExtractedGraph, GraphNode, GraphEdge } from "../graph.js";

function splitTopLevelIdentifiers(listBody: string): string[] {
  const matches = listBody.match(/\b[A-Za-z_]\w*\b/g) ?? [];
  return [...new Set(matches)];
}

/**
 * CrewAI doesn't encode a graph directly — delegation is implicit: any Agent
 * with `allow_delegation=True` gets an internal "delegate to coworker" tool
 * that can target *any other agent in the same Crew*. So a Crew's `agents=[...]`
 * list defines a group, and a delegating member can reach every other member's
 * tools. Constructor bodies are captured with a bounded window rather than
 * exact paren-matching (documented heuristic limitation, same tradeoff
 * ai-code-scanner's pattern-window matching makes) — reliable for typical
 * one-call-per-statement formatting, not for deeply nested inline calls.
 */
export function extractCrewAI(text: string, file: string): ExtractedGraph {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  interface AgentDef {
    varName: string;
    id: string;
    allowDelegation: boolean;
    tools: string[];
  }
  const agentDefs = new Map<string, AgentDef>();

  const agentRe = /(\w+)\s*=\s*Agent\(([\s\S]{0,600}?)\)(?=\n|$)/g;
  let m: RegExpExecArray | null;
  while ((m = agentRe.exec(text)) !== null) {
    const varName = m[1];
    const body = m[2];
    const roleMatch = body.match(/role\s*=\s*["']([^"']+)["']/);
    const label = roleMatch ? roleMatch[1] : varName;
    const toolsMatch = body.match(/tools\s*=\s*\[([^\]]*)\]/);
    const tools = toolsMatch ? splitTopLevelIdentifiers(toolsMatch[1]) : [];
    const allowDelegation = /allow_delegation\s*=\s*True/.test(body);

    const id = `${file}::${varName}`;
    agentDefs.set(varName, { varName, id, allowDelegation, tools });
    nodes.set(id, { id, kind: "agent", label, framework: "crewai" });

    for (const toolName of tools) {
      const toolId = `${file}::tool::${toolName}`;
      if (!nodes.has(toolId)) nodes.set(toolId, { id: toolId, kind: "tool", label: toolName, framework: "crewai" });
      edges.push({ from: id, to: toolId, kind: "has_tool" });
    }
  }

  const crewRe = /Crew\(([\s\S]{0,600}?)\)/g;
  while ((m = crewRe.exec(text)) !== null) {
    const agentsMatch = m[1].match(/agents\s*=\s*\[([^\]]*)\]/);
    if (!agentsMatch) continue;
    const memberVars = splitTopLevelIdentifiers(agentsMatch[1]).filter((v) => agentDefs.has(v));

    for (const fromVar of memberVars) {
      const fromDef = agentDefs.get(fromVar)!;
      if (!fromDef.allowDelegation) continue;
      for (const toVar of memberVars) {
        if (toVar === fromVar) continue;
        edges.push({ from: fromDef.id, to: agentDefs.get(toVar)!.id, kind: "delegates_to" });
      }
    }
  }

  return { nodes: Array.from(nodes.values()), edges };
}
