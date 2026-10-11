# @guardbee/mcp-slopsquat-scanner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | **🇨🇳 中文** | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

一个 MCP（Model Context Protocol）服务器，对照**真实**的 npm/PyPI 注册表检查项目自身清单（`package.json`、`requirements.txt`、`pyproject.toml`）中声明的每个依赖——不是本地数据库，而是实际的网络查询。

LLM 编程助手会以可测量的比率幻觉出听起来合理的包名——开源模型上的研究约为 21.7%。攻击者了解这一点，并在 npm/PyPI 上预注册恰好那些名字，于是下一个复制同一建议的人不会得到安装错误——而是得到攻击者的代码。这就是 **slopsquatting**，与 typo-squat 不同，肉眼抓不到拼写错误：幻觉名往往比它本意指向的真实包*更*听起来合理。

> 本包默认发送使用遥测（工具名 + 较短的参数，绝不包含被扫描的清单——见 [`@guardbee/mcp-telemetry`](../telemetry/README.md)）。设置 `GUARDBEE_TELEMETRY=0` 即可关闭。

```
Claude ──► slopsquat-scanner ──► registry.npmjs.org / pypi.org
              │
              ├─ dependency_not_found            (name isn't published anywhere — critical)
              └─ dependency_recently_published    (exists, but published <30 days ago — low/informational)
```

---

## 为什么用实时注册表查询，而不是本地列表

没有办法为这种情况维护本地“已知坏”列表——slopsquat 的要点就是*新*名字，专门注册来捕获特定幻觉，可能在有人运行 `npm install` 前几小时才注册。静态模式无法知道这一点；只有向注册表询问“这个确切名字现在是否存在”才能。本包只检查项目自身**直接声明**的依赖（`package.json` 的 `dependencies`/`devDependencies`/`peerDependencies`/`optionalDependencies` 段，或 Python 的 `requirements.txt`/`pyproject.toml`）——不是完整解析的 lockfile 树。传递依赖已由发布依赖它们的包的维护者筛选过；真正的风险时刻是*新*名字（由人或 AI 助手）被直接打进你自己的清单时。

完全不存在的名字是明确的，报告为 **critical**——在你或同事安装之前核实正确名称。*确实*存在但仅在最近 30 天内发布的名字报告为 **low/informational**，而非 critical：这对真实新包也是常态，单独并不证明任何恶意——它是“值得再看一眼”的信号，不是判决。

---

## 功能

- 检查 **npm 与 PyPI** — package.json、requirements.txt 与 pyproject.toml（同时支持 PEP 621 `[project] dependencies` 与 Poetry 的 `[tool.poetry.dependencies]`）
- 仅直接依赖 — 快速，且匹配实际 slopsquatting 风险时刻所在之处
- 正确处理 scoped npm 包（`@scope/name`）— 开发期间发现并修复了一个真实的 URL 编码 bug（对整个名字做 `encodeURIComponent` 会双重编码注册表自身的 `@scope%2Fname` 约定，产生注册表无法识别为单个包的 URL）
- 无需 API 密钥 — 直接查询公开、未认证的 npm 注册表与 PyPI JSON API
- SARIF 2.1.0 输出 — CI/CD 集成（GitHub Code Scanning 等）
- 18 个单元测试，覆盖清单解析器（包括传递 lockfile 条目被正确*排除*的检查）与严重级别分类逻辑，全部对照真实、确定性 fixture——无 mock 网络调用，因为解析与分类是不需要网络的纯函数。已对真实 npm 与 PyPI 注册表做端到端验证，fixture 混合真实包（`react`、`vitest`、`requests`）与故意幻觉名——捕获两个幻觉名，真实包零误报。也对本 monorepo 自身的 `package.json` 做 dogfooding：真实依赖零误报，以及一条真正正确的低严重级别发现（`@guardbee/mcp-telemetry`，当时在 npm 上仅约 2 周）——正是预期的“值得一看，不是警报”行为。

---

## 快速开始

### Claude Desktop / MCP 客户端

```json
{
  "mcpServers": {
    "guardbee-slopsquat-scanner": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-slopsquat-scanner"]
    }
  }
}
```

### CLI（CI/CD）

```bash
npx @guardbee/mcp-slopsquat-scanner scan . --fail-on=critical --format=sarif > results.sarif
```

---

## MCP 工具

| 工具 | 说明 |
|------|----------|
| `scan_npm` | 检查目录 package.json 中每个声明的 npm 依赖 |
| `scan_pip` | 检查每个声明的 pip 依赖（requirements.txt / pyproject.toml） |
| `check_package` | 对照 npm 或 PyPI 检查单个包名 |
| `scan_directory` | 自动检测并检查 npm 与 pip 清单 |

---

## 检测模式

| 模式 | 严重级别 | 含义 |
|---|---|---|
| `dependency_not_found` | critical | 声明的包名在注册表上完全不存在 |
| `dependency_recently_published` | low | 包存在，但首次发布时间不足 30 天 |

---

## 配置（`guardbee.yml`）

```yaml
slopsquat-scanner:
  fail-on: critical    # critical | low | none
  include-dev: false
```

---

## 限制（设计如此）

- **仅直接依赖。** *传递*依赖（你依赖的包自身依赖的东西）内的幻觉或抢注名不会被检查——该包的维护者在发布时已对照真实注册表解析过。
- **“最近发布”信号本身确实模糊。** 真实新包不断发布；报告为低严重级别，正因为它*不是*任何证明，只是“再仔细看看”的提示。
- **依赖网络。** 每次检查都是对 npm/PyPI 注册表的实时 HTTP 请求——依赖很多的项目意味着很多次请求（并发上限 8），注册表中断或限流会显示为工具错误，而非虚假的“不存在”发现（注册表错误与真正的 404 分开报告）。
- **无版本固定感知。** 本工具检查的是*名字*是否存在，而非你固定的具体版本范围本身是否可疑——那是不同的、已有覆盖的问题（已知 CVE 检查见 [`@guardbee/mcp-dependency-auditor`](../dependency-auditor/README.md)）。

---

## 开发

```bash
npm run build
npm test             # 18 unit tests
```

---

## 许可证

MIT — [GuardBee](https://guardbee.ai)
