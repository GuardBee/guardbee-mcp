# Judge benchmark: qwen2.5:3b (fp_ollama)

2026-10-31 · 50 injection samples (25 attacks, 25 benign; English and Turkish) · 16 tool alignment cases · median judge latency 721 ms, p95 991 ms (local, this machine).

## Prompt injection

| Detector | Precision | Recall | F1 | TP | FP | FN |
| --- | --- | --- | --- | --- | --- | --- |
| Rules (block) | 67% | 16% | 0.26 | 4 | 2 | 21 |
| Rules (block or warn) | 46% | 24% | 0.32 | 6 | 7 | 19 |
| Judge only | 96% | 96% | 0.96 | 24 | 1 | 1 |
| Proxy, judge.scope: borderline (rules warn → judge) | 75% | 24% | 0.36 | 6 | 2 | 19 |
| Rules or judge (scanner --judge; proxy judge.scope: results) | 89% | 100% | 0.94 | 25 | 3 | 0 |

By language, rules (block) → rules or judge: English recall 18% → 100%, precision 75% → 89%; Turkish recall 13% → 100%, precision 50% → 89%.

## Description vs. behavior (tool-poisoning-scanner)

| Detector | Precision | Recall | F1 | TP | FP | FN |
| --- | --- | --- | --- | --- | --- | --- |
| Rules (confused-deputy sinks) | 100% | 38% | 0.55 | 3 | 0 | 5 |
| Judge only | 78% | 88% | 0.82 | 7 | 2 | 1 |
| Rules or judge (--judge) | 80% | 100% | 0.89 | 8 | 2 | 0 |
