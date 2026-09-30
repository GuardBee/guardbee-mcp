# @guardbee/mcp-elicitation-auditor

[🇬🇧 English](README.md) | **🇹🇷 Türkçe**

MCP server kaynağını **2026-07-28 spesifikasyonundaki elicitation anti-pattern'leri** için tarayan bir MCP server.

Bu revizyon sampling ve roots'u deprecated etti. Bir server'ın istemciden bir şey istemesinin kalan yolu elicitation. Form modu veriyi istemcinin içinden toplar. URL modu kullanıcıyı, istemcinin okumaması gereken bir sayfaya gönderir.

> Bu paket varsayılan olarak kullanım telemetrisi gönderir (tool adı + kısa parametreler; taranan kod hiç gitmez — bkz. [`@guardbee/mcp-telemetry`](../telemetry/TR.md)). Kapatmak için `GUARDBEE_TELEMETRY=0`.

```
Claude ──► elicitation-auditor ──► MCP server kaynağı
              │
              ├─ form-secrets   (form modu şifre, API anahtarı, token veya kart istiyor, ya da link gömüyor)
              ├─ url-binding    (URL modu doğrudan üçüncü parti authorize adresini açıyor)
              ├─ url-exposure   (elicitation URL'sinde credential veya e-posta)
              ├─ transport      (localhost dışında düz http)
              ├─ identity       (form cevabı kullanıcının kimliği sanılıyor)
              └─ completion     (decline/cancel bakılmadan sonuç kullanılıyor)
```

## Ne yakalar

- **Form modunda secret.** `elicitInput` / `ctx.elicit` / `elicitation/create` çağrısı, mode yok ya da `form`, şema `password`, `apiKey`, `access_token`, `cvv` ailesinden bir alan istiyor. İsim ve e-posta formu spec'in izin verdiği durumdur, işaretlenmez. `secretQuestion`, `secret` sayılmaz.
- **Doğrudan üçüncü parti authorize.** URL modundaki `url` yolu `authorize`, `oauth` veya `oauth2` içeriyor ve kendi `/connect` rotanızdan geçmiyor. Spec'teki iletilen-link oltalaması budur: yönlendirmeden önce bağlantıyı açan oturum, elicitation'ı başlatan MCP kullanıcısıyla eşleşmelidir.
- **URL içinde credential veya kişisel veri.** `access_token`, `code`, `email` gibi query anahtarları. URL, MCP istemcisine gösterilir.
- **Düz HTTP**, `localhost` ve `127.0.0.1` hariç.
- **Form içindeki tıklanabilir adres.** Form mesajı veya alan açıklaması `http` linki taşıyor. Spec bu linki URL moduna koyar.
- **Form cevabının kimlik sanılması.** Gelen e-posta veya kullanıcı adı `findUser`, `loginAs` gibi bir çağrıya gidiyor ya da `req.user`'a yazılıyor; token'daki `sub` ile karşılaştırma yok.
- **Yok sayılan decline/cancel.** Kod `.content` okuyor ama `.action`, `decline` veya `cancel` bakmıyor. `action !== "accept"` kontrolü yeterli. E-postayı bildirim adresi olarak kullanmak kimlik kontrolü sayılmaz.

## Tool'lar

| Tool | Amaç |
|---|---|
| `scan_text` | Bir kaynak metnini tara |
| `scan_file` | Tek dosya |
| `scan_directory` | Özyinelemeli tarama |
| `list_patterns` | Kontrolleri listele |

## CLI

```
npx @guardbee/mcp-elicitation-auditor scan <path> [--fail-on=any] [--format=text|json|sarif]
```

`guardbee.yml`:

```yaml
elicitation-auditor:
  fail-on: high
  max-files: 5000
  exclude:
    - ".test.ts"
```

API anahtarı yok. Yalnızca statik analiz.
