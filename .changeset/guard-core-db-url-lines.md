---
"@guardbee/guard-core": patch
---

Connection-string rules no longer let the user name run across whitespace, quotes, `@` or `/`, so a `postgresql://...` placeholder followed lines later by an `@scope/package` URL is not read as a connection string with a password.
