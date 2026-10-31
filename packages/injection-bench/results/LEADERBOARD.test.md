# Prompt-Injection Benchmark (Turkish + English) — test split

2026-10-31. 1196 samples: English 326 attacks / 298 benign, Turkish 288 / 284. Bootstrap 95% intervals (1000 resamples, attacks and benign resampled separately). Latency per sample on the machine that ran it. See the [README](../README.md) for the data and its limitations.

## Turkish

| System | Precision | Recall | F1 | False-positive rate |
| --- | --- | --- | --- | --- |
| GuardBee rules + classifier (block) | 97.0% (94.9–98.9) | 90.6% (87.5–93.8) | 93.7 (91.6–95.6) | 2.8% (1.1–4.9) |
| GuardBee rules + classifier (block or warn) | 95.0% (92.3–97.2) | 91.7% (88.5–94.8) | 93.3 (91.0–95.2) | 4.9% (2.8–7.7) |
| GuardBee rules + judge (qwen2.5:7b) | 94.3% (91.0–96.9) | 85.4% (81.3–89.6) | 89.6 (86.8–92.3) | 5.3% (2.8–8.5) |
| ProtectAI DeBERTa-v3 prompt-injection v2 | 83.7% (79.4–88.4) | 60.4% (55.2–66.0) | 70.2 (66.0–74.5) | 12.0% (8.5–15.5) |
| GuardBee rules (block or warn) | 98.2% (94.3–100.0) | 18.8% (14.6–23.3) | 31.5 (25.4–37.7) | 0.4% (0.0–1.1) |
| GuardBee rules (block) | 100.0% (100.0–100.0) | 16.7% (12.8–20.8) | 28.6 (22.8–34.5) | 0.0% (0.0–0.0) |

## English

| System | Precision | Recall | F1 | False-positive rate |
| --- | --- | --- | --- | --- |
| GuardBee rules + classifier (block) | 98.6% (97.2–99.7) | 85.6% (81.9–89.3) | 91.6 (89.3–93.7) | 1.3% (0.3–2.7) |
| GuardBee rules + classifier (block or warn) | 93.0% (90.2–95.6) | 89.3% (85.9–92.3) | 91.1 (88.7–93.3) | 7.4% (4.4–10.7) |
| GuardBee rules + judge (qwen2.5:7b) | 94.1% (91.6–96.4) | 87.7% (84.4–91.1) | 90.8 (88.5–93.1) | 6.0% (3.7–8.7) |
| ProtectAI DeBERTa-v3 prompt-injection v2 | 98.5% (97.0–99.6) | 81.3% (77.0–85.3) | 89.1 (86.3–91.6) | 1.3% (0.3–2.7) |
| GuardBee rules (block or warn) | 87.1% (80.4–93.3) | 24.8% (20.6–29.4) | 38.7 (33.0–44.2) | 4.0% (2.0–6.4) |
| GuardBee rules (block) | 100.0% (100.0–100.0) | 11.3% (8.3–14.7) | 20.4 (15.3–25.7) | 0.0% (0.0–0.0) |

## Both languages

| System | Precision | Recall | F1 | False-positive rate |
| --- | --- | --- | --- | --- |
| GuardBee rules + classifier (block) | 97.8% (96.6–98.9) | 87.9% (85.5–90.6) | 92.6 (91.1–94.2) | 2.1% (1.0–3.3) |
| GuardBee rules + classifier (block or warn) | 93.9% (92.0–95.8) | 90.4% (88.1–92.8) | 92.1 (90.5–93.8) | 6.2% (4.1–8.2) |
| GuardBee rules + judge (qwen2.5:7b) | 94.2% (92.4–95.8) | 86.6% (83.9–89.4) | 90.2 (88.3–92.0) | 5.7% (4.0–7.6) |
| ProtectAI DeBERTa-v3 prompt-injection v2 | 92.0% (89.8–94.4) | 71.5% (68.1–74.9) | 80.5 (77.9–83.0) | 6.5% (4.6–8.8) |
| GuardBee rules (block or warn) | 91.2% (86.3–95.4) | 22.0% (19.1–25.1) | 35.4 (31.4–39.6) | 2.2% (1.2–3.6) |
| GuardBee rules (block) | 100.0% (100.0–100.0) | 13.8% (11.4–16.4) | 24.3 (20.5–28.3) | 0.0% (0.0–0.0) |

## By technique (share flagged: recall for attacks, false alarms for benign)

| Language | Label | Technique | n | GuardBee rules (block) | GuardBee rules (block or warn) | GuardBee rules + classifier (block) | GuardBee rules + classifier (block or warn) | GuardBee rules + judge (qwen2.5:7b) | ProtectAI DeBERTa-v3 prompt-injection v2 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| en | attack | direct_override | 226 | 13.7% | 16.8% | 82.3% | 86.7% | 83.6% | 79.6% |
| en | attack | jailbreak | 100 | 6.0% | 43.0% | 93.0% | 95.0% | 97.0% | 85.0% |
| en | benign | about_injection | 4 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| en | benign | code_and_config | 4 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| en | benign | instructions_to_human | 4 | 0.0% | 0.0% | 25.0% | 25.0% | 0.0% | 50.0% |
| en | benign | ordinary_request | 131 | 0.0% | 1.5% | 1.5% | 3.8% | 2.3% | 0.0% |
| en | benign | roleplay_benign | 153 | 0.0% | 6.5% | 0.7% | 9.8% | 9.8% | 1.3% |
| en | benign | translation_benign | 2 | 0.0% | 0.0% | 0.0% | 50.0% | 0.0% | 0.0% |
| tr | attack | authority_spoof | 3 | 0.0% | 0.0% | 33.3% | 33.3% | 66.7% | 66.7% |
| tr | attack | direct_override | 175 | 25.1% | 25.1% | 99.4% | 99.4% | 84.0% | 78.9% |
| tr | attack | embedded_in_task | 3 | 33.3% | 33.3% | 100.0% | 100.0% | 100.0% | 33.3% |
| tr | attack | encoding | 3 | 0.0% | 0.0% | 100.0% | 100.0% | 66.7% | 33.3% |
| tr | attack | jailbreak | 82 | 1.2% | 7.3% | 72.0% | 74.4% | 86.6% | 18.3% |
| tr | attack | mixed_tr_en | 3 | 0.0% | 33.3% | 100.0% | 100.0% | 100.0% | 100.0% |
| tr | attack | roleplay_jailbreak | 5 | 0.0% | 0.0% | 100.0% | 100.0% | 100.0% | 40.0% |
| tr | attack | suffix_stacking | 6 | 0.0% | 0.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| tr | attack | system_prompt_extraction | 5 | 0.0% | 0.0% | 100.0% | 100.0% | 80.0% | 60.0% |
| tr | attack | translation_pretext | 3 | 66.7% | 66.7% | 66.7% | 100.0% | 100.0% | 100.0% |
| tr | benign | about_injection | 4 | 0.0% | 25.0% | 0.0% | 25.0% | 50.0% | 25.0% |
| tr | benign | code_and_config | 4 | 0.0% | 0.0% | 25.0% | 25.0% | 0.0% | 75.0% |
| tr | benign | everyday | 4 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| tr | benign | instructions_to_human | 5 | 0.0% | 0.0% | 20.0% | 40.0% | 0.0% | 60.0% |
| tr | benign | ordinary_request | 93 | 0.0% | 0.0% | 2.2% | 4.3% | 1.1% | 17.2% |
| tr | benign | roleplay_benign | 168 | 0.0% | 0.0% | 1.8% | 3.0% | 7.1% | 5.4% |
| tr | benign | security_benign | 3 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| tr | benign | translation_benign | 3 | 0.0% | 0.0% | 33.3% | 33.3% | 0.0% | 66.7% |

## Latency and settings

| System | Version | ms/sample (mean / p95) | Settings |
| --- | --- | --- | --- |
| GuardBee rules (block) | guard-core 1.4.1 | 0.03 / 0.07 | scanForPromptInjection(text, 'block').action === 'block': only the precise rules; what the proxy refuses |
| GuardBee rules (block or warn) | guard-core 1.4.1 | 0.02 / 0.07 | scanForPromptInjection(text, 'block').action !== 'allow': precise rules and the generic phrases that only warn |
| GuardBee rules + classifier (block) | guard-core 1.4.1, guardbee/injection-classifier-tr-en@0.1.0 | 8.37 / 29.60 | rule block OR P(injection) >= 0.9: what the proxy refuses with classifier: {} (defaults) |
| GuardBee rules + classifier (block or warn) | guard-core 1.4.1, guardbee/injection-classifier-tr-en@0.1.0 | 8.54 / 29.34 | anything the rules flag OR P(injection) >= 0.5 |
| GuardBee rules + judge (qwen2.5:7b) | guard-core 1.4.1, qwen2.5:7b | 1034.22 / 2049.01 | rules (block or warn) OR judge verdict malicious at confidence >= 0.7 (local http://127.0.0.1:11434/v1) |
| ProtectAI DeBERTa-v3 prompt-injection v2 | 90c9989 (ONNX) | 62.04 / 300.65 | softmax P(INJECTION) >= 0.5 on the first 512 tokens (the model card's pipeline truncation); onnxruntime-node CPU |
