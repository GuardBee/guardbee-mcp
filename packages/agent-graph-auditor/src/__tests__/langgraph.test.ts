import { describe, it, expect } from "vitest";
import { extractLangGraph } from "../extractors/langgraph.js";

describe("extractLangGraph", () => {
  it("add_node ve add_edge'den agent node'ları ve delegates_to kenarları çıkarır", () => {
    const src = `
graph = StateGraph(State)
graph.add_node("researcher", researcher_agent)
graph.add_node("executor", executor_agent)
graph.add_edge("researcher", "executor")
`;
    const g = extractLangGraph(src, "f.py");
    expect(g.nodes.filter((n) => n.kind === "agent").map((n) => n.label).sort()).toEqual(["executor", "researcher"]);
    expect(g.edges).toContainEqual({ from: "f.py::researcher", to: "f.py::executor", kind: "delegates_to" });
  });

  it("START/END sabitlerini node olarak eklemez", () => {
    const src = `
graph.add_node("researcher", researcher_agent)
graph.add_edge(START, "researcher")
graph.add_edge("researcher", END)
`;
    const g = extractLangGraph(src, "f.py");
    expect(g.edges).toEqual([]);
  });

  it("add_conditional_edges'in dict değerlerinden kenar çıkarır", () => {
    const src = `
graph.add_node("researcher", researcher_agent)
graph.add_node("executor", executor_agent)
graph.add_conditional_edges("researcher", route_fn, {"go": "executor", "stop": END})
`;
    const g = extractLangGraph(src, "f.py");
    expect(g.edges).toContainEqual({ from: "f.py::researcher", to: "f.py::executor", kind: "delegates_to" });
  });

  it("create_react_agent'taki tools listesini add_node handler'ına bağlar", () => {
    const src = `
researcher_agent = create_react_agent(llm, tools=[search_tool, shell_tool])
graph.add_node("researcher", researcher_agent)
`;
    const g = extractLangGraph(src, "f.py");
    const toolLabels = g.nodes.filter((n) => n.kind === "tool").map((n) => n.label).sort();
    expect(toolLabels).toEqual(["search_tool", "shell_tool"]);
    expect(g.edges.some((e) => e.kind === "has_tool" && e.to.endsWith("shell_tool"))).toBe(true);
  });

  it("bind_tools ile oluşturulan agent'ın tool'larını bağlar", () => {
    const src = `
researcher_agent = llm.bind_tools([search_tool])
graph.add_node("researcher", researcher_agent)
`;
    const g = extractLangGraph(src, "f.py");
    expect(g.edges.some((e) => e.kind === "has_tool" && e.to.endsWith("search_tool"))).toBe(true);
  });
});
