# @guardbee/mcp-rug-pull-detector

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | **🇨🇳 中文** | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

一个 MCP（Model Context Protocol）服务器，**实时**连接另一台 MCP 服务器并检测 **MCP rug pull**——服务器在你批准时呈现一种工具定义，之后悄悄提供另一种。

本 monorepo 中的其他扫描器都是一次性读取源码或配置文件。这一台架构上不同：它是一个 MCP *客户端*。它会 spawn 目标服务器（stdio）或与其打开会话（Streamable HTTP），调用真实的 `tools/list` RPC，并记住所见——与 SSH 客户端对主机密钥的首次信任（trust-on-first-use）模型相同。同一台服务器两次调用之间，工具的描述、输入/输出 schema 或 annotations 发生变化，是任何对该服务器源码的静态分析永远无法捕获的，因为服务器可能根本没有改源码——它可以在服务端、在请求时决定告诉哪个客户端什么。

> 遥测默认**关闭**。设置 `GUARDBEE_TELEMETRY=1` 后会发送服务器、工具、成功与否、耗时以及文件路径等简短参数值；更长的字符串和 `content`、`token`、`password` 等字段会被占位符替换。参见 [`@guardbee/mcp-telemetry`](../telemetry/ZH.md)。

```
Claude ──► rug-pull-detector ──► (spawns / connects to) ──► Target MCP server
              │                                                  │
              │                                          tools/list (real RPC)
              ▼
         .guardbee/tool-baselines/<hash>.json
              │
    1st contact: baseline_server → store canonical hash per tool
    every later: check_server    → re-fetch, diff against stored hash
```

---

## 首次信任模型

`baseline_server` 连接一次，获取每个工具的 `{name, description, inputSchema, outputSchema, annotations}`，规范化（深度按键排序的 JSON）并存储 SHA-256 哈希加上完整快照——每个服务器一个 JSON 文件，位于 `.guardbee/tool-baselines/` 下。

每次 `check_server` 也会对实时 `tools/list` 运行 tool-poisoning 目录扫描，包括首次见到某服务器以及尚未存储基线时。被投毒的描述不会等到第二次访问。

`check_server` 之后再次连接——版本 bump 之后、每次会话之前、按计划，任选你的节奏——并重新获取相同信息。任何哈希不再匹配的工具都会被报告：

- **critical** — *已有*工具的定义发生了变化（`tool_definition_drift`）。这就是 rug pull 本身。发现会精确说明哪个字段变了（description / input schema / output schema / annotations），并给出前后描述文本，因为 `destructiveHint: true → false` 与重写描述一样是谎言——两者都改变了调用方以为自己在授权什么。
- **medium** — 出现了基线中没有的*新*工具（`tool_added`）。可能是合法发布。仍值得一看——没有什么能阻止服务器在良性工具已经赢得信任之后才引入危险工具。
- **low** — *先前已基线*的工具不再提供（`tool_removed`）。

若尚无基线，`check_server` 会自动捕获一份并报告干净（传 `autoBaseline: false` / `--no-auto-baseline` 可改为要求先显式调用 `baseline_server`）。

---

## 功能

- **真正的 MCP 客户端** — 不是 mock，不是源码启发式。通过 stdio 或 Streamable HTTP 对你指向的任意服务器使用实际协议。
- 规范化哈希覆盖 name、description、input schema、output schema，**以及** annotations（`readOnlyHint`、`destructiveHint`、…）— 服务器不能只碰天真 diff 会跳过的字段来躲避检测。
- 三种指定目标的方式：`--stdio="command arg1 arg2"`、`--url=<http-url>`，或 `--config=<file> --server=<name>`（直接读取 `mcpServers` 风格的 JSON 配置——与 Claude Desktop 配置相同形态）
- SARIF 2.1.0 输出 — CI/CD 集成
- 28 个测试：哈希/diff/存储的纯单元测试，外加针对 fixture MCP 服务器的**真实 stdio 进程 spawn 集成测试**（非 mock），覆盖漂移、新增、移除与标签隔离。已对 `ai-code-scanner` 自身真实、已发布的 MCP 服务器做端到端验证——通过真正的 stdio JSON-RPC 连接，为其 4 个真实工具建基线，并确认第二次检查报告干净。

---

## 快速开始

### Claude Desktop / MCP 客户端

```json
{
  "mcpServers": {
    "guardbee-rug-pull-detector": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-rug-pull-detector"]
    }
  }
}
```

然后让 Claude 为你即将添加的服务器建基线，并定期重新检查（例如“今天使用前对照基线检查这台 MCP 服务器”）。

### CLI（CI/CD 或定时检查）

```bash
# First contact — do this only after you've reviewed the server's tools
npx @guardbee/mcp-rug-pull-detector baseline --config=claude_desktop_config.json --server=some-third-party-server

# Every later run — e.g. a scheduled job, or right before your app starts
npx @guardbee/mcp-rug-pull-detector check --config=claude_desktop_config.json --server=some-third-party-server --fail-on=critical
```

---

## MCP 工具

| 工具 | 说明 |
|------|----------|
| `baseline_server` | 连接服务器并将其当前工具存为可信基线 |
| `check_server` | 连接服务器并将其当前工具与已存基线做 diff |
| `list_baselines` | 列出每个已存基线的服务器 |

---

## 配置

没有 `guardbee.yml` 段——唯一的持久状态就是基线目录本身（默认 `.guardbee/tool-baselines/`，可用 `--baseline-dir` 覆盖）。

---

## 限制（设计如此）

- **`--stdio` 使用简单的空白分割**，而非 shell 引号解析——含空格的命令/参数会出错。对超出平凡命令行的情况，使用 `--config=<file> --server=<name>`（读取带有正确 `args` 数组的真实 JSON 配置）。
- **基线身份是你给它的 `label`**（或不给时用命令行/URL），而非关于服务器本身的任何密码学身份——重命名调用服务器的方式会开始新的基线。保持标签稳定。
- 本工具检测的是**服务器呈现的工具列表漂移**，而非始终存在的工具调用内部的恶意行为。它是 rug-pull 防御，不是 `mcp-server-auditor` 或 `tool-poisoning-scanner` 的替代——三者都要跑。
- 连接 stdio 目标意味着**spawn 你给出的任意命令**——每个 MCP 客户端在把服务器加入配置时已经在做的同一件事。只指向你打算运行的服务器。

---

## 开发

```bash
npm run build
npm test             # 28 tests
```

---

## 许可证

MIT — [GuardBee](https://guardbee.ai)

## 反馈

有问题、想法或误报？请在 [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) 发帖或[提交 issue](https://github.com/GuardBee/guardbee-mcp/issues)。如果 GuardBee 对你有帮助，给[仓库](https://github.com/GuardBee/guardbee-mcp)点个 ⭐ 能让更多人发现它。
