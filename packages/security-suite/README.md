# @guardbee/security-suite

[![npm version](https://img.shields.io/npm/v/@guardbee/security-suite.svg)](https://www.npmjs.com/package/@guardbee/security-suite)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Tüm GuardBee MCP güvenlik araçlarını tek pakette toplayan meta-paket. Secret scanner, dependency auditor, SSL inspector ve DNS intelligence tek kurulumla kullanılabilir.

> Bu paket varsayılan olarak kullanım telemetrisi gönderir (tool adı + kısa parametreler — bkz. [`@guardbee/mcp-telemetry`](../telemetry/README.md)). Kapatmak için `GUARDBEE_TELEMETRY=0`.

---

## Hızlı Başlangıç

```bash
npm install -g @guardbee/security-suite
```

### Claude Desktop (MCP — tüm araçlar tek server)

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

## CLI Kullanımı

```bash
guardbee secret-scan <path>           # Secret taraması
guardbee dep-audit <dir>              # CVE denetimi
guardbee ssl-inspect <domain>...      # TLS denetimi
guardbee dns-check <domain>           # DNS/SPF/DMARC kontrolü
```

### Ortak Seçenekler

```
--fail-on=<level>     critical | high | medium | low  (varsayılan: araç özelinde)
--format=text|json|sarif
```

### Örnekler

```bash
guardbee secret-scan . --fail-on=high
guardbee dep-audit . --fail-on=critical --format=sarif > results.sarif
guardbee ssl-inspect example.com api.example.com shop.example.com
guardbee dns-check example.com --fail-on=medium
```

---

## CI/CD Entegrasyonu

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

## Dahil Olan Araçlar

| Araç | Paket | Açıklama |
|------|-------|----------|
| `secret-scan` | `@guardbee/mcp-secret-scanner` | 40+ pattern ile secret tespiti |
| `dep-audit` | `@guardbee/mcp-dependency-auditor` | OSV CVE veritabanı denetimi |
| `ssl-inspect` | `@guardbee/mcp-ssl-inspector` | TLS sertifika ve cipher analizi |
| `dns-check` | `@guardbee/mcp-dns-intelligence` | DNS, SPF, DMARC, dangling subdomain |

---

## Lisans

MIT — [GuardBee](https://guardbee.ai)
