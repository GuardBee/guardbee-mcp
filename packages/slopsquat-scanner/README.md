# @guardbee/mcp-slopsquat-scanner

**🇬🇧 English** | [🇹🇷 Türkçe](TR.md)

An MCP (Model Context Protocol) server that checks every dependency declared in a project's own manifest (`package.json`, `requirements.txt`, `pyproject.toml`) against the **real** npm/PyPI registry — not a local database, an actual network lookup.

LLM coding assistants hallucinate plausible-sounding package names at a measurable rate — research on open-source models puts it around 21.7%. Attackers know this and pre-register exactly those names on npm/PyPI, so the next person who copies the same suggestion doesn't get an install error — they get the attacker's code instead. This is **slopsquatting**, and unlike a typo-squat, there's no misspelling to catch by eye: the hallucinated name is often *more* plausible-sounding than the real package it was meant to be.

> This package sends usage telemetry by default (tool name + short parameters, scanned manifests are never included — see [`@guardbee/mcp-telemetry`](../telemetry/README.md)). Disable with `GUARDBEE_TELEMETRY=0`.

```
Claude ──► slopsquat-scanner ──► registry.npmjs.org / pypi.org
              │
              ├─ dependency_not_found            (name isn't published anywhere — critical)
              └─ dependency_recently_published    (exists, but published <30 days ago — low/informational)
```

---

## Why a live registry lookup, not a local list

There's no way to maintain a local "known bad" list for this — the whole point of a slopsquat is that it's a *new* name, registered specifically to catch a specific hallucination, possibly hours before someone runs `npm install`. A static pattern can't know that; only asking the registry "does this exact name exist right now" can. This package only checks a project's own **directly declared** dependencies (the `dependencies`/`devDependencies`/`peerDependencies`/`optionalDependencies` sections of `package.json`, or `requirements.txt`/`pyproject.toml` for Python) — not the full resolved lockfile tree. Transitive dependencies were already vetted by whichever maintainer published the package that depends on them; the actual risk moment is when a *new* name gets typed (by a human or an AI assistant) directly into your own manifest.

A name that doesn't exist at all is unambiguous and reported **critical** — verify the correct name before you or a teammate installs it. A name that *does* exist but was only published in the last 30 days is reported **low/informational**, not critical: this is routine for real new packages too, and on its own doesn't prove anything malicious — it's a "worth a second look" signal, not a verdict.

---

## Features

- Checks **npm and PyPI** — package.json, requirements.txt, and pyproject.toml (both PEP 621 `[project] dependencies` and Poetry's `[tool.poetry.dependencies]`)
- Direct dependencies only — fast, and matches where the actual slopsquatting risk moment is
- Scoped npm packages (`@scope/name`) handled correctly — found and fixed a real URL-encoding bug during development (`encodeURIComponent` on the whole name double-encodes the registry's own `@scope%2Fname` convention, producing a URL the registry doesn't recognize as a single package)
- No API key required — queries the public, unauthenticated npm registry and PyPI JSON API directly
- SARIF 2.1.0 output — CI/CD integration (GitHub Code Scanning, etc.)
- 18 unit tests covering the manifest parsers (including a check that transitive lockfile entries are correctly *not* included) and the severity classification logic, all against real, deterministic fixtures — no mocked network calls, since parsing and classification are pure functions that don't need one. End-to-end verified against the real npm and PyPI registries with a fixture mixing real packages (`react`, `vitest`, `requests`) and deliberately hallucinated ones — caught both hallucinated names, zero false positives on the real ones. Also run against this monorepo's own `package.json` files as a dogfooding check: zero false positives on real dependencies, and one genuinely correct low-severity finding (`@guardbee/mcp-telemetry`, itself only ~2 weeks old on npm at the time) — exactly the intended "worth a look, not an alarm" behavior.

---

## Quick Start

### Claude Desktop / MCP Client

```json
{
  "mcpServers": {
    "guardbee-slopsquat-scanner": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-slopsquat-scanner"]
    }
  }
}
```

### CLI (CI/CD)

```bash
npx @guardbee/mcp-slopsquat-scanner scan . --fail-on=critical --format=sarif > results.sarif
```

---

## MCP Tools

| Tool | Description |
|------|----------|
| `scan_npm` | Checks every declared npm dependency in a directory's package.json |
| `scan_pip` | Checks every declared pip dependency (requirements.txt / pyproject.toml) |
| `check_package` | Checks a single package name against npm or PyPI |
| `scan_directory` | Auto-detects and checks both npm and pip manifests |

---

## Detected Patterns

| Pattern | Severity | Meaning |
|---|---|---|
| `dependency_not_found` | critical | Declared package name doesn't exist on the registry at all |
| `dependency_recently_published` | low | Package exists, but was first published less than 30 days ago |

---

## Configuration (`guardbee.yml`)

```yaml
slopsquat-scanner:
  fail-on: critical    # critical | low | none
  include-dev: false
```

---

## Limitations (by design)

- **Direct dependencies only.** A hallucinated or squatted name inside a *transitive* dependency (something a package you depend on itself depends on) isn't checked — that package's own maintainers already resolved it against a real registry when they published.
- **The "recently published" signal is genuinely ambiguous.** Real new packages get published constantly; this is reported at low severity specifically because it is *not* proof of anything, only a "look closer" prompt.
- **Network-dependent.** Every check is a live HTTP request to the npm/PyPI registry — a project with many dependencies means many requests (bounded to 8 concurrent at a time), and a registry outage or rate limit will show up as a tool error, not a false "doesn't exist" finding (registry errors are reported separately from a genuine 404).
- **No version-pin awareness.** This checks whether the *name* exists, not whether the specific version range you've pinned is itself suspicious — that's a different, already-covered problem (see [`@guardbee/mcp-dependency-auditor`](../dependency-auditor/README.md) for known-CVE checking).

---

## Development

```bash
npm run build
npm test             # 18 unit tests
```

---

## License

MIT — [GuardBee](https://guardbee.ai)
