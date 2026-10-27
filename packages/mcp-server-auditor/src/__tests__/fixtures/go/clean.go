// mcp-go tools that keep input out of shells, raw SQL and unchecked paths (test fixture).
package main

import (
	"context"
	"database/sql"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

var db *sql.DB

const root = "/srv/data"

func main() {
	s := server.NewMCPServer("ops", "1.0.0")
	s.AddTool(mcp.NewTool("uptime", mcp.WithDescription("Machine uptime")), uptime)
	s.AddTool(mcp.NewTool("delete_report",
		mcp.WithDescription("Delete a report"),
		mcp.WithString("name", mcp.Required()),
	), deleteReport)
	s.AddTool(mcp.NewTool("find_order",
		mcp.WithDescription("Find an order"),
		mcp.WithString("id", mcp.Required()),
	), findOrder)
	_ = server.ServeStdio(s)
}

func uptime(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	out, err := exec.CommandContext(ctx, "uptime").Output()
	if err != nil {
		return nil, err
	}
	return mcp.NewToolResultText(string(out)), nil
}

func deleteReport(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	name, _ := request.RequireString("name")
	if !filepath.IsLocal(name) {
		return mcp.NewToolResultError("outside the data directory"), nil
	}
	if err := os.Remove(filepath.Join(root, name)); err != nil {
		return nil, err
	}
	return mcp.NewToolResultText("deleted"), nil
}

func findOrder(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	id, _ := request.RequireString("id")
	rows, err := db.QueryContext(ctx, "SELECT * FROM orders WHERE id = ?", id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return mcp.NewToolResultText("ok"), nil
}
