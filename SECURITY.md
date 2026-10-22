# Security policy

GuardBee builds security tools, so a flaw in them can leave the people who rely on them exposed. Thank you for reporting one privately.

## Reporting a vulnerability

**Do not open a public issue or discussion.** Report it through GitHub's private vulnerability reporting:

**[Report a vulnerability](https://github.com/GuardBee/guardbee-mcp/security/advisories/new)**

Please include the package and version, what an attacker can do, and the smallest steps or input that reproduce it. A proof of concept against your own test setup is welcome; please do not test against systems you do not own.

We aim to acknowledge a report within 3 business days and to agree on a fix and disclosure date with you. Fixes ship as a new npm release with a GitHub security advisory that credits you, unless you prefer otherwise.

## What counts

These are vulnerabilities, report them privately:

- A way to make `@guardbee/mcp-security-proxy` forward data it should mask or block: a PII or secret bypass, a policy or approval bypass, a taint-tracking escape, an audit-log forgery.
- Code execution, path traversal, SSRF or credential exposure in any package, including through a crafted file, config or MCP server response a scanner reads.
- A scanner or the proxy sending data anywhere it is not configured to.

These are regular issues, open them publicly:

- A scanner missing a pattern in your own code (a false negative) or flagging something harmless (a false positive). Use the "False positive / false negative" issue form.
- A dependency with a published CVE and no exploitable path in GuardBee; Dependabot tracks these.

## Supported versions

| Package line | Security fixes |
|---|---|
| Packages at 1.x (`mcp-security-proxy`, `guard-core`, `mcp-secret-scanner`, `mcp-prompt-injection-scanner`, `mcp-prompt-leak-scanner`, `mcp-toxic-flow-auditor`) | The latest 1.x minor |
| Packages at 0.x | The latest release |

Each package is versioned on its own; see its `CHANGELOG.md`.
