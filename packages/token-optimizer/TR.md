# @guardbee/mcp-token-optimizer

[🇬🇧 English](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/token-optimizer/README.md) | **🇹🇷 Türkçe** | [🇨🇳 中文](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/token-optimizer/ZH.md) | [🇯🇵 日本語](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/token-optimizer/JA.md) | [🇰🇷 한국어](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/token-optimizer/KO.md) | [🇧🇷 Português](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/token-optimizer/PT-BR.md) | [🇪🇸 Español](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/token-optimizer/ES.md) | [🇩🇪 Deutsch](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/token-optimizer/DE.md)

Bu makinede Claude Code token'larını neyin yaktığını bulan ve durduran MCP sunucusu.

Asıl suçlu genelde uzun prompt değil, bağlam boyutudur: her mesaj tüm konuşmayı yeniden gönderir, bu yüzden 800k token'lık bir oturum mesaj başına 25k'lık bir oturumdan yaklaşık otuz kat pahalıdır. Büyük dosya okumaları ve geveze MCP araçları bağlamı oraya taşır; unutulan oturumlar ve kullanılmayan MCP sunucuları gerisini ekler.

> Telemetri varsayılan olarak **kapalıdır**. Sunucu yerel dosyaları okur ve yalnızca söylediğin şeyi değiştirir.

## Araçlar

| Araç | Ne yapar | Bir şey değiştirir mi? |
|---|---|---|
| `optimize_report` | Öncelik sıralı öneriler: büyük canlı ve geçmiş bağlamlar, bağlamı dolduran dosya okumaları ve MCP sunucuları, kullanılmayan MCP sunucuları, boşta oturumlar, subagent ve model dağılımı. | Hayır |
| `list_sessions` | Çalışan Claude Code süreçleri: çalışma süresi, CPU, meşgul/boşta, mevcut bağlam, son harcama. | Hayır |
| `stop_sessions` | Oturumları pid'e veya `idleHours`'a göre durdurur. | **Varsayılan dry run** |
| `audit_mcp_servers` | Claude Code'un yüklediği her MCP sunucusu (user, local, `.mcp.json`, plugin'ler, transcript'lerde görülen claude.ai bağlayıcıları ve yerleşikler), çağrı ve çıktı hacmiyle. | Hayır |
| `disable_mcp_servers` | Sunucuları config'lerini kaybetmeden yeni oturumlar için kapatır. | **Varsayılan dry run** |
| `restore_mcp_servers` | `disable_mcp_servers`'ı geri alır; argümansız çağrılırsa park edilenleri listeler. | **Varsayılan dry run** |
| `measure_mcp_definitions` | Yapılandırılmış her MCP sunucusunu başlatır, araçlarını listeler ve isim/açıklama/şemalarının kaç token tuttuğunu ölçer. Sonuçlar `optimize_report`'a girer. | Sunucuları çalıştırır |
| `install_hooks` / `uninstall_hooks` | Oturumun bağlamı eşiği geçince ve tek bir araç çıktısı bağlamı çok büyütünce **sana** uyarı gösteren hook'lar. | **Varsayılan dry run** |
| `install_statusline` / `uninstall_statusline` | Claude Code status line'ında bağlam boyutu, plan sayaçları, sıfırlanmaya kalan süre, mesaj başına plan maliyeti ve yabancı kullanım alarmı. | **Varsayılan dry run** |

### Güvenlik

- **Durdurma** yalnızca Claude Code CLI süreçlerine (masaüstü uygulamasına değil) `SIGTERM` gönderir; optimizer'ı çalıştıran oturuma ve üst süreçlerine asla dokunmaz. Transcript'ler korunur, `claude --resume` ile yeniden açılır.
- **Kapatma** Claude Code'un kendi anahtarlarını kullanır: `.mcp.json` sunucuları için `disabledMcpjsonServers`, plugin'ler için `enabledPlugins: false`. User ve local sunucuların anahtarı olmadığı için girdileri `~/.guardbee/token-optimizer/parked.json`'a taşınır, `restore` geri koyar. Her yazma öncesi orijinal dosya `~/.guardbee/token-optimizer/backups/`'a yedeklenir ve yazma atomiktir.
- claude.ai bağlayıcıları ve yerleşik entegrasyonlar raporlanır ama değiştirilmez; eklendikleri yerden kapatılırlar.
- Değişiklikler sonradan açılan oturumlarda geçerlidir. Açık bir oturum kapanırken `~/.claude.json`'ın kendi kopyasını geri yazabilir; kapattıktan sonra `audit_mcp_servers` ile kontrol et.

## Bağlam bütçesi uyarısı

Pahalı hata, büyümeye devam eden oturumdur. Hook her prompt'tan önce oturumun bağlamına bakar; eşiği (varsayılan 200k) geçince sana bir uyarı gösterir, sonra her prompt'ta değil her +100k'da bir. `/compact` sonrası yeniden kurulur.

```
⚠️ Bu oturumun bağlamı 314k token (eşik 200k). Her yeni mesaj bunun tamamını yeniden okuyor: mesaj başına 5 saatlik limitin ~%1.8'i. İş bittiyse /compact, konu değiştiyse /clear.
```

Plan payı, [`claude-usage-guard`](https://github.com/GuardBee/guardbee-mcp/tree/main/packages/claude-usage-guard) kalibre olunca görünür. Hook transcript'in yalnızca sonunu okur (~0,25 sn), eşiğin altında hiçbir şey yazmaz ve prompt'u asla engellemez.

```bash
npx @guardbee/mcp-token-optimizer install-hooks --threshold 150000 --lang tr --apply
```

## Büyük araç çıktısı uyarısı

Aynı `install-hooks`, çok veri döndürebilen araçlar (Read, Bash, Grep, Glob, WebFetch, WebSearch, alt ajanlar, MCP araçları) için bir `PostToolUse` hook'u ekler. Tek bir sonuç 10k token'dan fazla eklediğinde (`--tool-threshold`) neyin şiştiğini ve nasıl küçültüleceğini görürsün:

```
⚠️ Read (src/generated/schema.ts) bağlama ~38k token ekledi; oturum boyunca her yeni mesajda yeniden okunacak. Büyük dosyaları offset/limit ile parça parça oku ya da önce Grep ile yerini bul.
```

Görseller ~1.600 token sayılır; oturum başına üç dakikada en fazla bir uyarı. Mesaj sana gösterilir, modelin bağlamına bir şey eklenmez.

## Status line

```
Opus 5.5 · ctx 314k/1M (~%3.1/mesaj) · 5h 42% ↻2h30m → %100 13:55 · 7d 18% · 🚨 dış kullanım: detect
```

- **ctx**: güncel bağlam ve pencere boyutu; eşiği geçince sarı, iki katında kırmızı. Kalibrasyondan sonra bir sonraki mesajın 5 saatlik limitten payı.
- **5h / 7d**: son yanıttaki hesap geneli plan sayaçları (tüm cihazlar), 5 saatlik sıfırlanmaya kalan süre ve mevcut hız limite önce ulaşacaksa ulaşacağı saat.
- **🚨**: [claude-usage-guard](https://github.com/GuardBee/guardbee-mcp/tree/main/packages/claude-usage-guard/TR.md) alarmı son 12 saatte çaldı.

Ayrıca her taze sayaç okumasını claude-usage-guard için kaydeder; tespit oturum başına değil mesaj başına okuma alır. ~0,1 sn sürer, token harcamaz. Claude Code'da tek status line vardır: mevcut olan `--force` verilmedikçe korunur.

```bash
npx @guardbee/mcp-token-optimizer install-statusline --lang tr --apply
```

Hook'lar ve status line bu CLI'ı her prompt, araç çağrısı veya mesajda başlatır. Global kurulumdan (`npm i -g @guardbee/mcp-token-optimizer`) komut düz bir `node` çağrısıdır; npx'ten ise sabit sürümle `npx -y` üzerinden gider, bu daha yavaştır.

## Araç tanımı maliyeti

`measure_mcp_definitions` etkin her sunucuyu Claude Code gibi başlatır (stdio ya da SSE yanıtları dahil HTTP; `${VAR}` ve `${VAR:-varsayılan}` açılır) ve araçlarını listeler. Rakam, araçlar baştan yüklendiğindeki maliyettir; çok sayıda MCP aracı olduğunda Claude Code bunları tool search arkasına erteler ve kullanılana kadar yalnızca isimleri bağlam tutar.

## Kurulum

```bash
claude mcp add token-optimizer -- npx -y @guardbee/mcp-token-optimizer
```

CLI (`--apply` verilmedikçe değişiklikler dry run'dır):

```bash
npx @guardbee/mcp-token-optimizer report
npx @guardbee/mcp-token-optimizer sessions
npx @guardbee/mcp-token-optimizer stop --idle-hours 6 --apply
npx @guardbee/mcp-token-optimizer mcp
npx @guardbee/mcp-token-optimizer disable local my-server --project ~/code/app --apply
npx @guardbee/mcp-token-optimizer install-hooks --lang tr --apply
npx @guardbee/mcp-token-optimizer install-statusline --lang tr --apply
```

## Sınırlamalar

- Araç çıktısı karakterle ölçülür (token başına ~4); her görsel ~1.600 token sayılır.
- `measure_mcp_definitions` yapılandırılmış sunucu komutlarını çalıştırır; OAuth gerektiren sunucular ölçülmez, raporlanır.
- Süreç listesi `ps` kullanır; Windows'ta `list_sessions` ve `stop_sessions` bir şey yapmaz.

## İlgili

[`@guardbee/mcp-claude-usage-guard`](https://github.com/GuardBee/guardbee-mcp/tree/main/packages/claude-usage-guard) plan kullanımının bu makine dışından gelip gelmediğini kontrol eder; bu paket onun transcript okuyucusunu kullanır.
