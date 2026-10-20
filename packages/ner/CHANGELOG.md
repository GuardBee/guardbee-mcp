# @guardbee/ner

## 0.1.3

### Patch Changes

- Updated dependencies [[`c1a16b9`](https://github.com/GuardBee/guardbee-mcp/commit/c1a16b9c9f588c4d3735fb45a1339b33119a8de0)]:
  - @guardbee/guard-core@0.21.0

## 0.1.2

### Patch Changes

- Updated dependencies [[`e3355b2`](https://github.com/GuardBee/guardbee-mcp/commit/e3355b23654afcb2eb144da18e54fbfdb2817b16)]:
  - @guardbee/guard-core@0.20.0

## 0.1.1

### Patch Changes

- [#158](https://github.com/GuardBee/guardbee-mcp/pull/158) [`d8bdffe`](https://github.com/GuardBee/guardbee-mcp/commit/d8bdffedeb2e3401ebc8ce6fc5616a17508f24e7) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Add a `default` export condition so the CommonJS build of `@guardbee/mcp-security-proxy` can load these packages. Without it, `require()` failed with `ERR_PACKAGE_PATH_NOT_EXPORTED`, and `interceptors.documents` threw on every tool call in the published proxy. Needs Node 20.19+ or 22.12+ (require of an ES module).

## 0.1.0

### Minor Changes

- [#156](https://github.com/GuardBee/guardbee-mcp/pull/156) [`5e6d872`](https://github.com/GuardBee/guardbee-mcp/commit/5e6d872cd6b9014da63743bc2198a0eb159c3b49) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Optional NER backend for Turkish person names ([#126](https://github.com/GuardBee/guardbee-mcp/issues/126)).
  
  - New package `@guardbee/ner`: a local BERTurk NER model (akdeniz27/bert-base-turkish-cased-ner, int8, MIT) on ONNX Runtime, offline. `guardbee-ner download` fetches it at a pinned revision and checks SHA-256 hashes; `NerModel.load()` refuses missing or altered files. Runs in-process or as a sidecar (`guardbee-ner serve`, loopback by default, optional bearer token, texts never logged). Picked out of five Turkish NER models on the pii-bench numbers: person-name F1 99.5 on tr-pii-v1, 97.1 on the hand-written hard-names set, p50 8 ms per document.
  - guard-core: `maskPiiInText` / `maskPiiInValue` take a fifth argument, a `SpanLookup`, and mask what a model found in each string in the same pass (placeholder `[KİŞİ]`, or the replacer's value). A lookup must throw for a text it has no result for, so an unscanned text is never passed as clean. A model span inside an e-mail address or URL is left to the regex detector, which masks the whole value. New detector name `person_name` (in `PII_DETECTORS` and the `ALL`, `KVKK` and `IDENTITY` presets; it finds nothing without a lookup), `MODEL_PII`, `ModelSpan`, `ModelDetector`.

### Patch Changes

- Updated dependencies [[`5e6d872`](https://github.com/GuardBee/guardbee-mcp/commit/5e6d872cd6b9014da63743bc2198a0eb159c3b49)]:
  - @guardbee/guard-core@0.19.0
