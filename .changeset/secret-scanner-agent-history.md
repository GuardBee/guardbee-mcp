---
"@guardbee/mcp-secret-scanner": minor
---

Agent transcripts: `scan --agent-history` and the `scan_agent_history` MCP tool scan what Claude Code, Codex, Gemini CLI and Continue keep on the machine, reporting each secret once per agent with how often it appears (entropy off there unless `--entropy`). `.jsonl`, `.ndjson`, `.ipynb` and `.log` files over 1 MB are now read line by line instead of skipped. Findings carry a path-independent `valueHash`.
