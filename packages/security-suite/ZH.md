# @guardbee/security-suite

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | **🇨🇳 中文** | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/security-suite.svg)](https://www.npmjs.com/package/@guardbee/security-suite)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

一个元包，将全部 GuardBee MCP 安全工具打包为一个包。密钥扫描器、依赖审计、SSL 检查与 DNS 情报均可从一次安装获得。

> 本包默认发送使用遥测（工具名 + 较短的参数——见 [`@guardbee/mcp-telemetry`](../telemetry/README.md)）。设置 `GUARDBEE_TELEMETRY=0` 即可关闭。

---

## 快速开始

```bash
npm install -g @guardbee/security-suite
```

### Claude Desktop（MCP —— 全部工具，一个服务器）

```json
{
  "mcpServers": {
    "guardbee": {
      "command": "npx",
      "args": ["-y", "@guardbee/security-suite", "serve"]
    }
  }
}
```

---

## CLI 用法

```bash
guardbee secret-scan <path>           # Secret scanning
guardbee dep-audit <dir>              # CVE audit
guardbee ssl-inspect <domain>...      # TLS inspection
guardbee dns-check <domain>           # DNS/SPF/DMARC check
```

### 常用选项

```
--fail-on=<level>     critical | high | medium | low  (default: tool-specific)
--format=text|json|sarif
```

### 示例

```bash
guardbee secret-scan . --fail-on=high
guardbee dep-audit . --fail-on=critical --format=sarif > results.sarif
guardbee ssl-inspect example.com api.example.com shop.example.com
guardbee dns-check example.com --fail-on=medium
```

---

## CI/CD 集成

### GitHub Actions

```yaml
name: Security Suite
on: [push, pull_request]

jobs:
  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci

      - name: Secret scan
        run: npx @guardbee/security-suite secret-scan . --fail-on=high

      - name: Dependency audit
        run: npx @guardbee/security-suite dep-audit . --fail-on=high

      - name: SARIF upload (GitHub Security tab)
        if: always()
        run: |
          npx @guardbee/security-suite secret-scan . --format=sarif > secrets.sarif || true
          npx @guardbee/security-suite dep-audit . --format=sarif > deps.sarif || true

      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: secrets.sarif

      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: deps.sarif
```

### GitLab CI

```yaml
include:
  - template: Security/Secret-Detection.gitlab-ci.yml

guardbee-security:
  image: node:20
  script:
    - npx @guardbee/security-suite secret-scan . --fail-on=high
    - npx @guardbee/security-suite dep-audit . --fail-on=high
  only:
    - merge_requests
    - main
```

---

## 包含的工具

| 命令 | 包 | 说明 |
|------|-------|----------|
| `secret-scan` | `@guardbee/mcp-secret-scanner` | 通过 40+ 种模式检测密钥 |
| `dep-audit` | `@guardbee/mcp-dependency-auditor` | OSV CVE 数据库审计 |
| `ssl-inspect` | `@guardbee/mcp-ssl-inspector` | TLS 证书与加密套件分析 |
| `dns-check` | `@guardbee/mcp-dns-intelligence` | DNS、SPF、DMARC、悬空子域名 |

---

## 许可证

MIT — [GuardBee](https://guardbee.ai)
