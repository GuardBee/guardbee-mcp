# @guardbee/mcp-agent-graph-auditor

[🇬🇧 English](README.md) | **🇹🇷 Türkçe**

MCP (Model Context Protocol) sunucusu — bir multi-agent orkestrasyonu üzerinde bir ulaşılabilirlik (reachability) grafiği kuruyor ve **transitive excessive agency** buluyor: hiçbir zaman doğrudan tehlikeli bir tool verilmemiş ama delegation yapabildiği başka bir agent üzerinden yine de ona ulaşabilen bir agent.

`mcp-server-auditor`, bir MCP server'ın kendi tool'unun doğrudan shell/eval/SQL erişimi verdiğini yakalar. `ai-code-scanner`, tek bir agent'ın tool listesinde `execute_command` olduğunu yakalar. İkisi de **tek hop**: agent → tool. Multi-agent framework'leri ikinci bir kenar türü ekliyor — delegation, group chat, fonksiyon-çalıştırma yönlendirmesi — ve sadece `web_search` tool'u olan "güvenli görünen" bir agent, shell tool'u olan bir iş arkadaşına iş devretmesine izin verildiği an tehlikeli hale gelebiliyor. Bu iki-hop'luk yol, bir seferde sadece tek bir agent'ın kendi tool listesine bakan bir scanner için görünmez.

> Bu paket varsayılan olarak kullanım telemetrisi gönderir (tool adı + kısa parametreler, taranan kaynak hiçbir zaman dahil değil — bkz. [`@guardbee/mcp-telemetry`](../telemetry/TR.md)). Kapatmak için `GUARDBEE_TELEMETRY=0`.

```
Claude ──► agent-graph-auditor ──► Multi-agent Python kaynağınız
              │
              ├─ LangGraph   (add_node/add_edge — yapısal, graph API'sinden doğrudan okunuyor)
              ├─ CrewAI      (Agent/tools/allow_delegation + Crew üyeliği — heuristic)
              └─ AutoGen/ag2 (GroupChat üyeliği, code_execution_config, register_function — heuristic)
```

---

## Grafik nasıl kuruluyor

1. **Çıkar.** Framework'e özgü regex extractor'lar kaynaktan agent/tool node'larını ve ilişki kenarlarını çekiyor: `has_tool` (bir agent'ın kendi tool set'i), `delegates_to` (CrewAI `allow_delegation`, LangGraph `add_edge`), `group_member` (AutoGen `GroupChat` co-membership — herhangi bir üyenin çıktısı manager tarafından herhangi bir başka üyeye yönlendirilebilir), `executes_via` (AutoGen `register_function`'ın caller/executor ayrımı).
2. **Sınıflandır.** Her tool node'u isim-tabanlı bir capability kataloğuna karşı kontrol ediliyor (code execution, process execution, filesystem write, network, credentials access) — `ai-code-scanner`'ın excessive-agency kalıbının kullandığı aynı türden heuristic, sadece tek bir server'ın tool listesi yerine bir tool grafiğine uygulanıyor.
3. **Ulaş.** Her agent node'undan bir breadth-first search çalışıyor. Düz bir `has_tool` kenarıyla ulaşılan bir capability tool'u **direct** bulgu (ikinci bir agent olmasa da yine raporlanır, faydalıdır). Sadece en az bir `delegates_to`/`group_member`/`executes_via` kenarı geçildikten sonra ulaşılan bir capability tool'u **transitive** — bu paketin var olma sebebi olan bulgu — ve tool'un kendi taban severity'sinden bağımsız olarak her zaman critical raporlanır, çünkü onu elinde tutan agent bunun için hiç doğrudan denetlenmemiş.

LangGraph en güvenilir hedef: `add_node`/`add_edge` çağrıları kaynaktaki orkestrasyon grafiğinin **kendisi**, çıkarım gerekmiyor. CrewAI ve AutoGen, koddaki açık bir kenar yerine framework semantiğinden (`allow_delegation`, `GroupChat` üyeliği) delegation'ı çıkarım yapmayı gerektiriyor, bu yüzden bunları heuristic olarak değerlendirin — aşağıdaki Kısıtlamalar'a bakın.

---

## Özellikler

- **3 framework**: LangGraph (yapısal), CrewAI (heuristic), AutoGen/ag2 (heuristic)
- 5 kategoride **7 capability kuralı** (code-execution, process-execution, filesystem-write, network, credentials-access)
- **Direct** (tek-agent) ile **transitive** (delegation-geçen) excessive agency'yi ayırt eder — transitive olan, bu monorepo'daki hiçbir tek-agent scanner'ının yakalayamadığı şey
- Multi-hop farkında — 3+ agent'lı bir delegation zinciri de 2-agent'lı olan gibi bulunuyor
- SARIF 2.1.0 çıktısı — CI/CD entegrasyonu (GitHub Code Scanning vb.)
- `guardbee.yml` ile config dosyası desteği
- 31 unit test, ayrıca her üç framework için gerçekçi fixture'lara karşı uçtan uca doğrulama

---

## Hızlı Başlangıç

### Claude Desktop / MCP Client

```json
{
  "mcpServers": {
    "guardbee-agent-graph-auditor": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-agent-graph-auditor"]
    }
  }
}
```

### CLI (CI/CD)

```bash
npx @guardbee/mcp-agent-graph-auditor scan ./agents --fail-on=high --format=sarif > results.sarif
```

---

## MCP Tools

| Tool | Açıklama |
|------|----------|
| `scan_text` | Bir Python snippet'ini tarar |
| `scan_file` | Tek bir `.py` dosyasını tarar |
| `scan_directory` | Bir `.py` dosyaları dizinini recursive tarar |
| `list_patterns` | Tehlikeli-capability kataloğunu kategoriye göre listeler |

---

## Örnek

```python
researcher = Agent(role="Researcher", tools=[web_search_tool], allow_delegation=True)
ops = Agent(role="Ops Engineer", tools=[shell_tool], allow_delegation=False)
writer = Agent(role="Writer", tools=[], allow_delegation=False)
crew = Crew(agents=[researcher, ops, writer], tasks=[])
```

`researcher` hiçbir zaman `shell_tool`'a sahip değil — ama `allow_delegation=True` artı aynı `Crew`'da `ops` ile co-membership, ona sahip olan bir agent'a iş devredebileceği anlamına geliyor. Bu scanner şunu raporluyor:

```
🔴 CRITICAL  Transitive excessive agency: reaches shell_tool
   Path: Researcher → Ops Engineer → shell_tool

🔴 CRITICAL  Direct excessive agency: reaches shell_tool
   Path: Ops Engineer → shell_tool
```

`writer` — tool yok, delegation yok — hiç bulgu almıyor.

---

## Yapılandırma (`guardbee.yml`)

```yaml
agent-graph-auditor:
  fail-on: high       # any | critical | high | medium | none
  max-files: 2000
  exclude:
    - "**/*.test.py"
```

---

## Kısıtlamalar (bilinçli tasarım)

- **Tek-dosya kapsamı.** Her dosyanın grafiği bağımsız çıkarılıyor — Python değişken referansları dosyalar arasında çözülmüyor. Bir `Crew(agents=[researcher, ops])` çağrısı sadece **aynı dosyadaki** `Agent(...)` tanımlarına bağlanır, bir dizini tararken bile.
- **CrewAI/AutoGen çıkarımı heuristic**, gerçek bir Python parser değil — constructor gövdeleri tam parantez-eşleştirme yerine sınırlı bir metin penceresiyle yakalanıyor (`ai-code-scanner`'ın pattern-window eşleştirmesinin yaptığı aynı trade-off), yeniden atama, koşullu agent oluşturma ya da dinamik olarak kurulan tool listelerini takip etmiyor.
- **AutoGen'in `speaker_selection_method`'u** modellenmiyor — `GroupChat` co-membership her zaman iki-yönlü bir ulaşılabilirlik kenarı olarak ele alınıyor, bu tutucu (eksik-kapsayan değil, fazla-kapsayan) bir varsayım.
- **Capability sınıflandırması isim-tabanlı.** İçeride gizlice shell'e çıkan `search_tool` adlı bir tool işaretlenmez; `shell_tool_disabled` adlı bir tool işaretlenir. Bulguları gözden geçirin; kesin doğru olarak almayın.
- v1'de sadece Python kaynağı taranıyor — LangChain/LangGraph'ın JS/TS API'si henüz kapsanmıyor.

---

## Geliştirme

```bash
npm run build
npm test             # 31 unit test
```

---

## Lisans

MIT — [GuardBee](https://guardbee.ai)
