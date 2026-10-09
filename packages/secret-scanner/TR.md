# @guardbee/mcp-secret-scanner

[🇬🇧 English](README.md) | **🇹🇷 Türkçe** | [🇨🇳 中文](ZH.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-secret-scanner.svg)](https://www.npmjs.com/package/@guardbee/mcp-secret-scanner)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-secret-scanner.svg)](https://www.npmjs.com/package/@guardbee/mcp-secret-scanner)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Kaynak dosyalarınızı, dizinleri ve ortam konfigürasyonlarını açık API key, parola, token ve diğer gizli bilgiler açısından tarayan MCP sunucusu. Claude'a doğrudan projenizden secret sızdırıp sızdırmadığınızı sorabilirsiniz.

> Bu paket varsayılan olarak kullanım telemetrisi gönderir (tool adı + dosya yolu gibi kısa parametreler — taranan dosya içeriği hiçbir zaman dahil değil, bkz. [`@guardbee/mcp-telemetry`](../telemetry/TR.md)). Kapatmak için `GUARDBEE_TELEMETRY=0`.

---

## Özellikler

- **38 Secret Deseni** — AWS, GitHub, GitLab, Stripe, OpenAI, Anthropic, HuggingFace, Slack, Twilio, SendGrid ve daha fazlası. Kurallar [`@guardbee/guard-core`](../guard-core/TR.md) içinde durduğu için `@guardbee/mcp-security-proxy` aynı formatları çalışma anında tool sonuçlarında maskeler
- **Dosya & Dizin Tarama** — Tek dosya veya tüm proje ağacı
- **Git Geçmişi & Staged Tarama** — `--history`, herhangi bir commit'in eklediği her satırı tarar; dosyalardan silinmiş ama repoda hâlâ duran bir key bulunur ve onu ekleyen commit'te (yazar ve tarihle) bir kez raporlanır; `--staged` yalnızca commit'lemek üzere olduğunuz satırları tarar
- **Baseline** — `--write-baseline` bugünkü bulguları hash olarak kaydeder (secret'ların kendisini asla; commit'lemek güvenlidir); `--baseline` sonra yalnızca yenilerini raporlar, böylece mevcut bir repo her şeyi önce düzeltmeden scanner'ı CI'a alabilir. SARIF sonuçları kalıcı bir `partialFingerprints` değeri taşır
- **Yüksek Entropili Değerler** — secret'a benzeyen bir ada atanmış rastgele görünümlü bir değer (`.env`'de `WEBHOOK_SIGNING_SECRET=…`, YAML'da `client_secret:`, JSON'da `"internalApiKey"`) hiçbir sağlayıcı kuralı formatını bilmese de raporlanır. Rastgelelik Shannon entropisiyle ölçülür (hex değerler 32+ karakter ister; rakam içermeyen değerler daha yüksek eşiği geçmelidir, böylece camel-case bir parola sayılmaz); `public`/`publishable`, `*_hash`, `*_id` ve `*_url` adları, yer tutucular ve `${VAR}` referansları atlanır, bir sağlayıcı kuralının zaten raporladığı değer ikinci kez raporlanmaz. Önem medium, test dosyalarında low; `--no-entropy` (ya da MCP araçlarında `entropy: false`) kapatır
- **Ajan Transcript'leri** — `scan --agent-history` (MCP: `scan_agent_history`) kodlama ajanlarının makinenizde tuttuklarını tarar: Claude Code (`~/.claude/projects`, `~/.claude.json`), Codex (`~/.codex`), Gemini CLI (`~/.gemini/tmp`) ve Continue (`~/.continue/sessions`). Sohbete yapıştırılan ya da ajanın çalıştırdığı bir komutun yazdırdığı key orada kalır — ve model sağlayıcısına zaten gönderilmiştir, döndürün. Her secret ajan başına bir kez, kaç kez geçtiğiyle raporlanır; transcript'ler ajanın okuduğu kodla dolu olduğundan entropi kontrolü burada `--entropy` verilmedikçe kapalıdır
- **Büyük Satır Dosyaları** — 1 MB'ı aşan `.jsonl`, `.ndjson`, `.ipynb` ve `.log` dosyaları (transcript'ler, çıktılı notebook'lar, log'lar) atlanmak yerine satır satır okunur
- **Akıllı Atlama** — `node_modules`, `.git`, `dist`, `build`, `.next` gibi dizinler otomatik atlanır
- **Güvenli Redaksyon** — Eşleşmeler ilk 4 + yıldız + son 4 karakter olarak gösterilir
- **Allowlist Desteği** — Bilinen test/sahte değerleri beyaz listeye alın
- **64 Unit Test** — %100 geçen test paketi

---

## Hızlı Başlangıç

```bash
npm install -g @guardbee/mcp-secret-scanner
```

`claude_desktop_config.json` dosyasına ekleyin:

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

## MCP Tools

| Tool | Açıklama |
|------|----------|
| `scan_text` | Verilen metin içinde secret tarar |
| `scan_file` | Tek bir dosyayı tarar |
| `scan_directory` | Bir dizini ve alt dizinlerini yinelemeli olarak tarar |
| `scan_git` | Bir git reposunun staged değişikliklerini ya da her commit'in eklediği satırları (geçmiş) tarar |
| `scan_agent_history` | Bu makinedeki kodlama ajanlarının transcript'lerini tarar (Claude Code, Codex, Gemini CLI, Continue) |
| `list_patterns` | Tüm aktif secret desenlerini listeler |

### Örnek Kullanım

Claude'a şunu sorabilirsiniz:

> "Projemdeki gizli bilgileri tara: `/Users/me/my-app`"

> "Bu `.env` dosyasında secret var mı?"

> "Şu metin güvenli mi: `export API_KEY=sk-abc123...`"

---

## Tespit Edilen Secret Türleri

| Kategori | Örnekler |
|----------|---------|
| Cloud | AWS Access Key, AWS Secret, GCP API Key |
| Source Control | GitHub PAT, GitLab Token |
| Ödeme | Stripe Secret/Publishable Key |
| AI | OpenAI API Key, Anthropic API Key, HuggingFace Token |
| İletişim | Slack Bot Token, Twilio Auth Token, SendGrid Key |
| Veritabanı | PostgreSQL URL, MySQL URL, MongoDB URI, Redis URL |
| Kriptografi | RSA Private Key, EC Private Key, OpenSSH Key, PGP Key |
| Web | JWT Token, Bearer Token |
| Paket / Platform | npm Token, Docker Hub Token, Vercel Token |
| Genel | `SECRET=`, `PASSWORD=`, `API_KEY=` kalıpları |

---

## Güvenlik Notu

Bu araç tarama sonuçlarında eşleşen değerleri **kısmen redakte eder** (`sk_live_abc1...xyz9` gibi). Tam değerler asla log'a yazılmaz veya dışarı aktarılmaz.

---

## CLI — CI/CD Entegrasyonu

MCP server moduna ek olarak doğrudan CLI olarak da kullanılabilir:

```bash
# Proje dizinini tara
npx @guardbee/mcp-secret-scanner scan ./my-project

# Tek dosya tara
npx @guardbee/mcp-secret-scanner scan .env

# Sadece critical/high'da başarısız ol
npx @guardbee/mcp-secret-scanner scan . --fail-on=high

# JSON çıktı (CI raporlama için)
npx @guardbee/mcp-secret-scanner scan . --format=json
# Bu makinedeki Claude Code / Codex / Gemini CLI / Continue oturumlarına yapıştırılan secret'lar
npx @guardbee/mcp-secret-scanner scan --agent-history
# Pre-commit: yalnızca commit'lemek üzere olduğunuz satırlar
npx @guardbee/mcp-secret-scanner scan --staged

# Her branch'teki her commit (dosyalardan silinmiş key'leri bulur)
npx @guardbee/mcp-secret-scanner scan . --history
npx @guardbee/mcp-secret-scanner scan . --history=main..HEAD   # sadece bu branch

# Mevcut bir repoyu alın: bilinen bulguları bir kez kaydedin, sonra yalnızca yenilerde başarısız olun
npx @guardbee/mcp-secret-scanner scan . --history --write-baseline=.guardbee-secrets-baseline.json
npx @guardbee/mcp-secret-scanner scan . --history --baseline=.guardbee-secrets-baseline.json
```

**Exit kodları:** `0` = secret bulunamadı · `1` = secret bulundu · `2` = hata

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
          fetch-depth: 0   # --history için tüm geçmiş
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

### Pre-commit Hook

```bash
# .git/hooks/pre-commit
npx @guardbee/mcp-secret-scanner scan --staged --fail-on=high || exit 1
```

---

## Geliştirme

```bash
npm install
npm test          # 64 unit test
npm run build     # TypeScript derleme
```

---

## Lisans

MIT — [GuardBee](https://guardbee.ai)
