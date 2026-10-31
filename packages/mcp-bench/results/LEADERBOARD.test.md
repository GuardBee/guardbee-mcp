# MCP Security Benchmark — test split

2026-10-31. Precision, recall and F1 with bootstrap 95% intervals (1000 resamples, positives and negatives resampled separately). Latency is the mean per item on the machine that ran it. See [README](../README.md) for the data, the settings and the limitations.

## Tool definitions: poisoned vs benign (n=30)

| System | Version | Precision | Recall | F1 | False-positive rate | ms/item |
| --- | --- | --- | --- | --- | --- | --- |
| GuardBee (rules + judge qwen2.5:7b) | guard-core 1.4.1, qwen2.5:7b | 100% (100%–100%) | 60% (40%–80%) | 0.75 (57–89) | 0% | 982 |
| mcp-guardian | 2.4.0 | 88% (63%–100%) | 47% (20%–73%) | 0.61 (33–80) | 7% | <1 |
| GuardBee (rules) | guard-core 1.4.1 | 100% (100%–100%) | 33% (13%–53%) | 0.50 (24–70) | 0% | <1 |
| Cisco MCP Scanner (YARA) | 4.8.7 | 100% (100%–100%) | 27% (7%–53%) | 0.42 (13–70) | 0% | 98 |

## Tool results: indirect injection vs benign (n=24)

| System | Version | Precision | Recall | F1 | False-positive rate | ms/item |
| --- | --- | --- | --- | --- | --- | --- |
| GuardBee (rules + judge qwen2.5:7b) | guard-core 1.4.1, qwen2.5:7b | 83% (67%–100%) | 83% (58%–100%) | 0.83 (67–96) | 17% | 654 |
| mcp-guardian | 2.4.0 | 100% (100%–100%) | 42% (17%–75%) | 0.59 (29–86) | 0% | <1 |
| GuardBee (rules) | guard-core 1.4.1 | 80% (50%–100%) | 33% (8%–58%) | 0.47 (14–74) | 8% | <1 |
| Cisco MCP Scanner (YARA) | 4.8.7 | 67% (0%–100%) | 17% (0%–42%) | 0.27 (0–53) | 8% | 106 |

## Tool catalogs: toxic flow (lethal trifecta) vs safe (n=12)

| System | Version | Precision | Recall | F1 | False-positive rate | ms/item |
| --- | --- | --- | --- | --- | --- | --- |
| GuardBee (rules) | guard-core 1.4.1 | 100% (100%–100%) | 83% (50%–100%) | 0.91 (67–100) | 0% | <1 |

## Rug pulls: malicious vs benign definition changes (n=10)

| System | Version | Precision | Recall | F1 | False-positive rate | ms/item |
| --- | --- | --- | --- | --- | --- | --- |
| GuardBee (drift + content) | guard-core 1.4.1 | 100% (100%–100%) | 80% (40%–100%) | 0.89 (57–100) | 0% | <1 |
| GuardBee (rules) | guard-core 1.4.1 | 50% (50%–50%) | 100% (100%–100%) | 0.67 (67–67) | 100% | <1 |

## Settings

- **GuardBee (rules)** (guard-core 1.4.1): tool: any scanToolCatalog finding; result: scanToolResult warn or block; flow: lethal trifecta; rug pull: definition hash changed
- **GuardBee (drift + content)** (guard-core 1.4.1): rug pull: changed AND (new poisoning finding OR new capability label OR readOnlyHint dropped)
- **GuardBee (rules + judge qwen2.5:7b)** (guard-core 1.4.1, qwen2.5:7b): rules OR judge malicious at confidence >= 0.7 (local http://127.0.0.1:11434/v1)
- **mcp-guardian** (2.4.0): scanToolDescription(name, text).status !== 'clean' (text: description + parameter descriptions; for results, the result text)
- **Cisco MCP Scanner (YARA)** (4.8.7): --analyzers yara static; flagged when is_safe is false. Tools: --tools; results: --prompts (text as the prompt description)
