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
- **Git 历史与暂存区扫描** —— `--history` 扫描每次提交新增的每一行，因此能找到已从文件中删除但仍留在仓库中的密钥，并在引入它的提交处（附作者和日期）只报告一次；`--staged` 只扫描你即将提交的内容
- **基线（Baseline）** —— `--write-baseline` 以哈希形式记录当前发现（从不保存密钥本身，可安全提交）；之后 `--baseline` 只报告新发现，让现有仓库无需先全部修复即可在 CI 中启用扫描。SARIF 结果带有稳定的 `partialFingerprints` 值
- **高熵值** —— 赋给类似密钥名称的随机值（`.env` 中的 `WEBHOOK_SIGNING_SECRET=…`、YAML 中的 `client_secret:`、JSON 中的 `"internalApiKey"`）即使没有任何服务商规则认识其格式也会被报告。随机性以香农熵衡量（十六进制值需 32 个字符以上；不含数字的值需更高阈值，因此驼峰式口令不算）；`public`/`publishable`、`*_hash`、`*_id` 和 `*_url` 名称、占位符和 `${VAR}` 引用会被跳过，已被服务商规则报告的值不会重复报告。严重程度为 medium，测试文件中为 low；`--no-entropy`（或 MCP 工具中的 `entropy: false`）可关闭
- **智能跳过** —— 自动跳过 `node_modules`、`.git`、`dist`、`build`、`.next` 等目录
- **安全的部分隐藏** —— 匹配结果只显示前 4 个和后 4 个字符，中间用星号代替
- **允许列表支持** —— 可把已知的测试/假值加入允许列表
- **58 个单元测试** —— 测试全部通过

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
| `scan_git` | 扫描 git 仓库的暂存区改动或每次提交新增的行（历史） |
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
# Pre-commit：只扫描即将提交的行
npx @guardbee/mcp-secret-scanner scan --staged

# 所有分支的每次提交（能找到已从文件中删除的密钥）
npx @guardbee/mcp-secret-scanner scan . --history
npx @guardbee/mcp-secret-scanner scan . --history=main..HEAD   # 仅当前分支

# 接入已有仓库：先记录已知发现，之后只对新发现报错
npx @guardbee/mcp-secret-scanner scan . --history --write-baseline=.guardbee-secrets-baseline.json
npx @guardbee/mcp-secret-scanner scan . --history --baseline=.guardbee-secrets-baseline.json
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
        with:
          fetch-depth: 0   # --history 需要完整历史
      - name: Scan for exposed secrets
        run: npx @guardbee/mcp-secret-scanner scan . --history --baseline=.guardbee-secrets-baseline.json --fail-on=high
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
npx @guardbee/mcp-secret-scanner scan --staged --fail-on=high || exit 1
```

---

## 开发

```bash
npm install
npm test          # 58 个单元测试
npm run build     # TypeScript 编译
```

---

## 许可证

MIT — [GuardBee](https://guardbee.ai)
