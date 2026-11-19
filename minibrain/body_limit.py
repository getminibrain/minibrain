from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.datastructures import Headers
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from minibrain.gateway.errors import CHAT_PATHS, OpenAIError

MIB = 1024 * 1024
DEFAULT_LIMIT = 16 * MIB
PREFIX_LIMITS = (("/v1/", 32 * MIB), ("/api/playground/", 32 * MIB), ("/internal/", 256 * MIB))
STREAMED_PATHS = frozenset({"/api/sources"})
STREAMED_PREFIXES = ("/internal/worker/artifacts/",)
OPENAI_PREFIX = "/v1/"


class BodyTooLarge(HTTPException):
    def __init__(self, path: str, limit: int) -> None:
        super().__init__(status_code=413, detail=f"The request body is larger than {limit // MIB} MiB")
        self.path = path


def limit_for(path: str) -> int | None:
    if path in STREAMED_PATHS or path.startswith(STREAMED_PREFIXES):
        return None
    return next((limit for prefix, limit in PREFIX_LIMITS if path.startswith(prefix)), DEFAULT_LIMIT)


def declared_length(scope: Scope) -> int | None:
    value = Headers(scope=scope).get("content-length", "").strip()
    return int(value) if value.isascii() and value.isdigit() else None


def too_large_response(error: BodyTooLarge) -> JSONResponse:
    if error.path.startswith(OPENAI_PREFIX) or error.path in CHAT_PATHS:
        found = OpenAIError(413, str(error.detail), code="body_too_large")
        return JSONResponse(status_code=413, content=found.body())
    return JSONResponse(status_code=413, content={"detail": error.detail})


async def too_large(_request: Request, error: Exception) -> JSONResponse:
    if not isinstance(error, BodyTooLarge):
        raise error
    return too_large_response(error)


class BodyLimit:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        limit = limit_for(scope["path"]) if scope["type"] == "http" else None
        if limit is None:
            await self.app(scope, receive, send)
            return
        declared = declared_length(scope)
        if declared is not None and declared > limit:
            await too_large_response(BodyTooLarge(scope["path"], limit))(scope, receive, send)
            return
        received = 0

        async def counted() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    raise BodyTooLarge(scope["path"], limit)
            return message

        await self.app(scope, counted, send)


def limit_bodies(app: FastAPI) -> None:
    app.add_exception_handler(BodyTooLarge, too_large)
    app.add_middleware(BodyLimit)
