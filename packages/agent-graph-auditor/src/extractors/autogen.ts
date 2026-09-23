import type { ExtractedGraph, GraphNode, GraphEdge } from "../graph.js";

function splitTopLevelIdentifiers(listBody: string): string[] {
  const matches = listBody.match(/\b[A-Za-z_]\w*\b/g) ?? [];
  return [...new Set(matches)];
}

/**
 * AutoGen/ag2's risk shape is different again: a `GroupChat` doesn't have an
 * explicit per-agent delegation flag — any member's output can be routed to
 * any other member by the `GroupChatManager` (the exact routing depends on
 * `speaker_selection_method`, which we don't attempt to model), so group
 * co-membership itself is treated as a bidirectional reachability edge.
 * `code_execution_config` on a `UserProxyAgent` is a direct, not transitive,
 * grant — still worth surfacing since it's usually the entry point that
 * receives raw user/tool output. `register_function(caller=, executor=)` is
 * the explicit AutoGen 2.0 way to say "this agent may call this tool".
 */
export function extractAutoGen(text: string, file: string): ExtractedGraph {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const agentVars = new Set<string>();

  const agentRe = /(\w+)\s*=\s*(UserProxyAgent|AssistantAgent|ConversableAgent)\(([\s\S]{0,600}?)\)(?=\n|$)/g;
  let m: RegExpExecArray | null;
  while ((m = agentRe.exec(text)) !== null) {
    const varName = m[1];
    const body = m[3];
    const nameMatch = body.match(/name\s*=\s*["']([^"']+)["']/);
    const label = nameMatch ? nameMatch[1] : varName;
    const id = `${file}::${varName}`;

    agentVars.add(varName);
    nodes.set(id, { id, kind: "agent", label, framework: "autogen" });

    const execConfigMatch = body.match(/code_execution_config\s*=\s*(False|True|\{[\s\S]{0,200}?\})/);
    if (execConfigMatch && execConfigMatch[1] !== "False") {
      const toolId = `${file}::tool::code_execution_config`;
      if (!nodes.has(toolId)) nodes.set(toolId, { id: toolId, kind: "tool", label: "code_execution_config", framework: "autogen" });
      edges.push({ from: id, to: toolId, kind: "has_tool" });
    }
  }

  const groupChatRe = /GroupChat\(([\s\S]{0,600}?)\)/g;
  while ((m = groupChatRe.exec(text)) !== null) {
    const agentsMatch = m[1].match(/agents\s*=\s*\[([^\]]*)\]/);
    if (!agentsMatch) continue;
    const members = splitTopLevelIdentifiers(agentsMatch[1]).filter((v) => agentVars.has(v));
    for (const a of members) {
      for (const b of members) {
        if (a === b) continue;
        edges.push({ from: `${file}::${a}`, to: `${file}::${b}`, kind: "group_member" });
      }
    }
  }

  const registerFnRe = /register_function\(\s*(\w+)\s*,[\s\S]{0,300}?caller\s*=\s*(\w+)[\s\S]{0,300}?executor\s*=\s*(\w+)/g;
  while ((m = registerFnRe.exec(text)) !== null) {
    const [, toolVar, callerVar, executorVar] = m;
    if (!agentVars.has(callerVar)) continue;
    const toolId = `${file}::tool::${toolVar}`;
    if (!nodes.has(toolId)) nodes.set(toolId, { id: toolId, kind: "tool", label: toolVar, framework: "autogen" });
    edges.push({ from: `${file}::${callerVar}`, to: toolId, kind: "has_tool" });
    if (agentVars.has(executorVar) && executorVar !== callerVar) {
      edges.push({ from: toolId, to: `${file}::${executorVar}`, kind: "executes_via" });
    }
  }

  return { nodes: Array.from(nodes.values()), edges };
}
