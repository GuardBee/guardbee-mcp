# @guardbee/mcp-dependency-auditor

[🇬🇧 English](README.md) | **🇹🇷 Türkçe** | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-dependency-auditor.svg)](https://www.npmjs.com/package/@guardbee/mcp-dependency-auditor)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-dependency-auditor.svg)](https://www.npmjs.com/package/@guardbee/mcp-dependency-auditor)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

npm ve pip manifestlerini bilinen CVE'ler için [OSV](https://osv.dev) veritabanına karşı tarayan MCP sunucusu. Tek paket sorgusu ayrıca PyPI, crates.io, Maven, Go ve RubyGems kapsar.

> Bu paket varsayılan olarak kullanım telemetrisi gönderir (tool adı + kısa parametreler — bkz. [`@guardbee/mcp-telemetry`](../telemetry/TR.md)). Kapatmak için `GUARDBEE_TELEMETRY=0`.

---

## Özellikler

- **OSV API Entegrasyonu** — Google'ın açık kaynak güvenlik açığı veri tabanı (ücretsiz, kimlik doğrulaması gerektirmez)
- **npm Desteği** — kesin sürümler `package-lock.json` / `npm-shrinkwrap.json` (v1/v2/v3), `pnpm-lock.yaml` (v5/v6/v9), `yarn.lock` (v1 ve Berry) ve `bun.lock` dosyalarından okunur; yoksa `package.json` aralıkları kullanılır. Geçişli paketler dahildir; lock dosyası işaretlemese bile (pnpm v9, yarn, bun) yalnızca geliştirme amaçlı paketler ayırt edilir
- **pip Desteği** — kesin sürümler `uv.lock`, `poetry.lock` ve `Pipfile.lock` dosyalarından okunur (dev grupları ayrılır); yoksa `requirements.txt`, `requirements/base.txt`, `requirements/prod.txt` ve `pyproject.toml`
- **Zararlı Paket Tespiti** — bilinen zararlı sürümler (OpenSSF `MAL-*` kayıtları ve CWE-506 olarak sınıflanan tavsiyeler; örneğin Eylül 2025'te ele geçirilen `chalk@5.6.1` / `debug@4.4.2`) kritik olarak ve raporun en başında gösterilir, kaldırma ve kimlik bilgisi yenileme önerisiyle birlikte; her `--fail-on` eşiğinde build'i kırar
- **Severity Skorlaması** — CVSS puanına veya metin buluşsal yöntemine göre Critical / High / Medium / Low
- **Düzeltme Sürümü** — Mevcut olduğunda `upgrade to X@Y.Z.Z` önerisi
- **CVE Bağlantıları** — NVD veya osv.dev'e doğrudan link
- **Tekilleştirilmiş Bulgular** — birbirinin takma adı olan tavsiyeler (GHSA + PYSEC, GHSA + MAL) tek bulguda birleşir; ignore listeleri bunların herhangi bir kimliğiyle eşleşir
- **Testler** — gerçek paket yöneticileriyle üretilmiş lock dosyaları ve sahte bir OSV API ile birim testleri

---

## Hızlı Başlangıç

```bash
npm install -g @guardbee/mcp-dependency-auditor
```

`claude_desktop_config.json` dosyasına ekleyin:

```json
{
  "mcpServers": {
    "guardbee-dependency-auditor": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-dependency-auditor"]
    }
  }
}
```

---

## MCP Tools

| Tool | Açıklama |
|------|----------|
| `audit_npm` | npm bağımlılıklarını denetler (package-lock, pnpm, yarn, bun lock dosyaları veya `package.json`) |
| `audit_pip` | Python bağımlılıklarını denetler (uv, Poetry, Pipenv lock dosyaları veya `requirements.txt` / `pyproject.toml`) |
| `audit_package` | Tek bir paketi ad, sürüm ve ekosisteme göre denetler |
| `audit_directory` | Desteklenen tüm manifest dosyalarını otomatik tespit ederek denetler |

### Örnek Kullanım

Claude'a şunu sorabilirsiniz:

> "Bu projemin npm bağımlılıklarını denetle: `/Users/me/my-app`"

> "lodash 4.17.20 sürümünde CVE var mı?"

> "Python projemi tara: `/Users/me/django-app`"

### Örnek Çıktı

```
⚠️  Found 3 vulnerabilities in 2/142 npm packages (1243ms)
   Critical: 1  High: 1  Medium: 1  Low: 0  Unknown: 0

[CRITICAL] lodash@4.17.20
  ID      : GHSA-35jh-r3h4-6jhm (CVE-2021-23337)
  Summary : Command injection via template
  Fix     : upgrade to lodash@4.17.21
  Details : https://nvd.nist.gov/vuln/detail/CVE-2021-23337
```

---

## Desteklenen Ekosistemler

`audit_package` tool'u şu ekosistemler için doğrudan sorgu yapabilir:

| Ekosistem | Parametre |
|-----------|-----------|
| npm | `npm` |
| Python | `PyPI` |
| Rust | `crates.io` |
| Java | `Maven` |
| Go | `Go` |
| Ruby | `RubyGems` |

---

## CLI — CI/CD Entegrasyonu

MCP server moduna ek olarak doğrudan CLI olarak da kullanılabilir:

```bash
# Dizindeki tüm bağımlılıkları denetle (npm + pip otomatik tespit)
npx @guardbee/mcp-dependency-auditor audit ./my-project

# Sadece npm
npx @guardbee/mcp-dependency-auditor audit-npm . --fail-on=critical

# Sadece pip
npx @guardbee/mcp-dependency-auditor audit-pip . --fail-on=high

# Tek paket
npx @guardbee/mcp-dependency-auditor audit-pkg lodash 4.17.20 npm

# JSON çıktı
npx @guardbee/mcp-dependency-auditor audit . --format=json
```

**Exit kodları:** `0` = temiz · `1` = threshold üstü bulgu · `2` = hata

### GitHub Actions

```yaml
name: Dependency Audit
on: [push, pull_request]

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - name: Audit dependencies
        run: npx @guardbee/mcp-dependency-auditor audit . --fail-on=high
```

### GitLab CI

```yaml
dependency-audit:
  image: node:20
  script:
    - npx @guardbee/mcp-dependency-auditor audit . --fail-on=high
  only:
    - merge_requests
    - main
```

### Pre-commit Hook

```bash
# .git/hooks/pre-push
npx @guardbee/mcp-dependency-auditor audit . --fail-on=critical || exit 1
```

---

## Geliştirme

```bash
npm install
npm test          # 20 unit test
npm run build     # TypeScript derleme
```

---

## Lisans

MIT — [GuardBee](https://guardbee.ai)
