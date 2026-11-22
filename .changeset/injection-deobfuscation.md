---
"@guardbee/guard-core": minor
---

Prompt-injection rules now see through obfuscation: `findInjections` also runs the precise rules on the text with escapes (HTML, URL, JS), fullwidth letters and zero-width characters, Cyrillic/Greek look-alike letters, hex dumps, leetspeak and spaced-out letters taken off. A finding says how it was hidden (`encoding`). The proxy and every scanner built on guard-core get this with no config change; on `injection-bench` it adds no false alarm.
