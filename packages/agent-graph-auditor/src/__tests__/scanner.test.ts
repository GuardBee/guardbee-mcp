import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { scanText, scanFile, scanDirectory } from "../scanner.js";

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "gb-agent-graph-"));
  dirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("scanText — CrewAI transitive excessive agency", () => {
  it("shell_tool'a sadece delegation ile ulaşan bir agent'ı critical olarak işaretler", () => {
    const src = `
writer = Agent(
    role="Writer",
    tools=[],
    allow_delegation=True,
)
ops = Agent(
    role="Ops",
    tools=[shell_tool],
    allow_delegation=False,
)
crew = Crew(agents=[writer, ops], tasks=[])
`;
    const findings = scanText(src, "crew.py");
    const writerFinding = findings.find((f) => f.match.startsWith("Writer"));
    expect(writerFinding).toBeDefined();
    expect(writerFinding?.severity).toBe("critical");
    expect(writerFinding?.patternId).toContain("transitive");
  });

  it("hiçbir agent tehlikeli bir tool'a ulaşamıyorsa bulgu döndürmez", () => {
    const src = `
writer = Agent(role="Writer", tools=[search_tool], allow_delegation=False)
`;
    expect(scanText(src, "crew.py")).toHaveLength(0);
  });
});

describe("scanText — AutoGen direct excessive agency", () => {
  it("code_execution_config açık bir UserProxyAgent'ı direct olarak işaretler", () => {
    const src = `
user_proxy = UserProxyAgent(
    name="UserProxy",
    code_execution_config={"use_docker": False},
)
`;
    const findings = scanText(src, "autogen.py");
    expect(findings).toHaveLength(1);
    expect(findings[0].patternId).toContain("direct");
    expect(findings[0].severity).toBe("critical");
  });
});

describe("scanText — LangGraph transitive excessive agency", () => {
  it("bir node'un bağlı olmadığı ama add_edge ile ulaştığı tehlikeli tool'u transitive işaretler", () => {
    const src = `
executor_agent = create_react_agent(llm, tools=[shell_tool])
graph.add_node("planner", planner_agent)
graph.add_node("executor", executor_agent)
graph.add_edge("planner", "executor")
`;
    const findings = scanText(src, "graph.py");
    const planner = findings.find((f) => f.match.startsWith("planner"));
    expect(planner).toBeDefined();
    expect(planner?.patternId).toContain("transitive");
  });
});

describe("scanFile", () => {
  it(".py olmayan bir dosyayı skip eder", () => {
    const dir = tempDir();
    const p = join(dir, "readme.txt");
    writeFileSync(p, "hello");
    expect(scanFile(p).skipped).toBe(true);
  });

  it("gerçek bir .py dosyasını tarar", () => {
    const dir = tempDir();
    const p = join(dir, "agents.py");
    writeFileSync(p, `assistant = AssistantAgent(name="A", code_execution_config={"use_docker": False})`);
    const { findings, skipped } = scanFile(p);
    expect(skipped).toBe(false);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].file).toBe(p);
  });
});

describe("scanDirectory", () => {
  it("birden fazla dosyadaki bulguları birlikte toplar (her dosyanın graph'ı kendi içinde tam olduğunda)", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "crew_a.py"), `
writer = Agent(role="Writer", tools=[], allow_delegation=True)
ops = Agent(role="Ops", tools=[shell_tool], allow_delegation=False)
crew = Crew(agents=[writer, ops], tasks=[])
`);
    writeFileSync(join(dir, "crew_b.py"), `
solo = Agent(role="Solo", tools=[search_tool], allow_delegation=False)
`);

    const result = scanDirectory(dir);
    expect(result.scannedFiles).toBe(2);
    expect(result.findings.some((f) => f.match.startsWith("Writer"))).toBe(true);
  });

  it("bir Crew()'ün üyeleri başka bir dosyada tanımlıysa bağlanamaz (bilinen kısıtlama)", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "agents.py"), `
writer = Agent(role="Writer", tools=[], allow_delegation=True)
ops = Agent(role="Ops", tools=[shell_tool], allow_delegation=False)
`);
    writeFileSync(join(dir, "crew.py"), `
crew = Crew(agents=[writer, ops], tasks=[])
`);

    const result = scanDirectory(dir);
    expect(result.scannedFiles).toBe(2);
    expect(result.findings.some((f) => f.match.startsWith("Writer"))).toBe(false);
  });
});
