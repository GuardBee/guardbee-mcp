# @guardbee/mcp-ssl-inspector

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | **🇨🇳 中文** | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-ssl-inspector.svg)](https://www.npmjs.com/package/@guardbee/mcp-ssl-inspector)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-ssl-inspector.svg)](https://www.npmjs.com/package/@guardbee/mcp-ssl-inspector)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

一个 MCP 服务器，检查任意域名的 TLS 证书、加密套件与协议配置。使用 Node.js 内置的 `tls` 模块——无外部依赖。

> 本包默认发送使用遥测（工具名 + 较短的参数——见 [`@guardbee/mcp-telemetry`](../telemetry/README.md)）。设置 `GUARDBEE_TELEMETRY=0` 即可关闭。

---

## 功能

- **证书检查** —— 有效性、距过期天数、SHA-256 指纹、SAN、颁发者链
- **协议检查** —— TLS 1.0/1.1 弃用警告，SSLv2/v3 严重警告
- **加密套件分析** —— 检测 NULL、EXPORT、RC4、DES、3DES、匿名加密套件
- **HSTS 检查** —— `Strict-Transport-Security` 头、max-age、includeSubdomains
- **批量扫描** —— 并行扫描 N 个域名
- **证书过期监控** —— 用 🚨 / ⚠️ / ✅ 图标标示即将过期
- **12 个单元测试** —— 纯逻辑测试，无需网络连接

---

## 快速开始

```bash
npm install -g @guardbee/mcp-ssl-inspector
```

添加到 `claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "guardbee-ssl-inspector": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-ssl-inspector"]
    }
  }
}
```

---

## MCP 工具

| 工具 | 说明 |
|------|----------|
| `inspect_ssl` | 对单个域名做完整 TLS 检查（证书 + 加密套件 + 协议 + HSTS） |
| `inspect_ssl_bulk` | 并行检查多个域名 |
| `check_cert_expiry` | 检查 N 个域名的证书过期日期 |
| `get_cert_info` | 域名的详细证书信息（指纹、SAN、链、序列号） |

### 使用示例

你可以这样问 Claude：

> "example.com 的 SSL 证书有效吗？"

> "这些域名的证书何时过期：example.com、api.example.com、shop.example.com"

> "example.com 是否在使用弱加密套件？"

### 输出示例

```
┌─ example.com:443
│  Protocol  : TLSv1.3
│  Cipher    : TLS_AES_256_GCM_SHA384 (256 bit)
│  Chain     : depth=2 valid=yes
│  Cert CN   : example.com
│  Validity  : Mar 15 2024 → Jun 13 2024 (expires in 45 days)
│  SANs      : example.com, www.example.com
│  Issuer    : Let's Encrypt
│  SHA-256   : AA:BB:CC:DD:...
│  HSTS      : enabled (max-age=31536000, includeSubdomains)
│  ✅ No security issues found
```

---

## 安全发现项

| 发现项 | 严重程度 | 说明 |
|-------|----------|----------|
| `CERT_EXPIRED` | 🔴 Critical | 证书已过期 |
| `CERT_EXPIRY_CRITICAL` | 🔴 Critical | 剩余 < 7 天 |
| `CERT_EXPIRY_SOON` | 🟠 High | 剩余 < 30 天 |
| `CERT_EXPIRY_WARN` | 🟡 Medium | 剩余 < 90 天 |
| `CERT_CHAIN_INVALID` | 🟠 High | 链验证错误 |
| `CERT_NO_SAN` | 🟡 Medium | 没有 Subject Alternative Name |
| `DEPRECATED_PROTOCOL` | 🟠 High | TLS 1.0 或 1.1 |
| `OBSOLETE_PROTOCOL` | 🔴 Critical | SSLv2 或 SSLv3 |
| `WEAK_CIPHER` | 🔴 Critical | NULL/EXPORT/RC4/匿名加密套件 |
| `NO_HSTS` | 🟡 Medium | 未找到 HSTS 头 |
| `HSTS_SHORT_MAX_AGE` | 🔵 Low | max-age < 15552000s |

---

## CLI — CI/CD 集成

除 MCP 服务器模式外，也可直接作为 CLI 使用：

```bash
# Full TLS inspection for a single domain
npx @guardbee/mcp-ssl-inspector inspect example.com

# Multiple domains
npx @guardbee/mcp-ssl-inspector inspect example.com api.example.com shop.example.com

# Custom port
npx @guardbee/mcp-ssl-inspector inspect example.com:8443

# Certificate expiry check
npx @guardbee/mcp-ssl-inspector expiry example.com api.example.com

# Fail only on critical
npx @guardbee/mcp-ssl-inspector inspect example.com --fail-on=critical

# JSON output
npx @guardbee/mcp-ssl-inspector inspect example.com --format=json
```

**退出码：** `0` = 无问题 · `1` = 超过阈值的发现 / 证书过期 · `2` = 错误

### 通过 guardbee.yml 配置

在项目根目录创建 `guardbee.yml` 以持久化 CLI 标志。CLI 标志始终覆盖文件设置。

```yaml
ssl-inspector:
  fail-on: high          # critical | high | medium | low
  port: 443
  hosts:                 # used when no domain is given on the CLI
    - example.com
    - api.example.com
    - shop.example.com
```

示例文件见 [`guardbee.example.yml`](guardbee.example.yml)。

### GitHub Actions — 部署后检查

```yaml
name: SSL Check
on:
  workflow_run:
    workflows: ["Deploy"]
    types: [completed]

jobs:
  ssl-check:
    runs-on: ubuntu-latest
    steps:
      - name: Inspect SSL certificate
        run: npx @guardbee/mcp-ssl-inspector inspect ${{ vars.DOMAIN }} --fail-on=high

      - name: Check cert expiry (warn if < 30 days)
        run: npx @guardbee/mcp-ssl-inspector expiry ${{ vars.DOMAIN }}
```

### 定时过期监控

```yaml
name: Cert Expiry Monitor
on:
  schedule:
    - cron: "0 9 * * 1"  # Every Monday at 09:00

jobs:
  expiry:
    runs-on: ubuntu-latest
    steps:
      - name: Check certificate expiry dates
        run: |
          npx @guardbee/mcp-ssl-inspector expiry \
            example.com \
            api.example.com \
            shop.example.com \
            --format=json
```

### GitLab CI

```yaml
ssl-inspect:
  image: node:20
  script:
    - npx @guardbee/mcp-ssl-inspector inspect $DOMAIN --fail-on=high
  environment:
    name: production
  only:
    - main
```

---

## 开发

```bash
npm install
npm test          # 12 unit tests
npm run build     # TypeScript compile
```

---

## 许可证

MIT — [GuardBee](https://guardbee.ai)
