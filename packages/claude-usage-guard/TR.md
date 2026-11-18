# @guardbee/mcp-claude-usage-guard

[🇬🇧 English](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/claude-usage-guard/README.md) | **🇹🇷 Türkçe** | [🇨🇳 中文](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/claude-usage-guard/ZH.md) | [🇯🇵 日本語](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/claude-usage-guard/JA.md) | [🇰🇷 한국어](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/claude-usage-guard/KO.md) | [🇧🇷 Português](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/claude-usage-guard/PT-BR.md) | [🇪🇸 Español](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/claude-usage-guard/ES.md) | [🇩🇪 Deutsch](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/claude-usage-guard/DE.md)

Tek bir soruyu yanıtlayan MCP sunucusu: **Claude plan kullanımımın hepsi benden mi geliyor?**

Planın 5 saatlik ve 7 günlük limitleri hesaba bağlı her şey tarafından paylaşılır: her makinedeki Claude Code, claude.ai, masaüstü ve mobil uygulamalar ve oturumunu ödünç alan her script. Limitler beklenenden hızlı bittiğinde bu sunucu, hesap genelindeki plan sayacını bu makinedeki Claude Code'un gerçekten harcadığıyla karşılaştırır ve aradaki farkı gösterir.

> Telemetri varsayılan olarak **kapalıdır**. Sunucu yalnızca yerel dosyaları okur, makineden başka bir şey çıkmaz.

## Araçlar

| Araç | Ne yapar |
|---|---|
| `detect_foreign_usage` | Bir plan okuması kaydeder, okumalar arasındaki sayaç artışını bu makinenin kullanımıyla karşılaştırır; sonuç: `insufficient-data`, `no-evidence`, `suspicious` veya `likely-other-usage`. |
| `usage_report` | Yerel transcript'lerden bu makinenin Claude Code kullanımı; oturum, gün, proje, giriş noktası veya modele göre, her oturumun en büyük bağlamıyla. |
| `account_status` | Claude Code'un hangi hesapla oturum açtığı ve son çektiği 5 saatlik / 7 günlük sayaçlar. |

## Tespit nasıl çalışır

1. **Plan okumaları.** Claude Code, `/usage`'da gösterdiği sayaçları `~/.claude.json` içinde önbelleğe alır. Her çağrı bu okumayı `~/.guardbee/claude-usage-guard/snapshots.jsonl`'e yazar.
2. **Yerel harcama.** `~/.claude/projects` altındaki transcript'ler bu makinenin her model çağrısını içerir. Claude Code her içerik bloğu için ayrı satır yazıp yanıtın usage'ını her satırda tekrarladığı için çağrılar mesaj kimliğine göre bir kez sayılır (tüm satırları toplamak kullanımı 2-3 kat şişirir).
3. **Ağırlıklandırma.** Limitler ham token'ı değil maliyeti izler: `input + 1.25×cache yazma + 0.1×cache okuma + 5×output`, Sonnet ve Haiku için düşürülerek.
4. **Karşılaştırma.** Aynı limit penceresindeki her okuma çifti için:
   - sayaç **bu makine boştayken 3+ puan arttıysa** kalibrasyona gerek kalmadan işaretlenir;
   - aksi halde, üç yoğun aralıktan bir puanın kaç ağırlıklı token olduğunu öğrendikten sonra, bu makinenin artışın yarısından azını açıkladığı aralıklar işaretlenir.
5. **Yerel sinyaller.** Oturum açık hesaptan farklı bir hesap için çekilmiş plan okuması, oturumunu harcayan SDK/script giriş noktaları (`sdk-ts`, `sdk-py`, …), `who`'da görünen uzak girişler, etkileşimsiz Claude Code süreçleri.

"Başka yerden gelen kullanım" mutlaka başka bir kişi demek değildir: kendi claude.ai, masaüstü veya mobil sohbetlerin de aynı limitleri kullanır. Rapor bunu belirtir.

### Yeterli okuma toplamak

Tek okuma yetmez. Gün içinde `detect`'i birkaç kez çalıştır ya da snapshot komutunu zamanla:

```bash
*/30 * * * * npx -y @guardbee/mcp-claude-usage-guard snapshot
```

## Kurulum

```bash
claude mcp add claude-usage-guard -- npx -y @guardbee/mcp-claude-usage-guard
```

```bash
npx @guardbee/mcp-claude-usage-guard detect
npx @guardbee/mcp-claude-usage-guard report --hours 168 --by entrypoint
npx @guardbee/mcp-claude-usage-guard snapshot
```

## Sınırlamalar

- Yalnızca bu makinedeki Claude Code görünür. Başka bir cihaz isimle değil, açıklanamayan plan kullanımı olarak görünür.
- `cachedUsageUtilization` Claude Code'un iç alanıdır; kaybolur veya biçimi değişirse sunucu yalnızca yerel sinyallerle devam eder ve bunu söyler.
- Sayaçlar tam yüzde olduğu için 1 puanlık hareket yuvarlama sayılır.
- Model ağırlıkları yaklaşık göreli fiyatlardır.

## İlgili

[`@guardbee/mcp-token-optimizer`](https://github.com/GuardBee/guardbee-mcp/tree/main/packages/token-optimizer) bu makinede token yakan şeyleri bulur ve durdurur.
