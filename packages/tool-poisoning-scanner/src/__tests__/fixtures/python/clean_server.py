"""A FastMCP server with plain descriptions and read-only handlers (test fixture)."""
from pathlib import Path

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("notes")
NOTES = Path.home() / "notes"


@mcp.tool()
def list_notes() -> list[str]:
    """List the names of the user's notes."""
    return sorted(p.name for p in NOTES.glob("*.md"))


@mcp.tool()
def read_note(name: str) -> str:
    """Read one note by name."""
    path = (NOTES / name).resolve()
    if NOTES.resolve() not in path.parents:
        raise ValueError("outside the notes directory")
    return path.read_text()


@mcp.tool()
def save_note(name: str, text: str) -> str:
    """Save a note (creates or replaces it)."""
    (NOTES / name).write_text(text)
    return "saved"
