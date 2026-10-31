# LLM judge benchmark

How much the optional LLM judge (`judge` in guard-core) adds to GuardBee's deterministic rules, and at what cost in false positives.

- **`injection.jsonl`**: 50 texts an agent might read, 25 attacks and 25 benign, in English and Turkish.
  - Attacks: direct, paraphrased, split, role-play, encoded, and planted in tool results.
  - Benign: plain business text, instructions meant for a human, security articles that quote attack phrases, code, normal tool results.
- **`alignment.jsonl`**: 16 MCP tool definitions (TypeScript), 8 of whose handlers do something their description does not say (send data to a third party, write or delete files, start a process, read an SSH key) and 8 honest ones (calls to the API they name, file reads and writes they describe, a disclosed `npm test`).
- **`run.mjs`** scores four approaches: the rules alone, the judge alone, the rules with the judge raising their `warn` findings (what the proxy does with `judge.scope: borderline`), and the rules or the judge (the scanners with `--judge`, and the proxy with `judge.scope: results`).

```bash
pnpm turbo run build --filter=@guardbee/tool-poisoning-scanner...
ollama pull qwen2.5:7b
GUARDBEE_JUDGE_URL=http://127.0.0.1:11434/v1 GUARDBEE_JUDGE_MODEL=qwen2.5:7b node bench/judge/run.mjs
```

## Results (2026-10-31, Ollama on an Apple-silicon laptop)

Full tables: [qwen2.5:3b](results-qwen2.5_3b.md) · [qwen2.5:7b](results-qwen2.5_7b.md)

| | Rules (block) | Judge, qwen2.5:3b | Judge, qwen2.5:7b | Rules or judge (7b) |
| --- | --- | --- | --- | --- |
| Injection precision / recall | 67% / 16% | 96% / 96% | 100% / 100% | 93% / 100% |
| Alignment precision / recall | 100% / 38% (sink rules) | 78% / 88% | 100% / 88% | — |
| Median latency per call | < 1 ms | 0.7 s | 1.0 s | |

What this shows:

- **The rules find the attack phrases they know, and little else.** They block "ignore all previous instructions" in any wording they have a pattern for. Paraphrased, indirect, role-played and Turkish instructions mostly pass. Two security articles that quote an attack phrase are blocked.
- **A small local model catches the paraphrases.** It also tells an article *about* injection from an injection. A 7B model makes no mistakes on this set. A 3B model makes one mistake on the injection set; on the alignment set it misses one tool and wrongly flags two honest ones.
- **The proxy's default (`judge.scope: borderline`) costs nothing on clean traffic,** because the judge only looks at what the rules already warned about. It therefore cannot find what the rules miss entirely; that takes `judge.scope: results`, which judges every tool result at the latency above.
- **For alignment, the judge must quote the code that does each undisclosed thing.** A quote that is not in the handler is discarded. So is a behavior the description already states: an API it names, a file it says it writes, a command it says it runs. Without these two checks, the 3B model flagged nearly every honest tool.

## Caveats

These are small sets written by the GuardBee team, not an independent benchmark:

- the injection prompt was revised once after looking at the 3B model's false positives on this set;
- the numbers are therefore optimistic.

A public benchmark with outside data is tracked in [#204](https://github.com/GuardBee/guardbee-mcp/issues/204). The judge's few-shot examples do not repeat any sample from these files.
