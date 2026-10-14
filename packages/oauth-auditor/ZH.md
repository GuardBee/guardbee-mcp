# @guardbee/mcp-oauth-auditor

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | **🇨🇳 中文**

一个 MCP（Model Context Protocol）服务器，用于扫描 MCP 服务器自身的授权代码，查找 **MCP 规范自身 Security Considerations 章节中点名的 OAuth 2.1 反模式**。

MCP 规范并未把这留给猜测——它明确将**令牌透传（token passthrough）**（把客户端令牌原样转发给下游 API，而不是交换/重新限定作用域）和**缺少 audience 校验**（接受 `aud` 声明从未为本服务器签发的令牌）列为作为 OAuth 资源服务器时的核心授权失败模式。本包精确检查这两项，外加同一家族中的另外三种相关反模式。

> 本包默认发送使用遥测（工具名 + 较短的参数，绝不包含被扫描的代码——见 [`@guardbee/mcp-telemetry`](../telemetry/README.md)）。设置 `GUARDBEE_TELEMETRY=0` 即可关闭。

```
Claude ──► oauth-auditor ──► Your MCP server's auth code
              │
              ├─ token-passthrough    (client's token forwarded unchanged downstream)
              ├─ token-validation     (jwt.verify() with no audience check)
              ├─ discovery-ssrf       (OAuth/OIDC discovery URL built from client input)
              ├─ pkce                 (authorization request missing code_challenge)
              ├─ redirect-validation  (redirect_uri checked with startsWith/includes, not exact match)
              └─ secrets-exposure     (hardcoded client_secret)
```

---

## 为什么特别关注这两项

**令牌透传**之所以重要，是因为客户端向*本*服务器出示的令牌，其作用域与 audience 是针对本服务器的——而不是服务器自身工具处理器接下来调用的任意下游 API。原样转发意味着下游服务在信任一张它从未签发的凭证，依据的是原始令牌签发方从未批准的服务端决策。

**缺少 audience 校验**是同一失败的另一面：`jwt.verify(token, key)` 确认令牌的*签名*有效，但完全不说明它是为*谁*签发的。没有显式的 `audience` 检查，为一台完全无关的资源服务器铸造的令牌——碰巧共享同一签发方/签名密钥——在这里也会验证成功。这正是 MCP 规范警告的教科书式混乱代理（confused-deputy）替换。

另外三种模式是同一主题的相邻、具体实例：“MCP 服务器的认证代码信任了不该信任的东西”——从客户端输入构造的 OAuth/OIDC discovery URL（真实已披露 CVE 背后的形态）、用前缀/子串而非精确匹配校验的 redirect_uri（开放重定向绕过），以及授权请求中静默缺失的 PKCE（OAuth 2.1 无条件要求，不仅限于公共客户端）。

---

## 功能

- **6 个类别**：token-passthrough、token-validation、discovery-ssrf、pkce、redirect-validation、secrets-exposure
- 其中两项检查（缺少 audience 校验、缺少 PKCE）寻找的是调用点附近的**缺失**，而非固定正则——它们提取完整的 `jwt.verify(...)` 调用（或授权请求 URL 构造），并确认附近确实没有 `audience:` / `code_challenge`，而不是靠幸运的字符串位置碰巧匹配
- SARIF 2.1.0 输出 — CI/CD 集成（GitHub Code Scanning 等）
- 通过 `guardbee.yml` 支持配置文件
- 18 个单元测试 — 每种模式各有正例与负例（误报）场景，外加一个产生零发现的完全正确 OAuth 流程。开发期间发现并修复了一个真实正则 bug（`]` 字符后的尾随 `\b` 永远无法匹配，因为 `]` 不是单词字符——静默漏掉了方括号记法形式的 header 访问）。已对故意植入全部 6 种反模式的 fixture 做端到端验证（全部捕获），并对整个 guardbee-mcp monorepo（401 个文件——真实第三方代码零发现；唯一的非测试匹配是扫描器自身模式定义源码在正则字面量与文档注释中文本上包含字符串 `jwt.verify(`，而非实际脆弱用法）验证

---

## 快速开始

### Claude Desktop / MCP 客户端

```json
{
  "mcpServers": {
    "guardbee-oauth-auditor": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-oauth-auditor"]
    }
  }
}
```

### CLI（CI/CD）

```bash
npx @guardbee/mcp-oauth-auditor scan ./src --fail-on=high --format=sarif > results.sarif
```

---

## MCP 工具

| 工具 | 说明 |
|------|----------|
| `scan_text` | 扫描代码片段 |
| `scan_file` | 扫描单个文件 |
| `scan_directory` | 递归扫描目录 |
| `list_patterns` | 按类别列出所有支持的模式 |

---

## 检测模式

| 类别 | 模式 | 严重级别 |
|---|---|---|
| token-passthrough | `token_passthrough_to_downstream` | critical |
| token-validation | `missing_audience_validation` | high |
| discovery-ssrf | `oauth_discovery_ssrf` | critical |
| pkce | `missing_pkce_on_auth_request` | high |
| redirect-validation | `loose_redirect_uri_validation` | high |
| secrets-exposure | `hardcoded_oauth_client_secret` | high |

---

## 配置（`guardbee.yml`）

```yaml
oauth-auditor:
  fail-on: high       # any | critical | high | medium | none
  max-files: 5000
  exclude:
    - ".test.ts"
```

---

## 限制（设计如此）

- **面向 JS/TS 的模式。** `jwt.verify(`、`fetch(`/`axios(`、模板字面量 URL 构造——用 Python/Go/Rust 编写且有等价 bug 的服务器不会按名称识别，只有碰巧使用类似命名函数时才会按底层形态识别。
- **启发式，而非完整 OAuth 一致性测试。** 本工具在源码中查找特定反模式，而非对运行中的授权服务器做实时协议一致性检查。它不会捕获 OAuth 流程被错误实现的每一种方式——只捕获 MCP 规范点名为最高风险的那一小撮。
- **基于缺失的检查（audience、PKCE）使用有界文本窗口**，而非真正解析器——若 `jwt.verify()` 的 options 对象碰巧构建在远离调用点之处（传入变量，而非内联对象），则不会正确检查 `audience`。

---

## 开发

```bash
npm run build
npm test             # 18 unit tests
```

---

## 许可证

MIT — [GuardBee](https://guardbee.ai)
