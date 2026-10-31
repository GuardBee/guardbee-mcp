# Prompt-Injection Benchmark (Turkish + English) — dev split

2026-10-31. 1198 samples: English 327 attacks / 298 benign, Turkish 288 / 285. Bootstrap 95% intervals (1000 resamples, attacks and benign resampled separately). Latency per sample on the machine that ran it. See the [README](../README.md) for the data and its limitations.

## Turkish

| System | Precision | Recall | F1 | False-positive rate |
| --- | --- | --- | --- | --- |
| ProtectAI DeBERTa-v3 prompt-injection v2 | 80.1% (75.8–84.7) | 57.3% (51.7–63.2) | 66.8 (62.1–71.4) | 14.4% (10.5–18.2) |
| GuardBee rules (block or warn) | 94.8% (88.7–100.0) | 19.1% (14.6–24.0) | 31.8 (25.2–38.2) | 1.1% (0.0–2.5) |
| GuardBee rules (block) | 96.2% (90.2–100.0) | 17.4% (13.2–21.9) | 29.4 (23.0–35.8) | 0.7% (0.0–1.8) |

## English

| System | Precision | Recall | F1 | False-positive rate |
| --- | --- | --- | --- | --- |
| ProtectAI DeBERTa-v3 prompt-injection v2 | 96.4% (94.1–98.2) | 82.3% (78.0–86.5) | 88.8 (86.1–91.3) | 3.4% (1.7–5.7) |
| GuardBee rules (block or warn) | 84.7% (78.3–91.1) | 28.7% (23.5–33.6) | 42.9 (36.3–48.6) | 5.7% (3.0–8.4) |
| GuardBee rules (block) | 97.6% (91.7–100.0) | 12.2% (8.6–15.9) | 21.7 (15.8–27.4) | 0.3% (0.0–1.3) |

## Both languages

| System | Precision | Recall | F1 | False-positive rate |
| --- | --- | --- | --- | --- |
| ProtectAI DeBERTa-v3 prompt-injection v2 | 89.5% (87.0–92.0) | 70.6% (67.0–74.3) | 78.9 (76.3–81.5) | 8.7% (6.5–11.1) |
| GuardBee rules (block or warn) | 88.2% (83.1–92.6) | 24.2% (21.0–27.3) | 38.0 (33.7–41.9) | 3.4% (2.1–5.0) |
| GuardBee rules (block) | 96.8% (92.6–100.0) | 14.6% (12.0–17.4) | 25.4 (21.3–29.5) | 0.5% (0.0–1.2) |

## By technique (share flagged: recall for attacks, false alarms for benign)

| Language | Label | Technique | n | GuardBee rules (block) | GuardBee rules (block or warn) | ProtectAI DeBERTa-v3 prompt-injection v2 |
| --- | --- | --- | --- | --- | --- | --- |
| en | attack | direct_override | 227 | 15.4% | 20.3% | 80.6% |
| en | attack | jailbreak | 100 | 5.0% | 48.0% | 86.0% |
| en | benign | about_injection | 4 | 25.0% | 50.0% | 50.0% |
| en | benign | code_and_config | 4 | 0.0% | 25.0% | 25.0% |
| en | benign | instructions_to_human | 4 | 0.0% | 0.0% | 75.0% |
| en | benign | ordinary_request | 131 | 0.0% | 0.0% | 0.8% |
| en | benign | roleplay_benign | 153 | 0.0% | 9.2% | 0.7% |
| en | benign | translation_benign | 2 | 0.0% | 0.0% | 100.0% |
| tr | attack | authority_spoof | 3 | 33.3% | 33.3% | 66.7% |
| tr | attack | direct_override | 175 | 25.7% | 25.7% | 73.1% |
| tr | attack | embedded_in_task | 3 | 0.0% | 0.0% | 33.3% |
| tr | attack | encoding | 3 | 0.0% | 0.0% | 66.7% |
| tr | attack | jailbreak | 82 | 2.4% | 7.3% | 17.1% |
| tr | attack | mixed_tr_en | 3 | 0.0% | 0.0% | 100.0% |
| tr | attack | roleplay_jailbreak | 5 | 0.0% | 20.0% | 40.0% |
| tr | attack | suffix_stacking | 6 | 0.0% | 0.0% | 100.0% |
| tr | attack | system_prompt_extraction | 5 | 0.0% | 0.0% | 80.0% |
| tr | attack | translation_pretext | 3 | 66.7% | 66.7% | 100.0% |
| tr | benign | about_injection | 4 | 25.0% | 50.0% | 25.0% |
| tr | benign | code_and_config | 4 | 0.0% | 0.0% | 25.0% |
| tr | benign | everyday | 4 | 0.0% | 0.0% | 25.0% |
| tr | benign | instructions_to_human | 5 | 0.0% | 0.0% | 80.0% |
| tr | benign | ordinary_request | 93 | 0.0% | 0.0% | 16.1% |
| tr | benign | roleplay_benign | 169 | 0.0% | 0.0% | 8.9% |
| tr | benign | security_benign | 3 | 0.0% | 0.0% | 66.7% |
| tr | benign | translation_benign | 3 | 33.3% | 33.3% | 66.7% |

## Latency and settings

| System | Version | ms/sample (mean / p95) | Settings |
| --- | --- | --- | --- |
| GuardBee rules (block) | guard-core 1.4.1 | 0.04 / 0.08 | scanForPromptInjection(text, 'block').action === 'block': only the precise rules; what the proxy refuses |
| GuardBee rules (block or warn) | guard-core 1.4.1 | 0.02 / 0.08 | scanForPromptInjection(text, 'block').action !== 'allow': precise rules and the generic phrases that only warn |
| ProtectAI DeBERTa-v3 prompt-injection v2 | 90c9989 (ONNX) | 66.51 / 327.24 | softmax P(INJECTION) >= 0.5 on the first 512 tokens (the model card's pipeline truncation); onnxruntime-node CPU |
