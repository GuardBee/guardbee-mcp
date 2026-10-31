---
"@guardbee/guard-core": minor
"@guardbee/mcp-tool-poisoning-scanner": minor
"@guardbee/mcp-prompt-injection-scanner": minor
"@guardbee/mcp-security-proxy": minor
---

Optional LLM judge (any OpenAI-compatible endpoint, local by default: Ollama, llama.cpp, vLLM).

- guard-core: `Judge` with `classifyInjection` and `checkAlignment`. It returns schema-checked JSON at temperature 0, with a latency budget and a cache, and reports the model and version. It is off unless configured, and a non-local endpoint needs `allowRemote` and https. Alignment behaviors must quote handler code that really exists, and behaviors the description states are dropped. `judgeFromEnv` reads `GUARDBEE_JUDGE_URL` / `GUARDBEE_JUDGE_MODEL`.
- tool-poisoning-scanner: `--judge` checks each tool's handler against its description (`judge_description_behavior_mismatch`), with the model in findings and SARIF.
- prompt-injection-scanner: `--judge` finds paraphrased or translated injections (`judge_semantic_injection`).
- security-proxy: a `judge` config block. A borderline (warn) injection finding on tool arguments or results is raised to a block when the judge is confident it is malicious; with `mayClear` a confident "benign" clears it. `budgetMs` and `onError` (open/closed) apply. `scope: results` also judges every tool result the rules let through. Audit events carry `judge` (model, version, verdict, confidence, latency, outcome); CEF puts the model in `flexString1`.
- Benchmark in bench/judge: rules alone vs. judge (qwen2.5:3b, qwen2.5:7b) on 50 English and Turkish injection samples and 16 tool alignment cases.
