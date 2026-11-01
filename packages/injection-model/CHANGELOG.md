# @guardbee/injection-model

## 0.1.0

### Minor Changes

- [#277](https://github.com/GuardBee/guardbee-mcp/pull/277) [`2b600e1`](https://github.com/GuardBee/guardbee-mcp/commit/2b600e19a04dd645100937dd713685b01bd8ecba) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Optional local prompt-injection classifier for Turkish and English. `@guardbee/injection-model` is a fine-tuned multilingual-e5-small, shipped as int8 ONNX and pinned by SHA-256; it runs offline on CPU, in-process or as a sidecar. guard-core adds the `InjectionClassifier` interface and `combineWithClassifier`, so the rules stay authoritative. The proxy gets a `classifier:` section (tool arguments, results, resources, LLM gateway prompts; warnAt/blockAt, timeoutMs, onError), and audit events carry `classifier: { model, score, latencyMs }`. The prompt-injection scanner gets `--classifier`, with the score in SARIF. On injection-bench's held-out split, rules + classifier score F1 93.7 in Turkish and 91.6 in English (rules alone: 28.6 / 20.4), at about 8 ms per text.

### Patch Changes

- Updated dependencies [[`2b600e1`](https://github.com/GuardBee/guardbee-mcp/commit/2b600e19a04dd645100937dd713685b01bd8ecba), [`ca17dea`](https://github.com/GuardBee/guardbee-mcp/commit/ca17dea9e1167efcbe36ac0c8b73b3fe3ca941ae), [`fb81d57`](https://github.com/GuardBee/guardbee-mcp/commit/fb81d57371b9e06a3ff6c05a8877717276e51a89)]:
  - @guardbee/guard-core@1.5.0
