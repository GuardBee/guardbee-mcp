# MCP Security Benchmark — dev split

2026-10-31. Precision, recall and F1 with bootstrap 95% intervals (1000 resamples, positives and negatives resampled separately). Latency is the mean per item on the machine that ran it. See [README](../README.md) for the data, the settings and the limitations.

## Tool definitions: poisoned vs benign (n=30)

| System | Version | Precision | Recall | F1 | False-positive rate | ms/item |
| --- | --- | --- | --- | --- | --- | --- |
| GuardBee (rules + judge qwen2.5:7b) | guard-core 1.4.1, qwen2.5:7b | 78% (54%–100%) | 47% (20%–73%) | 0.58 (32–80) | 13% | 772 |
| GuardBee (rules) | guard-core 1.4.1 | 80% (40%–100%) | 27% (7%–53%) | 0.40 (11–64) | 7% | <1 |
| mcp-guardian | 2.4.0 | 80% (50%–100%) | 27% (7%–53%) | 0.40 (12–64) | 7% | <1 |
| Cisco MCP Scanner (YARA) | 4.8.7 | 100% (100%–100%) | 20% (0%–40%) | 0.33 (0–57) | 0% | 110 |

## Tool results: indirect injection vs benign (n=26)

| System | Version | Precision | Recall | F1 | False-positive rate | ms/item |
| --- | --- | --- | --- | --- | --- | --- |
| GuardBee (rules + judge qwen2.5:7b) | guard-core 1.4.1, qwen2.5:7b | 75% (56%–100%) | 69% (38%–92%) | 0.72 (50–89) | 23% | 685 |
| mcp-guardian | 2.4.0 | 50% (20%–80%) | 31% (8%–54%) | 0.38 (11–64) | 31% | <1 |
| GuardBee (rules) | guard-core 1.4.1 | 60% (0%–100%) | 23% (0%–46%) | 0.33 (0–60) | 15% | <1 |
| Cisco MCP Scanner (YARA) | 4.8.7 | 100% (100%–100%) | 15% (0%–38%) | 0.27 (0–56) | 0% | 99 |

## Tool catalogs: toxic flow (lethal trifecta) vs safe (n=12)

| System | Version | Precision | Recall | F1 | False-positive rate | ms/item |
| --- | --- | --- | --- | --- | --- | --- |
| GuardBee (rules) | guard-core 1.4.1 | 100% (100%–100%) | 67% (33%–100%) | 0.80 (50–100) | 0% | <1 |

## Rug pulls: malicious vs benign definition changes (n=10)

| System | Version | Precision | Recall | F1 | False-positive rate | ms/item |
| --- | --- | --- | --- | --- | --- | --- |
| GuardBee (drift + content) | guard-core 1.4.1 | 100% (100%–100%) | 100% (100%–100%) | 1.00 (100–100) | 0% | <1 |
| GuardBee (rules) | guard-core 1.4.1 | 50% (50%–50%) | 100% (100%–100%) | 0.67 (67–67) | 100% | <1 |

## Settings

- **GuardBee (rules)** (guard-core 1.4.1): tool: any scanToolCatalog finding; result: scanToolResult warn or block; flow: lethal trifecta; rug pull: definition hash changed
- **GuardBee (drift + content)** (guard-core 1.4.1): rug pull: changed AND (new poisoning finding OR new capability label OR readOnlyHint dropped)
- **GuardBee (rules + judge qwen2.5:7b)** (guard-core 1.4.1, qwen2.5:7b): rules OR judge malicious at confidence >= 0.7 (local http://127.0.0.1:11434/v1)
- **mcp-guardian** (2.4.0): scanToolDescription(name, text).status !== 'clean' (text: description + parameter descriptions; for results, the result text)
- **Cisco MCP Scanner (YARA)** (4.8.7): --analyzers yara static; flagged when is_safe is false. Tools: --tools; results: --prompts (text as the prompt description)
