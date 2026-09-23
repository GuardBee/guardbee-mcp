import { describe, it, expect } from "vitest";
import { extractCrewAI } from "../extractors/crewai.js";

describe("extractCrewAI", () => {
  it("Agent tanımlarından tools ve allow_delegation'ı çıkarır", () => {
    const src = `
researcher = Agent(
    role="Researcher",
    tools=[search_tool, shell_tool],
    allow_delegation=True,
)
`;
    const g = extractCrewAI(src, "f.py");
    const agent = g.nodes.find((n) => n.kind === "agent");
    expect(agent?.label).toBe("Researcher");
    expect(g.nodes.filter((n) => n.kind === "tool").map((n) => n.label).sort()).toEqual(["search_tool", "shell_tool"]);
    expect(g.edges).toContainEqual({ from: "f.py::researcher", to: "f.py::tool::shell_tool", kind: "has_tool" });
  });

  it("allow_delegation=True olan bir agent'ı aynı Crew'daki diğer üyelere bağlar", () => {
    const src = `
researcher = Agent(
    role="Researcher",
    tools=[],
    allow_delegation=True,
)
writer = Agent(
    role="Writer",
    tools=[file_write_tool],
    allow_delegation=False,
)
crew = Crew(
    agents=[researcher, writer],
    tasks=[],
)
`;
    const g = extractCrewAI(src, "f.py");
    expect(g.edges).toContainEqual({ from: "f.py::researcher", to: "f.py::writer", kind: "delegates_to" });
    // writer'ın delegation'ı kapalı, researcher'a doğru bir kenar OLMAMALI
    expect(g.edges.some((e) => e.from === "f.py::writer" && e.to === "f.py::researcher")).toBe(false);
  });

  it("allow_delegation olmayan bir agent hiçbir delegates_to kenarı üretmez", () => {
    const src = `
writer = Agent(role="Writer", tools=[], allow_delegation=False)
editor = Agent(role="Editor", tools=[])
crew = Crew(agents=[writer, editor], tasks=[])
`;
    const g = extractCrewAI(src, "f.py");
    expect(g.edges.filter((e) => e.kind === "delegates_to")).toHaveLength(0);
  });
});
