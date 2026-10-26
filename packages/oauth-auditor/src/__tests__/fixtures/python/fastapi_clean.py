"""A FastAPI MCP resource server that checks the audience and exchanges the token for a downstream one (test fixture)."""
import os

import httpx
import jwt
from authlib.jose import jwt as jose_jwt
from fastapi import FastAPI, Request

app = FastAPI()
JWKS_KEY = os.environ["JWKS_KEY"]
RESOURCE = "https://mcp.example.com"


def verify(token: str) -> dict:
    return jwt.decode(token, JWKS_KEY, algorithms=["RS256"], audience=RESOURCE)


def verify_authlib(token: str):
    claims = jose_jwt.decode(token, JWKS_KEY, claims_options={"aud": {"essential": True, "value": RESOURCE}})
    claims.validate()
    return claims


async def exchange(token: str) -> str:
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://auth.example.com/token",
            data={
                "grant_type": "urn:ietf:params:oauth:grant-type:token-exchange",
                "subject_token": token,
                "audience": "https://api.example.com",
            },
        )
    return response.json()["access_token"]


@app.post("/mcp")
async def mcp_endpoint(request: Request):
    token = request.headers.get("authorization", "").removeprefix("Bearer ")
    verify(token)
    downstream = await exchange(token)
    async with httpx.AsyncClient() as client:
        upstream = await client.get("https://api.example.com/v1/files", headers={"Authorization": f"Bearer {downstream}"})
    return upstream.json()
