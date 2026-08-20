"""Autenticación HMAC entre Node y FastAPI (contratos-node-fastapi.md).

Anti-replay: cada request firmado debe usar un nonce único dentro de la ventana
temporal. El servicio mantiene un registro en memoria de nonces consumidos; un
nonce repetido (replay) se rechaza con 401 NONCE_REUSED.
"""

import hashlib
import hmac
import logging
import os
import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request


def sign(method: str, path: str, timestamp: str, nonce: str, body_hash: str, secret: str) -> str:
    message = f"{method}{path}{timestamp}{nonce}{body_hash}".encode()
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


def sha256_hex(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


class NonceStore:
    """Registro en memoria de nonces consumidos por servicio (thread-safe).

    Un nonce es `{service_id}:{nonce}` y vence después de la ventana temporal.
    """

    def __init__(self, ttl_seconds: int = 300) -> None:
        self.ttl_seconds = ttl_seconds
        self._lock = threading.Lock()
        self._nonces: dict[str, deque[float]] = defaultdict(deque)

    def consume(self, service_id: str, nonce: str) -> bool:
        """Devuelve True si el nonce es nuevo (o vencido) y lo registra."""
        key = f"{service_id}:{nonce}"
        now = time.time()
        cutoff = now - self.ttl_seconds
        with self._lock:
            seen = self._nonces[key]
            # Podar timestamps vencidos para esa clave.
            while seen and seen[0] < cutoff:
                seen.popleft()
            if seen:
                return False  # nonce reutilizado dentro de la ventana
            seen.append(now)
            # Limpieza global periódica para no crecer sin límite.
            if len(self._nonces) > 10_000:
                self._nonces = {
                    k: q for k, q in self._nonces.items() if q and q[-1] >= cutoff
                }
            return True


class ServiceAuth:
    """Valida la firma HMAC de un request interno (dependencia FastAPI).

    El secreto se lee dinámicamente: primero del constructor, luego del entorno.
    Rechaza requests reenviados (mismo nonce) dentro de la ventana temporal.
    """

    def __init__(self, secret: str | None = None, window_seconds: int = 300) -> None:
        self.secret = secret
        self.window_seconds = window_seconds
        self._nonces = NonceStore(window_seconds)

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

        # Anti-replay: después de validar la firma, el nonce no puede haberse
        # consumido antes dentro de la ventana (un request reenviado se rechaza).
        if not self._nonces.consume(str(service_id), str(nonce)):
            logging.getLogger(__name__).warning("HMAC nonce reutilizado (replay): service=%s", service_id)
            raise HTTPException(status_code=401, detail="Nonce reutilizado")