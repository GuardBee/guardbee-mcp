# @guardbee/mcp-document-scanner

## 0.1.7

### Patch Changes

- [#158](https://github.com/GuardBee/guardbee-mcp/pull/158) [`d8bdffe`](https://github.com/GuardBee/guardbee-mcp/commit/d8bdffedeb2e3401ebc8ce6fc5616a17508f24e7) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Add a `default` export condition so the CommonJS build of `@guardbee/mcp-security-proxy` can load these packages. Without it, `require()` failed with `ERR_PACKAGE_PATH_NOT_EXPORTED`, and `interceptors.documents` threw on every tool call in the published proxy. Needs Node 20.19+ or 22.12+ (require of an ES module).

## 0.1.6

### Patch Changes

- Updated dependencies [[`5e6d872`](https://github.com/GuardBee/guardbee-mcp/commit/5e6d872cd6b9014da63743bc2198a0eb159c3b49)]:
  - @guardbee/guard-core@0.19.0

## 0.1.5

### Patch Changes

- Updated dependencies [[`d4b24f4`](https://github.com/GuardBee/guardbee-mcp/commit/d4b24f4234e565f4660b3a356140516119ad4548)]:
  - @guardbee/guard-core@0.18.0

## 0.1.4

### Patch Changes

- Updated dependencies [[`0e96d18`](https://github.com/GuardBee/guardbee-mcp/commit/0e96d18c6d96a505a5cf5774af2a29d323d066e1)]:
  - @guardbee/guard-core@0.17.0

## 0.1.3

### Patch Changes

- Updated dependencies [[`a489a7e`](https://github.com/GuardBee/guardbee-mcp/commit/a489a7e06e4dc8dfd208572efbb46e81e0bc3c69)]:
  - @guardbee/guard-core@0.16.0

## 0.1.2

### Patch Changes

- [#140](https://github.com/GuardBee/guardbee-mcp/pull/140) [`d8cd9cc`](https://github.com/GuardBee/guardbee-mcp/commit/d8cd9cc0524abe68dbb095dc0c28a399ae8eb282) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - CLI: `--cache-path=<dir>` sets where Tesseract language data is cached (the option existed in the API but not on the command line).

## 0.1.1

### Patch Changes

- Updated dependencies [[`945ed3c`](https://github.com/GuardBee/guardbee-mcp/commit/945ed3c817660b0cf479c2ce1777c1a4cc4ea5c1), [`b3ea8b8`](https://github.com/GuardBee/guardbee-mcp/commit/b3ea8b8cac409b80d9d8fdab5527871509c45232)]:
  - @guardbee/guard-core@0.15.0
