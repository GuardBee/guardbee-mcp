# @guardbee/mcp-agent-graph-auditor

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | **🇨🇳 中文**

一个 MCP（Model Context Protocol）服务器，用于在多智能体编排中构建可达性图，并发现**传递性过度代理（transitive excessive agency）**——某个智能体从未被直接授予危险工具，却仍可通过其被允许委派的另一个智能体到达该工具。

`mcp-server-auditor` 会抓住自身工具直接授予 shell/eval/SQL 访问的 MCP 服务器。`ai-code-scanner` 会抓住单个智能体工具列表中含有 `execute_command` 的情况。这两者都是**一跳**：智能体 → 工具。多智能体框架增加了第二类边——委派、群聊、函数执行路由——一个看起来「安全」、只有 `web_search` 工具的智能体，一旦被允许把工作交给持有 shell 工具的同事，就会立刻变得危险。这种两跳路径对一次只看单个智能体自身工具列表的扫描器是不可见的。

> 本包默认发送使用遥测（工具名 + 较短参数；绝不包含被扫描的源码——见 [`@guardbee/mcp-telemetry`](../telemetry/README.md)）。设置 `GUARDBEE_TELEMETRY=0` 即可关闭。

```
Claude ──► agent-graph-auditor ──► Your multi-agent Python source
              │
              ├─ LangGraph   (add_node/add_edge — structural, read directly from the graph API)
              ├─ CrewAI      (Agent/tools/allow_delegation + Crew membership — heuristic)
              └─ AutoGen/ag2 (GroupChat membership, code_execution_config, register_function — heuristic)
```

---

## 图如何构建

1. **提取。** 框架特定的正则提取器从源码拉出智能体/工具节点与关系边：`has_tool`（智能体自身工具集）、`delegates_to`（CrewAI `allow_delegation`、LangGraph `add_edge`）、`group_member`（AutoGen `GroupChat` 共同成员——任意成员的输出都可能被 manager 路由给其他成员）、`executes_via`（AutoGen `register_function` 的 caller/executor 拆分）。
2. **分类。** 每个工具节点按基于名称的能力目录检查（代码执行、进程执行、文件系统写入、网络、凭据访问）——与 `ai-code-scanner` 的过度代理模式同类启发式，只是应用到工具图上，而非单个服务器的工具列表。
3. **可达。** 从每个智能体节点做广度优先搜索。经直接 `has_tool` 边到达的能力工具是**直接**发现（仍会报告——即使画面中没有第二个智能体也有用）。仅在跨越至少一条 `delegates_to`/`group_member`/`executes_via` 边之后才到达的能力工具是**传递性**的——这正是本包存在的目的——且无论工具自身基础严重级别如何，一律报告为 critical，因为持有它的智能体从未被直接审计过该能力。

LangGraph 是最可靠的目标：`add_node`/`add_edge` 调用**就是**源码中的编排图，无需推断。CrewAI 与 AutoGen 需要从框架语义（`allow_delegation`、`GroupChat` 成员关系）推断委派，而非代码中的显式边，因此应视为启发式——见下方限制。

---

## 功能

- **3 个框架**：LangGraph（结构性）、CrewAI（启发式）、AutoGen/ag2（启发式）
- **7 条能力规则**，覆盖 5 个类别（code-execution、process-execution、filesystem-write、network、credentials-access）
- 区分**直接**（单智能体）与**传递性**（跨委派）过度代理——传递性情况是本 monorepo 中任何单智能体扫描器都抓不到的
- 感知多跳——3+ 智能体委派链与 2 智能体链以同样方式被发现
- SARIF 2.1.0 输出——便于 CI/CD 集成（GitHub Code Scanning 等）
- 通过 `guardbee.yml` 支持配置文件
- 31 个单元测试，以及对三个框架真实感 fixture 的端到端验证

---

## 快速开始

### Claude Desktop / MCP 客户端

```json
{
  "mcpServers": {
    "guardbee-agent-graph-auditor": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-agent-graph-auditor"]
    }
  }
}
```

### CLI（CI/CD）

```bash
npx @guardbee/mcp-agent-graph-auditor scan ./agents --fail-on=high --format=sarif > results.sarif
```

---

## MCP 工具

| 工具 | 说明 |
|------|----------|
| `scan_text` | 扫描 Python 代码片段 |
| `scan_file` | 扫描单个 `.py` 文件 |
| `scan_directory` | 递归扫描 `.py` 文件目录 |
| `list_patterns` | 按类别列出危险能力目录 |

---

## 示例

```python
researcher = Agent(role="Researcher", tools=[web_search_tool], allow_delegation=True)
ops = Agent(role="Ops Engineer", tools=[shell_tool], allow_delegation=False)
writer = Agent(role="Writer", tools=[], allow_delegation=False)
crew = Crew(agents=[researcher, ops, writer], tasks=[])
```

`researcher` 从未持有 `shell_tool`——但 `allow_delegation=True` 加上与 `ops` 同属一个 `Crew`，意味着它可以把工作交给持有该工具的智能体。本扫描器会报告：

```
🔴 CRITICAL  Transitive excessive agency: reaches shell_tool
   Path: Researcher → Ops Engineer → shell_tool

🔴 CRITICAL  Direct excessive agency: reaches shell_tool
   Path: Ops Engineer → shell_tool
```

`writer`——无工具、无委派——不会产生任何发现。

---

## 配置（`guardbee.yml`）

```yaml
agent-graph-auditor:
  fail-on: high       # any | critical | high | medium | none
  max-files: 2000
  exclude:
    - ".test.py"
```

---

## 限制（设计如此）

- **单文件作用域。** 每个文件的图独立提取——Python 变量引用不会跨文件解析。即使扫描整个目录，`Crew(agents=[researcher, ops])` 也只会连接到*同一文件*中的 `Agent(...)` 定义。
- **CrewAI/AutoGen 提取是启发式的**，而非真正的 Python 解析器——构造函数体用有界文本窗口捕获，而非精确括号匹配（与 `ai-code-scanner` 的模式窗口匹配同样取舍），且不跟踪重赋值、条件构造智能体或动态构建的工具列表。
- **未建模 AutoGen 的 `speaker_selection_method`**——`GroupChat` 共同成员始终视为双向可达边，这是保守假设（宁可过度包含，也不漏报）。
- **能力分类基于名称。** 名为 `search_tool` 但内部偷偷执行 shell 的工具不会被标记；名为 `shell_tool_disabled` 的会被标记。请人工复核发现，勿当作绝对真相。
- v1 仅扫描 Python 源码——尚未覆盖 LangChain/LangGraph 的 JS/TS API。

---

## 开发

```bash
npm run build
npm test             # 31 unit tests
```

---

## 许可证

MIT — [GuardBee](https://guardbee.ai)
