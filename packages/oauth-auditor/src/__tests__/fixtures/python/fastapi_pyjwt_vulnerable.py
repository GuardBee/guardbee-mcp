"""A FastAPI MCP resource server that forwards the client's token and skips the audience check (test fixture)."""
import httpx
import jwt
from fastapi import FastAPI, Request

app = FastAPI()
JWKS_KEY = open("jwks.pem").read()


def verify(token: str) -> dict:
    return jwt.decode(token, JWKS_KEY, algorithms=["RS256"])


@app.post("/mcp")
async def mcp_endpoint(request: Request):
    auth = request.headers.get("authorization")
    verify(auth.removeprefix("Bearer "))
    async with httpx.AsyncClient() as client:
        upstream = await client.get(
            "https://api.example.com/v1/files",
            headers={"Authorization": auth},
        )
    return upstream.json()
