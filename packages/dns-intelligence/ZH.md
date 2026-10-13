# @guardbee/mcp-dns-intelligence

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | **🇨🇳 中文** | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-dns-intelligence.svg)](https://www.npmjs.com/package/@guardbee/mcp-dns-intelligence)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-dns-intelligence.svg)](https://www.npmjs.com/package/@guardbee/mcp-dns-intelligence)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

一个 MCP 服务器，枚举 DNS 记录，检测 SPF / DMARC / DKIM 配置问题，并发现悬空子域名。使用 Node.js 内置的 `dns/promises`——无外部依赖。

> 本包默认发送使用遥测（工具名 + 较短的参数——见 [`@guardbee/mcp-telemetry`](../telemetry/README.md)）。设置 `GUARDBEE_TELEMETRY=0` 即可关闭。

---

## 功能

- **完整 DNS 枚举** —— A、AAAA、MX、NS、TXT、CNAME、SOA 记录
- **SPF 分析** —— `+all`、`?all`、重复记录，并按接收方的方式计算 RFC 7208 限制：包含嵌套 `include`/`redirect` 的 DNS 查询（最多 10 次）、空查询（最多 2 次）、include 循环和缺失的 include
- **DMARC 分析** —— 策略（`none`/`quarantine`/`reject`）、`pct`、缺失的 `rua` 地址
- **DKIM 检查** —— 探测 9 个常见选择器（`default`、`google`、`selector1`、`mail` 等）
- **子域名枚举** —— 60+ 常见子域名；悬空 CNAME 检测（14 家云服务商）
- **邮件安全摘要** —— SPF + DMARC + DKIM 综合分析，附可复制粘贴的修复建议
- **23 个单元测试** —— 纯逻辑测试，无需网络连接

---

## 快速开始

```bash
npm install -g @guardbee/mcp-dns-intelligence
```

添加到 `claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "guardbee-dns-intelligence": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-dns-intelligence"]
    }
  }
}
```

---

## MCP 工具

| 工具 | 说明 |
|------|----------|
| `enumerate_dns` | 枚举域名的全部 DNS 记录，并运行 SPF/DMARC/DKIM 分析 |
| `enumerate_subdomains` | 探测常见子域名（识别通配符）；检测子域名接管 |
| `check_takeover` | 检查给定主机名是否存在子域名接管 |
| `check_email_security` | SPF + DMARC + DKIM 综合审计，附修复建议 |
| `lookup_dns` | 针对特定记录类型（A/MX/TXT 等）的定向 DNS 查询 |

### 使用示例

你可以这样问 Claude：

> "example.com 的 DNS 配置有问题吗？"

> "审计 example.com 的邮件安全——SPF、DMARC 和 DKIM"

> "列出 example.com 的子域名，标出任何悬空的"

> "example.com 的 MX 记录是什么？"

### 输出示例

```
Email Security Check: example.com
──────────────────────────────────────────────────

── SPF ─────────────────────────────────────────
✓ v=spf1 include:_spf.google.com -all

── DMARC ───────────────────────────────────────
✗ No DMARC record found at _dmarc.example.com
  Add:  v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com

── DKIM ────────────────────────────────────────
✓ Found DKIM selectors: google
```

---

## SPF 发现项

| 代码 | 严重程度 | 说明 |
|-----|----------|----------|
| `SPF_MISSING` | 🟡 Medium | 未找到 SPF 记录 |
| `SPF_PERMISSIVE_ALL` | 🔴 Critical | `+all` —— 允许任意服务器 |
| `SPF_NEUTRAL_ALL` | 🟠 High | `?all` —— 不拒绝未授权发件人 |
| `SPF_NO_ALL` | 🟡 Medium | 没有 `all` 机制 |
| `SPF_TOO_MANY_LOOKUPS` | 🟠 High | > 10 次 DNS 查询 —— 会导致 SPF 失败 |
| `SPF_DUPLICATE` | 🟠 High | 多条 SPF 记录 |
| `SPF_AT_LOOKUP_LIMIT` | 🔵 Low | 恰好 10 次查询 —— 再加一个 include 就会失效 |
| `SPF_TOO_MANY_VOID_LOOKUPS` | 🟠 High | 超过 2 个 include 没有返回记录 |
| `SPF_INCLUDE_MISSING` | 🟠 High | `include`/`redirect` 目标没有 SPF 记录（permerror） |
| `SPF_INCLUDE_DUPLICATE` | 🟠 High | 被包含的域名发布了多条 SPF 记录 |
| `SPF_INCLUDE_LOOP` | 🟠 High | include 循环回到正在评估的记录 |
| `SPF_PTR` | 🔵 Low | 使用已弃用的 `ptr` 机制 |

## DMARC 发现项

| 代码 | 严重程度 | 说明 |
|-----|----------|----------|
| `DMARC_MISSING` | 🟠 High | 没有 DMARC 记录 |
| `DMARC_NO_POLICY` | 🟠 High | 缺少 `p=` 策略 |
| `DMARC_POLICY_NONE` | 🟡 Medium | `p=none` —— 监控模式，无强制执行 |
| `DMARC_PCT_LOW` | 🔵 Low | `pct` < 100 —— 部分强制执行 |
| `DMARC_NO_RUA` | 🔵 Low | 没有聚合报告地址（`rua`） |
| `DMARC_MULTIPLE` | 🟠 High | 多条 DMARC 记录 —— 接收方会全部忽略 |
| `DMARC_INVALID_POLICY` | 🟠 High | `p=` 不是 none、quarantine 或 reject |
| `DMARC_SUBDOMAINS_NONE` | 🟡 Medium | `sp=none` 使子域名可被仿冒 |
| `DOMAIN_NOT_FOUND` | 🟠 High | 域名不存在（NXDOMAIN） |

没有自己 DMARC 记录的子域名会像接收方一样继承父域名的记录（`sp=` 策略）。子域名枚举会检测通配符 DNS，并排除仅由通配符应答的名称。

## 子域名接管检测

每个带 CNAME 的存活子域名都会沿 CNAME 链（最多 5 跳）进行检查。通配符记录也会检查：悬空的 `*.domain` 会让所有未列出的名称都可被接管。

| 风险 | 条件 | 服务商 |
|---|---|---|
| ⚠️ **可被接管** | 服务商允许任何人认领该名称 | AWS S3（`NoSuchBucket` 页面）、Microsoft Azure 与 AWS Elastic Beanstalk（CNAME 目标 NXDOMAIN）、Surge.sh（`project not found`），以及指向**未注册**域名的任何 CNAME |
| ⚠️ **需人工确认** | 资源已删除，但服务商可能要求域名验证 | GitHub Pages、Heroku、Netlify、Vercel、Ghost、Pantheon、WordPress.com、Help Scout、Tumblr、ngrok |
| 🧹 **过期** | 目标已删除，但位于仅其所有者可控的已注册域名下 —— 删除该记录；不属于接管，不会让 CI 失败 | 其他服务商 |

每个页面指纹都已用服务商上一个随机的未认领名称验证；"未找到"页面已不再带有稳定标记的服务商未列入。HTTP 检查会向子域名发送一次 `GET /`（先 HTTPS 再 HTTP）；可用 `--no-http` / `httpProbe: false` 关闭。对已知主机名请使用 `check_takeover` / `takeover <host…>`。

---

## CLI — CI/CD 集成

除 MCP 服务器模式外，也可直接作为 CLI 使用：

```bash
# Full DNS + email security check
npx @guardbee/mcp-dns-intelligence check example.com

# Fail only on high and above
npx @guardbee/mcp-dns-intelligence check example.com --fail-on=high

# Subdomain scan — exits 1 if a dangling CNAME is found
npx @guardbee/mcp-dns-intelligence subdomains example.com

# Subdomain scan with higher concurrency
npx @guardbee/mcp-dns-intelligence subdomains example.com --concurrency=50

# JSON output
npx @guardbee/mcp-dns-intelligence check example.com --format=json
```

**退出码：** `0` = 无问题 · `1` = 超过阈值的发现 / 悬空子域名 · `2` = 错误

### 通过 guardbee.yml 配置

在项目根目录创建 `guardbee.yml` 以持久化 CLI 标志。CLI 标志始终覆盖文件设置。

```yaml
dns-intelligence:
  fail-on: high          # critical | high | medium | low
  concurrency: 20        # parallel subdomain probes
  domains:               # used when no domain is given on the CLI
    - example.com
    - staging.example.com
```

示例文件见 [`guardbee.example.yml`](guardbee.example.yml)。

### GitHub Actions — DNS 安全审计

```yaml
name: DNS Security Check
on:
  schedule:
    - cron: "0 6 * * *"  # Every day at 06:00
  workflow_dispatch:

jobs:
  dns-check:
    runs-on: ubuntu-latest
    steps:
      - name: Check DNS configuration
        run: npx @guardbee/mcp-dns-intelligence check ${{ vars.DOMAIN }} --fail-on=high

      - name: Scan for dangling subdomains
        run: npx @guardbee/mcp-dns-intelligence subdomains ${{ vars.DOMAIN }}
```

### GitLab CI

```yaml
dns-security:
  image: node:20
  script:
    - npx @guardbee/mcp-dns-intelligence check $DOMAIN --fail-on=high
    - npx @guardbee/mcp-dns-intelligence subdomains $DOMAIN
  only:
    - schedules
```

### 部署前邮件安全检查

```yaml
- name: Verify email security records
  run: |
    npx @guardbee/mcp-dns-intelligence check ${{ vars.DOMAIN }} \
      --fail-on=high \
      --format=json | tee dns-report.json

- name: Upload DNS report
  uses: actions/upload-artifact@v4
  with:
    name: dns-security-report
    path: dns-report.json
```

---

## 开发

```bash
npm install
npm test          # 23 unit tests
npm run build     # TypeScript compile
```

---

## 许可证

MIT — [GuardBee](https://guardbee.ai)
