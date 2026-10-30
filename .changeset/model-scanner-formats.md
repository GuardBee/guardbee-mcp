---
"@guardbee/mcp-model-scanner": minor
"@guardbee/security-suite": minor
---

model-scanner covers more model formats and Hugging Face repos (#238):

- **joblib** (`.joblib`, `.jbl`, and joblib dumps saved as `.pkl`): the scanner steps over the array bytes joblib writes between pickle opcodes and checks nested object-array pickles; zlib/gzip dumps are decompressed, other codecs are reported.
- **dill**: `_create_code`, `_create_function`, `_eval_repr` (critical) and `_import_module`, `_get_attr`, `_create_filehandle` (high) join the dangerous-global rules.
- **NumPy** `.npy`/`.npz`: object arrays and the globals in their pickle, and pickles renamed to a NumPy extension.
- **GGUF**: header counts, string/array lengths, tensor dimensions, types, alignment and data bounds are checked against the file; chat templates are checked for Jinja sandbox escapes, hidden characters and injected instructions.
- **TensorFlow**: SavedModel, frozen GraphDef (`.pb`/`.pbtxt`) and TFLite Flex ops that read or write files, call Python or send tensors to a debug URL; Keras Lambda layers in `keras_metadata.pb` and Keras 3 `.keras` zips.
- **Hugging Face repos**: new `scan_hf_repo` tool and `scan hf://owner/repo@revision` CLI target; the revision is pinned to a commit sha.
- Pickle streams are now parsed by a stack-tracking pickle machine, so `STACK_GLOBAL` resolves strings fetched from the memo. This removes false "unknown global" findings such as `ndarray.dtype` on NumPy 2 pickles.

security-suite serves the new `model_scan_hf_repo` tool (129 tools).
