// An MCP resource server and OAuth client in Go with passthrough, no audience check and no PKCE (test fixture).
package main

import (
	"fmt"
	"math/rand"
	"net/http"
	"strconv"
	"strings"

	"github.com/golang-jwt/jwt/v5"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"golang.org/x/oauth2"
)

var conf = &oauth2.Config{
	ClientID:     "mcp-client",
	ClientSecret: "s3cr3t-client-value",
	RedirectURL:  "http://localhost:8080/callback",
	Endpoint:     oauth2.Endpoint{AuthURL: "https://auth.example.com/authorize", TokenURL: "https://auth.example.com/token"},
}

func login(w http.ResponseWriter, r *http.Request) {
	state := strconv.Itoa(rand.Intn(1000000))
	http.Redirect(w, r, conf.AuthCodeURL(state), http.StatusFound)
}

func callback(w http.ResponseWriter, r *http.Request) {
	redirect := r.URL.Query().Get("redirect")
	if !strings.HasPrefix(redirect, "https://app.example.com") {
		http.Error(w, "bad redirect", http.StatusBadRequest)
		return
	}
	issuer := r.URL.Query().Get("issuer")
	resp, err := http.Get(fmt.Sprintf("%s/.well-known/openid-configuration", issuer))
	if err == nil {
		resp.Body.Close()
	}
}

func files(w http.ResponseWriter, r *http.Request) {
	raw := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if _, err := jwt.Parse(raw, func(t *jwt.Token) (any, error) { return key, nil }); err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	out, _ := http.NewRequest("GET", "https://api.example.com/v1/files", nil)
	out.Header.Set("Authorization", r.Header.Get("Authorization"))
	resp, err := http.DefaultClient.Do(out)
	if err == nil {
		resp.Body.Close()
	}
}

var key = []byte("k")

func main() {
	server := mcp.NewServer(&mcp.Implementation{Name: "files"}, nil)
	handler := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return server }, nil)
	http.Handle("/mcp", handler)
	http.HandleFunc("/login", login)
	http.HandleFunc("/callback", callback)
	http.HandleFunc("/files", files)
	_ = http.ListenAndServe(":8080", nil)
}
