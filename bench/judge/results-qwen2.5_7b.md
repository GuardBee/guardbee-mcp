# Judge benchmark: qwen2.5:7b (fp_ollama)

2026-10-31 · 50 injection samples (25 attacks, 25 benign; English and Turkish) · 16 tool alignment cases · median judge latency 965 ms, p95 1300 ms (local, this machine).

## Prompt injection

| Detector | Precision | Recall | F1 | TP | FP | FN |
| --- | --- | --- | --- | --- | --- | --- |
| Rules (block) | 67% | 16% | 0.26 | 4 | 2 | 21 |
| Rules (block or warn) | 46% | 24% | 0.32 | 6 | 7 | 19 |
| Judge only | 100% | 100% | 1.00 | 25 | 0 | 0 |
| Proxy, judge.scope: borderline (rules warn → judge) | 75% | 24% | 0.36 | 6 | 2 | 19 |
| Rules or judge (scanner --judge; proxy judge.scope: results) | 93% | 100% | 0.96 | 25 | 2 | 0 |

By language, rules (block) → rules or judge: English recall 18% → 100%, precision 75% → 94%; Turkish recall 13% → 100%, precision 50% → 89%.

## Description vs. behavior (tool-poisoning-scanner)

| Detector | Precision | Recall | F1 | TP | FP | FN |
| --- | --- | --- | --- | --- | --- | --- |
| Rules (confused-deputy sinks) | 100% | 38% | 0.55 | 3 | 0 | 5 |
| Judge only | 100% | 88% | 0.93 | 7 | 0 | 1 |
| Rules or judge (--judge) | 100% | 100% | 1.00 | 8 | 0 | 0 |
