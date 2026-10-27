// An MCP resource server and OAuth client in Go with audience checks, PKCE and token exchange (test fixture).
package main

import (
	"context"
	"crypto/rand"
	"net/http"
	"os"
	"strings"

	"github.com/golang-jwt/jwt/v5"
	"github.com/modelcontextprotocol/go-sdk/auth"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"golang.org/x/oauth2"
)

const resource = "https://mcp.example.com"

var conf = &oauth2.Config{
	ClientID:     "mcp-client",
	ClientSecret: os.Getenv("CLIENT_SECRET"),
	RedirectURL:  "http://127.0.0.1:8080/callback",
	Endpoint:     oauth2.Endpoint{AuthURL: "https://auth.example.com/authorize", TokenURL: "https://auth.example.com/token"},
}

var verifier = oauth2.GenerateVerifier()

func login(w http.ResponseWriter, r *http.Request) {
	state := rand.Text()
	http.Redirect(w, r, conf.AuthCodeURL(state, oauth2.S256ChallengeOption(verifier)), http.StatusFound)
}

func verify(ctx context.Context, token string, _ *http.Request) (*auth.TokenInfo, error) {
	_, err := jwt.Parse(token, func(t *jwt.Token) (any, error) { return key, nil }, jwt.WithAudience(resource))
	if err != nil {
		return nil, err
	}
	return &auth.TokenInfo{}, nil
}

func files(w http.ResponseWriter, r *http.Request) {
	downstream := exchange(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
	out, _ := http.NewRequest("GET", "https://api.example.com/v1/files", nil)
	out.Header.Set("Authorization", "Bearer "+downstream)
	resp, err := http.DefaultClient.Do(out)
	if err == nil {
		resp.Body.Close()
	}
}

func exchange(token string) string { return token[:0] }

var key = []byte("k")

func main() {
	server := mcp.NewServer(&mcp.Implementation{Name: "files"}, nil)
	handler := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return server }, nil)
	protected := auth.RequireBearerToken(verify, nil)(handler)
	http.Handle("/mcp", http.NewCrossOriginProtection().Handler(protected))
	http.HandleFunc("/login", login)
	http.HandleFunc("/files", files)
	_ = http.ListenAndServe("127.0.0.1:8080", nil)
}
