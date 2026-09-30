# @guardbee/mcp-secret-scanner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | **🇨🇳 中文**

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-secret-scanner.svg)](https://www.npmjs.com/package/@guardbee/mcp-secret-scanner)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-secret-scanner.svg)](https://www.npmjs.com/package/@guardbee/mcp-secret-scanner)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

一个 MCP 服务器，扫描你的源文件、目录和环境配置中暴露的 API 密钥、密码、令牌及其他机密信息。你可以直接问 Claude 你的项目是否在泄露密钥。

> 本包默认发送使用遥测（工具名 + 较短的参数，例如文件路径——绝不包含被扫描文件的内容，见 [`@guardbee/mcp-telemetry`](../telemetry/README.md)）。设置 `GUARDBEE_TELEMETRY=0` 即可关闭。

---

## 功能

- **38 种密钥模式** —— AWS、GitHub、GitLab、Stripe、OpenAI、Anthropic、HuggingFace、Slack、Twilio、SendGrid 等。规则位于 [`@guardbee/guard-core`](../guard-core/ZH.md)，因此 `@guardbee/mcp-security-proxy` 会在运行时对工具结果中的相同格式进行脱敏
- **文件和目录扫描** —— 单个文件或整个项目目录树
- **智能跳过** —— 自动跳过 `node_modules`、`.git`、`dist`、`build`、`.next` 等目录
- **安全的部分隐藏** —— 匹配结果只显示前 4 个和后 4 个字符，中间用星号代替
- **允许列表支持** —— 可把已知的测试/假值加入允许列表
- **39 个单元测试** —— 测试全部通过

---

## 快速开始

```bash
npm install -g @guardbee/mcp-secret-scanner
```

添加到 `claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "guardbee-secret-scanner": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-secret-scanner"]
    }
  }
}
```

---

## MCP 工具

| 工具 | 说明 |
|------|----------|
| `scan_text` | 扫描给定文本中的密钥 |
| `scan_file` | 扫描单个文件 |
| `scan_directory` | 递归扫描目录及其子目录 |
| `list_patterns` | 列出所有启用的密钥模式 |

### 使用示例

你可以这样问 Claude：

> "扫描我的项目中的密钥：`/Users/me/my-app`"

> "这个 `.env` 文件里有密钥吗？"

> "这段文本安全吗：`export API_KEY=sk-abc123...`"

---

## 检测的密钥类型

| 类别 | 示例 |
|----------|---------|
| 云服务 | AWS Access Key、AWS Secret、GCP API Key |
| 源代码管理 | GitHub PAT、GitLab Token |
| 支付 | Stripe Secret/Publishable Key |
| AI | OpenAI API Key、Anthropic API Key、HuggingFace Token |
| 通信 | Slack Bot Token、Twilio Auth Token、SendGrid Key |
| 数据库 | PostgreSQL URL、MySQL URL、MongoDB URI、Redis URL |
| 密码学 | RSA 私钥、EC 私钥、OpenSSH 密钥、PGP 密钥 |
| Web | JWT Token、Bearer Token |
| 包/平台 | npm Token、Docker Hub Token、Vercel Token |
| 通用 | `SECRET=`、`PASSWORD=`、`API_KEY=` 模式 |

---

## 安全说明

本工具在扫描结果中对匹配值进行**部分隐藏**（例如 `sk_live_abc1...xyz9`）。完整值绝不会被记录或导出。

---

## CLI —— CI/CD 集成

除了 MCP 服务器模式，也可以直接作为 CLI 使用：

```bash
# 扫描项目目录
npx @guardbee/mcp-secret-scanner scan ./my-project

# 扫描单个文件
npx @guardbee/mcp-secret-scanner scan .env

# 仅在 critical/high 时失败
npx @guardbee/mcp-secret-scanner scan . --fail-on=high

# JSON 输出（用于 CI 报告）
npx @guardbee/mcp-secret-scanner scan . --format=json
```

**退出码：** `0` = 未发现密钥 · `1` = 发现密钥 · `2` = 出错

### GitHub Actions

```yaml
name: Secret Scan
on: [push, pull_request]

jobs:
  secret-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Scan for exposed secrets
        run: npx @guardbee/mcp-secret-scanner scan . --fail-on=high
```

### GitLab CI

```yaml
secret-scan:
  image: node:20
  script:
    - npx @guardbee/mcp-secret-scanner scan . --fail-on=high
  only:
    - merge_requests
    - main
```

### Pre-commit 钩子

```bash
# .git/hooks/pre-commit
npx @guardbee/mcp-secret-scanner scan . --fail-on=critical || exit 1
```

---

## 开发

```bash
npm install
npm test          # 39 个单元测试
npm run build     # TypeScript 编译
```

---

## 许可证

MIT — [GuardBee](https://guardbee.ai)
