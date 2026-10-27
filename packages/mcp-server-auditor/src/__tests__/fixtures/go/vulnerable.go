// MCP tools (official go-sdk and mark3labs/mcp-go) whose input reaches shell, file, HTTP and SQL sinks (test fixture).
package main

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"os"
	"os/exec"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
	sdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

var db *sql.DB

type PingInput struct {
	Host string `json:"host" jsonschema:"host to ping"`
}

func main() {
	official := sdk.NewServer(&sdk.Implementation{Name: "net"}, nil)
	sdk.AddTool(official, &sdk.Tool{Name: "ping", Description: "Ping a host"}, Ping)

	s := server.NewMCPServer("files", "1.0.0")
	s.AddTool(mcp.NewTool("delete_file",
		mcp.WithDescription("Delete a file"),
		mcp.WithString("path", mcp.Required()),
	), deleteFile)
	s.AddTool(mcp.NewTool("fetch",
		mcp.WithDescription("Fetch a URL"),
		mcp.WithString("url", mcp.Required()),
	), func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		target := request.GetString("url", "")
		resp, err := http.Get(target)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()
		return mcp.NewToolResultText(resp.Status), nil
	})
	s.AddTool(mcp.NewTool("find_order",
		mcp.WithDescription("Find an order"),
		mcp.WithString("id", mcp.Required()),
	), findOrder)
	_ = server.ServeStdio(s)
}

func Ping(ctx context.Context, req *sdk.CallToolRequest, input PingInput) (*sdk.CallToolResult, any, error) {
	out, err := exec.Command("sh", "-c", "ping -c 1 "+input.Host).CombinedOutput()
	return nil, string(out), err
}

func deleteFile(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	path, err := request.RequireString("path")
	if err != nil {
		return nil, err
	}
	if err := os.Remove(path); err != nil {
		return nil, err
	}
	return mcp.NewToolResultText("deleted"), nil
}

func findOrder(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	id, _ := request.RequireString("id")
	rows, err := db.QueryContext(ctx, fmt.Sprintf("SELECT * FROM orders WHERE id = '%s'", id))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return mcp.NewToolResultText("ok"), nil
}
