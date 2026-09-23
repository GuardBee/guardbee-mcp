import { describe, it, expect } from "vitest";
import { findReachableCapabilities, type ExtractedGraph } from "../graph.js";

describe("findReachableCapabilities", () => {
  it("bir agent'ın doğrudan sahip olduğu tehlikeli tool'u 'direct' olarak bulur", () => {
    const graph: ExtractedGraph = {
      nodes: [
        { id: "a", kind: "agent", label: "Writer", framework: "crewai" },
        { id: "t", kind: "tool", label: "shell_tool", framework: "crewai" },
      ],
      edges: [{ from: "a", to: "t", kind: "has_tool" }],
    };
    const findings = findReachableCapabilities(graph);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ agentId: "a", toolId: "t", viaDelegation: false });
  });

  it("delegation üzerinden ulaşılan bir tool'u 'transitive' olarak bulur", () => {
    const graph: ExtractedGraph = {
      nodes: [
        { id: "a", kind: "agent", label: "Writer", framework: "crewai" },
        { id: "b", kind: "agent", label: "Researcher", framework: "crewai" },
        { id: "t", kind: "tool", label: "shell_tool", framework: "crewai" },
      ],
      edges: [
        { from: "a", to: "b", kind: "delegates_to" },
        { from: "b", to: "t", kind: "has_tool" },
      ],
    };
    const findings = findReachableCapabilities(graph);
    const aFinding = findings.find((f) => f.agentId === "a");
    expect(aFinding).toMatchObject({ viaDelegation: true, toolId: "t" });
    // b kendi doğrudan tool'unu da ayrıca bulmalı
    const bFinding = findings.find((f) => f.agentId === "b");
    expect(bFinding).toMatchObject({ viaDelegation: false });
  });

  it("zararsız bir tool'u (catalog'da yok) bulgu olarak döndürmez", () => {
    const graph: ExtractedGraph = {
      nodes: [
        { id: "a", kind: "agent", label: "Writer", framework: "crewai" },
        { id: "t", kind: "tool", label: "search_tool", framework: "crewai" },
      ],
      edges: [{ from: "a", to: "t", kind: "has_tool" }],
    };
    expect(findReachableCapabilities(graph)).toHaveLength(0);
  });

  it("çok-hop'lu (A→B→C→tool) bir zinciri de transitive olarak bulur", () => {
    const graph: ExtractedGraph = {
      nodes: [
        { id: "a", kind: "agent", label: "A", framework: "autogen" },
        { id: "b", kind: "agent", label: "B", framework: "autogen" },
        { id: "c", kind: "agent", label: "C", framework: "autogen" },
        { id: "t", kind: "tool", label: "code_exec", framework: "autogen" },
      ],
      edges: [
        { from: "a", to: "b", kind: "group_member" },
        { from: "b", to: "c", kind: "group_member" },
        { from: "c", to: "t", kind: "has_tool" },
      ],
    };
    const findings = findReachableCapabilities(graph);
    const aFinding = findings.find((f) => f.agentId === "a");
    expect(aFinding?.viaDelegation).toBe(true);
    expect(aFinding?.path).toEqual(["a", "b", "c", "t"]);
  });

  it("döngüsel bir graph'ta sonsuz döngüye girmez", () => {
    const graph: ExtractedGraph = {
      nodes: [
        { id: "a", kind: "agent", label: "A", framework: "autogen" },
        { id: "b", kind: "agent", label: "B", framework: "autogen" },
      ],
      edges: [
        { from: "a", to: "b", kind: "group_member" },
        { from: "b", to: "a", kind: "group_member" },
      ],
    };
    expect(() => findReachableCapabilities(graph)).not.toThrow();
    expect(findReachableCapabilities(graph)).toHaveLength(0);
  });
});
