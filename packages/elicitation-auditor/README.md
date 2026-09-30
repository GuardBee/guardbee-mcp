# @guardbee/mcp-elicitation-auditor

**🇬🇧 English** | [🇹🇷 Türkçe](TR.md)

An MCP server that scans MCP server source for **elicitation anti-patterns in the 2026-07-28 specification**.

That revision deprecated sampling and roots. Elicitation is the remaining way a server asks the client for something. Form mode collects structured data through the client. URL mode sends the user to a page the client must not read. The spec draws a hard line between them.

> This package sends usage telemetry by default (tool name + short parameters, scanned code is never included — see [`@guardbee/mcp-telemetry`](../telemetry/README.md)). Disable with `GUARDBEE_TELEMETRY=0`.

```
Claude ──► elicitation-auditor ──► MCP server source
              │
              ├─ form-secrets   (form mode asks for a password, API key, token, or card, or embeds a link)
              ├─ url-binding    (URL mode opens a third-party /authorize endpoint directly)
              ├─ url-exposure   (credential or email embedded in the elicitation URL)
              ├─ transport      (cleartext http URL outside localhost)
              ├─ identity       (a form answer is treated as who the user is)
              └─ completion     (the result is used without checking decline or cancel)
```

## What it flags

- **Form-mode secrets.** `elicitInput` / `ctx.elicit` / `elicitation/create` with mode omitted or `form`, whose schema asks for `password`, `apiKey`, `access_token`, `cvv`, and the same family. A name and email form is allowed by the spec and is not flagged. `secretQuestion` is not treated as `secret`.
- **Direct third-party authorize.** URL mode whose `url` path contains `authorize`, `oauth`, or `oauth2`, unless the path goes through your own `/connect` route. That is the forwarded-link phishing case in the spec: the user who opens the link must be checked against the MCP user before any redirect.
- **Credential or personal data in the URL.** Query keys such as `access_token`, `code`, or `email`. The URL is shown to the MCP client.
- **Cleartext HTTP**, except `localhost` and `127.0.0.1`.
- **Clickable URL in a form.** A form message or field description that contains an `http` link. The spec says that link belongs in URL mode.
- **Form answer used as identity.** The submitted email or username is passed to `findUser`, `loginAs`, or assigned to `req.user`, with no comparison to the token `sub` claim.
- **Ignored decline/cancel.** Code reads `.content` and never looks at `.action`, `decline`, or `cancel`. Checking `action !== "accept"` is enough. Sending the email as a notification address is not treated as an identity check.

## Tools

| Tool | Purpose |
|---|---|
| `scan_text` | Scan a source string |
| `scan_file` | Scan one file |
| `scan_directory` | Recursive scan |
| `list_patterns` | List the checks |

## CLI

```
npx @guardbee/mcp-elicitation-auditor scan <path> [--fail-on=any] [--format=text|json|sarif]
```

`guardbee.yml`:

```yaml
elicitation-auditor:
  fail-on: high
  max-files: 5000
  exclude:
    - ".test.ts"
```

No API key. Static analysis only.
