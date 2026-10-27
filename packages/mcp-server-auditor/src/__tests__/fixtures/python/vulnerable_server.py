"""A FastMCP server whose tool parameters reach shell, file, HTTP and SQL sinks (test fixture)."""
import sqlite3
import subprocess
from pathlib import Path

import httpx
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("ops")
db = sqlite3.connect("app.db")
BASE = Path("/srv/data")


@mcp.tool()
def disk_usage(directory: str) -> str:
    """Disk usage of a directory."""
    command = f"du -sh {directory}"
    return subprocess.run(command, shell=True, capture_output=True, text=True).stdout


@mcp.tool()
def save_report(name: str, body: str) -> str:
    """Save a report."""
    with open(BASE / name, "w") as f:
        f.write(body)
    return "saved"


@mcp.tool()
async def fetch_page(url: str) -> str:
    """Fetch a web page."""
    async with httpx.AsyncClient() as client:
        response = await client.get(url)
    return response.text


@mcp.tool()
def find_user(email: str) -> list:
    """Find a user by email."""
    cur = db.cursor()
    cur.execute(f"SELECT * FROM users WHERE email = '{email}'")
    return cur.fetchall()


@mcp.tool()
def run_command(cmd: str) -> str:
    """Run a command."""
    return subprocess.check_output(cmd.split()).decode()
