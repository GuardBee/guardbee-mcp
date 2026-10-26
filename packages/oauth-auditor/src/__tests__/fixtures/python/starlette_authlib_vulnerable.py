"""A Starlette MCP server using authlib without an audience claim option or PKCE (test fixture)."""
import httpx
from authlib.integrations.httpx_client import AsyncOAuth2Client
from authlib.jose import jwt
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, RedirectResponse

PUBLIC_KEY = open("public.pem").read()
client = AsyncOAuth2Client(client_id="mcp-server", redirect_uri="http://localhost:8000/callback")


async def login(request: Request):
    url, state = client.create_authorization_url("https://auth.example.com/authorize")
    return RedirectResponse(url)


async def tools(request: Request):
    token = request.headers["authorization"].removeprefix("Bearer ")
    claims = jwt.decode(token, PUBLIC_KEY)
    claims.validate()
    data = httpx.get("https://api.example.com/me", headers=dict(request.headers))
    return JSONResponse({"sub": claims["sub"], "me": data.json()})


app = Starlette()
