"""Autenticación HMAC entre Node y FastAPI (contratos-node-fastapi.md)."""

import hashlib
import hmac
import os
import time

from fastapi import HTTPException, Request


def sign(method: str, path: str, timestamp: str, nonce: str, body_hash: str, secret: str) -> str:
    message = f"{method}{path}{timestamp}{nonce}{body_hash}".encode()
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


def sha256_hex(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


class ServiceAuth:
    """Valida la firma HMAC de un request interno (dependencia FastAPI).

    El secreto se lee dinámicamente: primero del constructor, luego del entorno.
    """

    def __init__(self, secret: str | None = None, window_seconds: int = 300) -> None:
        self.secret = secret
        self.window_seconds = window_seconds

    def _secret(self) -> str:
        return self.secret or os.environ.get("AI_SERVICE_SECRET", "")

    async def verify(self, request: Request) -> None:
        secret = self._secret()
        if not secret:
            raise HTTPException(status_code=503, detail="Servicio no configurado")

        service_id = request.headers.get("X-Service-Id")
        timestamp = request.headers.get("X-Service-Timestamp")
        nonce = request.headers.get("X-Service-Nonce")
        signature = request.headers.get("X-Service-Signature")

        if not all([service_id, timestamp, nonce, signature]):
            raise HTTPException(status_code=401, detail="Faltan headers de autenticación")

        try:
            ts = int(timestamp)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            raise HTTPException(status_code=401, detail="Timestamp inválido")

        if abs(int(time.time()) - ts) > self.window_seconds:
            raise HTTPException(status_code=401, detail="Timestamp fuera de ventana")

        body = await request.body()
        expected = sign(
            request.method,
            request.url.path,
            timestamp,  # type: ignore[arg-type]
            nonce,  # type: ignore[arg-type]
            sha256_hex(body),
            secret,
        )
        if not hmac.compare_digest(expected, signature or ""):
            raise HTTPException(status_code=401, detail="Firma inválida")