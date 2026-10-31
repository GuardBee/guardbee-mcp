# Fleet-wide MCP inventory

`discover` lists the MCP servers configured on one machine. Run it on every developer machine with `--upload`, and the GuardBee dashboard (**MCP Gateway → Inventory**) shows the fleet: which machines run which servers, which are not on the organization allowlist, what changed since each machine's previous scan, and each server's [MCP Index](../mcp-index) grade. The dashboard also exports this as CSV.

```bash
GUARDBEE_API_KEY=gb_… npx -y @guardbee/mcp-config-auditor discover \
  --upload --allowlist-from-dashboard --grades --fail-on=none
```

| Flag | What it does |
| --- | --- |
| `--upload` | Sends the inventory to the dashboard. |
| `--allowlist-from-dashboard` | Checks every server against the organization allowlist, which admins manage on the inventory page (approve a server by package, URL host or name). Every machine flags the same servers, with no file to distribute. It can be combined with a local `--allowlist`. |
| `--grades` | Adds each server's MCP Index grade. The index is downloaded whole and searched locally. |
| `--no-user` | Leaves the OS user name out of the report. |

**What is sent:** the client, config path, server name, transport, package and version (or the URL without credentials and query values), the **names** of environment variables and headers, auto-approve, findings and grade, plus the machine's host name, OS and (unless `--no-user`) OS user.

**What is never sent:** environment and header values, secret-looking arguments (replaced by `[redacted]`), and URL credentials.

**Offline:** without `GUARDBEE_API_KEY` and `--upload`, the same report is printed locally (`--format=json`) and nothing leaves the machine.

**API key:** a workspace API key with the `gateway.write` scope, which uploads and also reads the allowlist. Create one under Settings → API keys and distribute it through your device-management tool's secret store, not in a script checked into a repository.

MCP client configs live in each user's home directory, so **run discover as the logged-in user**, not as root or SYSTEM.

## macOS: Jamf Pro

A policy with this script (parameter 4 = the API key), triggered on recurring check-in, once a day:

```bash
#!/bin/bash
# Jamf runs scripts as root: run discover as the logged-in user, whose home holds the MCP configs.
API_KEY="$4"
USER_NAME=$(stat -f%Su /dev/console)
[ "$USER_NAME" = "root" ] || [ -z "$USER_NAME" ] && exit 0
USER_ID=$(id -u "$USER_NAME")
launchctl asuser "$USER_ID" sudo -u "$USER_NAME" env GUARDBEE_API_KEY="$API_KEY" PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" \
  npx -y @guardbee/mcp-config-auditor@^0 discover --upload --allowlist-from-dashboard --grades --fail-on=none --format=json >/dev/null
```

Node.js must be installed: `npx` is how the auditor runs. Deploy Node with Jamf if your developers do not already have it.

## Windows: Microsoft Intune

A platform script (Devices → Scripts and remediations → Platform scripts) set to **Run this script using the logged on credentials: Yes**. It registers a daily scheduled task for the user:

```powershell
$key = "gb_…"   # or read it from a value your MDM sets, e.g. a registry key under HKCU
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c set GUARDBEE_API_KEY=$key&& npx -y @guardbee/mcp-config-auditor@^0 discover --upload --allowlist-from-dashboard --grades --fail-on=none --format=json > NUL"
$trigger = New-ScheduledTaskTrigger -Daily -At 10:00
Register-ScheduledTask -TaskName "GuardBee MCP inventory" -Action $action -Trigger $trigger -Description "Uploads the MCP server inventory to GuardBee" -Force
Start-ScheduledTask -TaskName "GuardBee MCP inventory"
```

To run it once instead, use a remediation script with the same `npx` line.

## Linux: systemd user timer

```ini
# ~/.config/systemd/user/guardbee-mcp-inventory.service
[Service]
Type=oneshot
EnvironmentFile=%h/.config/guardbee/env      # GUARDBEE_API_KEY=gb_…, mode 0600
ExecStart=/usr/bin/env npx -y @guardbee/mcp-config-auditor@^0 discover --upload --allowlist-from-dashboard --grades --fail-on=none --format=json

# ~/.config/systemd/user/guardbee-mcp-inventory.timer
[Timer]
OnCalendar=daily
Persistent=true
[Install]
WantedBy=timers.target
```

`systemctl --user enable --now guardbee-mcp-inventory.timer`

## CI: MCP configs committed to repositories

Project-level configs (`.cursor/mcp.json`, `.vscode/mcp.json`, `.mcp.json`) are code. Check them in the pull request that changes them:

```yaml
# .github/workflows/mcp-config.yml
on:
  pull_request:
    paths: [".cursor/mcp.json", ".vscode/mcp.json", ".mcp.json"]
jobs:
  mcp-config:
    runs-on: ubuntu-latest
    permissions: { contents: read, security-events: write }
    steps:
      - uses: actions/checkout@v4
      - run: |
          for f in .cursor/mcp.json .vscode/mcp.json .mcp.json; do
            [ -f "$f" ] && npx -y @guardbee/mcp-config-auditor@^0 scan "$f" --grades --min-grade=C --fail-on=high
          done
```

`--min-grade=C` fails the job for a server graded D or F (`mcp_index_grade_below_minimum`). Add `--format=sarif` and `github/codeql-action/upload-sarif` to see the findings in code scanning.

## In the dashboard

- **Inventory:** machines × servers. For each server: its approval against the organization allowlist (with an *Approve* button for admins), when it was first seen, whether it is new or changed since the machine's previous scan (and what ran before), its MCP Index grade, and the existing flags (unpinned, auto-approve, differs across clients). Servers removed since the previous scan are listed per machine.
- **Allowlist:** packages, URL hosts and server names. `discover --allowlist-from-dashboard` reads the same list.
- **Export CSV:** one row per machine and server, for an audit or a spreadsheet.
