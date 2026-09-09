# @guardbee/mcp-secret-scanner

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-secret-scanner.svg)](https://www.npmjs.com/package/@guardbee/mcp-secret-scanner)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-secret-scanner.svg)](https://www.npmjs.com/package/@guardbee/mcp-secret-scanner)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Kaynak dosyalarınızı, dizinleri ve ortam konfigürasyonlarını açık API key, parola, token ve diğer gizli bilgiler açısından tarayan MCP sunucusu. Claude'a doğrudan projenizden secret sızdırıp sızdırmadığınızı sorabilirsiniz.

---

## Özellikler

- **40+ Secret Deseni** — AWS, GitHub, GitLab, Stripe, OpenAI, Anthropic, HuggingFace, Slack, Twilio, SendGrid ve daha fazlası
- **Dosya & Dizin Tarama** — Tek dosya veya tüm proje ağacı
- **Akıllı Atlama** — `node_modules`, `.git`, `dist`, `build`, `.next` gibi dizinler otomatik atlanır
- **Güvenli Redaksyon** — Eşleşmeler ilk 4 + yıldız + son 4 karakter olarak gösterilir
- **Allowlist Desteği** — Bilinen test/sahte değerleri beyaz listeye alın
- **16 Unit Test** — %100 geçen test paketi

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

## Geliştirme

```bash
npm install
npm test          # 16 unit test
npm run build     # TypeScript derleme
```

---

## Lisans

MIT — [GuardBee](https://guardbee.ai)
