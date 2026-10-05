---
"@guardbee/guard-core": minor
"@guardbee/mcp-security-proxy": minor
---

Data-based taint: `taint.basis: data` treats an egress call as a toxic flow only when its arguments carry sensitive data the session saw (hashed fingerprints of PII, credentials, id-like tokens and 12+ word passages; PII tokens count as their values), not merely because the session touched untrusted and sensitive content. The block message names the tool the data came from. The default `capability` basis keeps today's behaviour and adds the same evidence to its reason when found. guard-core's policy schema gains `taint.basis`.
