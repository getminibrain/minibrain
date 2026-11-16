import codecs
import threading
from collections.abc import Callable, Hashable
from pathlib import Path
from typing import BinaryIO

UTF8 = "utf-8"
WINDOWS_1252 = "windows-1252"
TEXT_SUFFIXES = frozenset({".csv", ".tsv", ".json", ".jsonl", ".ndjson"})
BLOCK = 1 << 20
UNDEFINED_AS_LATIN1 = "minibrain-undefined-as-latin1"
KNOWN_LIMIT = 100_000


def undefined_as_latin1(error: UnicodeError) -> tuple[str, int]:
    if not isinstance(error, UnicodeDecodeError):
        raise error
    return error.object[error.start : error.end].decode("latin-1"), error.end


codecs.register_error(UNDEFINED_AS_LATIN1, undefined_as_latin1)


def is_text(name: str) -> bool:
    lowered = name.lower()
    return lowered in TEXT_SUFFIXES or Path(lowered).suffix in TEXT_SUFFIXES


class EncodingCheck:
    def __init__(self) -> None:
        self.decoder = codecs.getincrementaldecoder(UTF8)()
        self.valid = True

    def feed(self, block: bytes, final: bool = False) -> None:
        if not self.valid:
            return
        try:
            self.decoder.decode(block, final)
        except UnicodeDecodeError:
            self.valid = False

    def result(self) -> str:
        self.feed(b"", final=True)
        return UTF8 if self.valid else WINDOWS_1252


def detect(stream: BinaryIO) -> str:
    check = EncodingCheck()
    while check.valid and (block := stream.read(BLOCK)):
        check.feed(block)
    return check.result()


def transcode(source: BinaryIO, target: BinaryIO) -> None:
    while block := source.read(BLOCK):
        target.write(block.decode("cp1252", errors=UNDEFINED_AS_LATIN1).encode(UTF8))


KNOWN: dict[Hashable, str] = {}
KNOWN_LOCK = threading.Lock()


def known_encoding(identity: Hashable, opener: Callable[[], BinaryIO]) -> str:
    with KNOWN_LOCK:
        found = KNOWN.get(identity)
    if found is not None:
        return found
    with opener() as stream:
        found = detect(stream)
    with KNOWN_LOCK:
        if len(KNOWN) >= KNOWN_LIMIT:
            KNOWN.clear()
        KNOWN[identity] = found
    return found
