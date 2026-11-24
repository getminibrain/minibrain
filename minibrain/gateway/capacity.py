from collections.abc import AsyncIterator, Callable, Generator
from functools import partial
from typing import Any

import anyio
from anyio import to_thread
from fastapi.responses import StreamingResponse
from starlette.types import Receive, Scope, Send

from minibrain.gateway.errors import OpenAIError
from minibrain.serve.engines import START_WAIT

BUSY_RETRY_SECONDS = 5
START_WAIT_SECONDS = 5.0
EVENT_STREAM = "text/event-stream"

Answer = dict[str, Any] | Generator[str]
Work = Callable[[], Answer]


def busy(limit: int) -> OpenAIError:
    message = (
        f"This gateway is answering {limit} calls, as many as it takes at once; try again in {BUSY_RETRY_SECONDS} s."
    )
    headers = {"Retry-After": str(BUSY_RETRY_SECONDS)}
    return OpenAIError(503, message, None, "overloaded", "server_error", headers)


def impatient(work: Work) -> Answer:
    START_WAIT.set(START_WAIT_SECONDS)
    return work()


class Generations:
    def __init__(self, limit: int) -> None:
        self.limit = limit
        self.slots = anyio.CapacityLimiter(limit)
        self.threads = anyio.CapacityLimiter(limit)

    @property
    def in_use(self) -> int:
        return self.slots.borrowed_tokens

    def admit(self) -> object:
        slot = object()
        try:
            self.slots.acquire_on_behalf_of_nowait(slot)
        except anyio.WouldBlock:
            raise busy(self.limit) from None
        return slot

    def release(self, slot: object) -> None:
        self.slots.release_on_behalf_of(slot)

    async def answer(self, slot: object, work: Work) -> dict[str, Any] | StreamingResponse:
        try:
            found = await to_thread.run_sync(impatient, work, limiter=self.threads)
        except BaseException:
            self.release(slot)
            raise
        if isinstance(found, dict):
            self.release(slot)
            return found
        return GenerationStream(self, slot, found)

    async def relay(self, chunks: Generator[str]) -> AsyncIterator[str]:
        while (chunk := await to_thread.run_sync(partial(next, chunks, None), limiter=self.threads)) is not None:
            yield chunk


class GenerationStream(StreamingResponse):
    def __init__(self, generations: Generations, slot: object, chunks: Generator[str]) -> None:
        super().__init__(generations.relay(chunks), media_type=EVENT_STREAM)
        self.generations = generations
        self.slot = slot
        self.chunks = chunks

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        try:
            await super().__call__(scope, receive, send)
        finally:
            await self.finish()

    async def finish(self) -> None:
        try:
            with anyio.CancelScope(shield=True):
                await to_thread.run_sync(self.chunks.close, limiter=self.generations.threads)
        finally:
            self.generations.release(self.slot)
