---
"@guardbee/injection-model": minor
"@guardbee/guard-core": minor
"@guardbee/mcp-security-proxy": minor
"@guardbee/mcp-prompt-injection-scanner": minor
---

Optional local prompt-injection classifier for Turkish and English. `@guardbee/injection-model` is a fine-tuned multilingual-e5-small, shipped as int8 ONNX and pinned by SHA-256; it runs offline on CPU, in-process or as a sidecar. guard-core adds the `InjectionClassifier` interface and `combineWithClassifier`, so the rules stay authoritative. The proxy gets a `classifier:` section (tool arguments, results, resources, LLM gateway prompts; warnAt/blockAt, timeoutMs, onError), and audit events carry `classifier: { model, score, latencyMs }`. The prompt-injection scanner gets `--classifier`, with the score in SARIF. On injection-bench's held-out split, rules + classifier score F1 93.7 in Turkish and 91.6 in English (rules alone: 28.6 / 20.4), at about 8 ms per text.
