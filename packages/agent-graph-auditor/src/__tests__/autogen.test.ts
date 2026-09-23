import { describe, it, expect } from "vitest";
import { extractAutoGen } from "../extractors/autogen.js";

describe("extractAutoGen", () => {
  it("code_execution_config açık bir UserProxyAgent'a doğrudan bir code_execution tool'u bağlar", () => {
    const src = `
user_proxy = UserProxyAgent(
    name="UserProxy",
    code_execution_config={"use_docker": False},
)
`;
    const g = extractAutoGen(src, "f.py");
    expect(g.edges).toContainEqual({ from: "f.py::user_proxy", to: "f.py::tool::code_execution_config", kind: "has_tool" });
  });

  it("code_execution_config=False olan bir agent'a tool bağlamaz", () => {
    const src = `assistant = AssistantAgent(name="Assistant", code_execution_config=False)`;
    const g = extractAutoGen(src, "f.py");
    expect(g.edges).toHaveLength(0);
  });

  it("GroupChat üyelerini birbirine iki yönlü group_member ile bağlar", () => {
    const src = `
user_proxy = UserProxyAgent(name="UserProxy")
assistant = AssistantAgent(name="Assistant")
critic = AssistantAgent(name="Critic")
groupchat = GroupChat(agents=[user_proxy, assistant, critic])
`;
    const g = extractAutoGen(src, "f.py");
    expect(g.edges).toContainEqual({ from: "f.py::assistant", to: "f.py::critic", kind: "group_member" });
    expect(g.edges).toContainEqual({ from: "f.py::critic", to: "f.py::assistant", kind: "group_member" });
  });

  it("register_function caller'ı tool'a, tool'u executor'a bağlar", () => {
    const src = `
assistant = AssistantAgent(name="Assistant")
user_proxy = UserProxyAgent(name="UserProxy")
register_function(
    shell_tool,
    caller=assistant,
    executor=user_proxy,
)
`;
    const g = extractAutoGen(src, "f.py");
    expect(g.edges).toContainEqual({ from: "f.py::assistant", to: "f.py::tool::shell_tool", kind: "has_tool" });
    expect(g.edges).toContainEqual({ from: "f.py::tool::shell_tool", to: "f.py::user_proxy", kind: "executes_via" });
  });
});
