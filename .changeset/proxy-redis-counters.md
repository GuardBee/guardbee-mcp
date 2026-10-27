---
"@guardbee/mcp-security-proxy": minor
---

Shared counters for several replicas: `state.backend: redis` keeps quotas and LLM budgets (requests, tokens, cost) in Redis, so every replica behind a load balancer enforces one combined limit. Check and count run as one Lua script per call (no race between replicas), keys expire with their window, and Redis Cluster works (one hash tag). The proxy has its own small RESP client (redis:// and rediss://, AUTH, database), so nothing new is installed. `state.onError` decides what happens while Redis is down: `local` (default, count per process), `fail-open` or `fail-closed`; outages and recoveries are audit events (`state:unavailable`, `state:recovered`). The memory backend stays the default.
