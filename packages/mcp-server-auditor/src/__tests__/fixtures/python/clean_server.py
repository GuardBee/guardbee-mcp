"""A FastMCP server that keeps tool input away from shells, raw SQL and unchecked paths (test fixture)."""
import sqlite3
import subprocess
from pathlib import Path

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("ops")
db = sqlite3.connect("app.db")
BASE = Path("/srv/data").resolve()


@mcp.tool()
def uptime() -> str:
    """How long the machine has been up."""
    return subprocess.run(["uptime"], capture_output=True, text=True).stdout


@mcp.tool()
def save_report(name: str, body: str) -> str:
    """Save a report under the data directory."""
    target = (BASE / name).resolve()
    if not target.is_relative_to(BASE):
        raise ValueError("outside the data directory")
    target.write_text(body)
    return "saved"


@mcp.tool()
def find_user(email: str) -> list:
    """Find a user by email."""
    cur = db.cursor()
    cur.execute("SELECT * FROM users WHERE email = ?", (email,))
    return cur.fetchall()
