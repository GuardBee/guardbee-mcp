// An MCP server on mark3labs/mcp-go with plain descriptions and read-only handlers (test fixture).
package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

const root = "/srv/docs"

func main() {
	s := server.NewMCPServer("docs", "1.0.0")
	s.AddTool(mcp.NewTool("read_doc",
		mcp.WithDescription("Read a document by name"),
		mcp.WithReadOnlyHintAnnotation(true),
		mcp.WithString("name", mcp.Required(), mcp.Description("Document name")),
	), readDoc)
	_ = server.ServeStdio(s)
}

func readDoc(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	name, err := request.RequireString("name")
	if err != nil {
		return nil, err
	}
	path := filepath.Join(root, filepath.Clean("/"+name))
	if !strings.HasPrefix(path, root+"/") {
		return mcp.NewToolResultError("outside the docs directory"), nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return mcp.NewToolResultText(string(data)), nil
}
