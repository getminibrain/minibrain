import codecs
import threading
from collections.abc import Callable, Hashable
from pathlib import Path
from typing import BinaryIO

UTF8 = "utf-8"
WINDOWS_1252 = "windows-1252"
UTF16_LE = "utf-16le"
UTF16_BE = "utf-16be"
UTF16_MARKS = {codecs.BOM_UTF16_LE: UTF16_LE, codecs.BOM_UTF16_BE: UTF16_BE}
MARK_SIZE = 4
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


def utf16_mark(block: bytes) -> str | None:
    if block.startswith(codecs.BOM_UTF32_LE):
        return None
    return next((name for mark, name in UTF16_MARKS.items() if block.startswith(mark)), None)


def transcoded(encoding: str | None) -> bool:
    return encoding is not None and encoding != UTF8


class EncodingCheck:
    def __init__(self) -> None:
        self.decoder = codecs.getincrementaldecoder(UTF8)()
        self.valid = True
        self.head = b""
        self.marked: str | None = None

    @property
    def settled(self) -> bool:
        return not self.valid or self.marked is not None

    def feed(self, block: bytes, final: bool = False) -> None:
        if len(self.head) < MARK_SIZE:
            self.head += block[: MARK_SIZE - len(self.head)]
            self.marked = utf16_mark(self.head) if len(self.head) >= MARK_SIZE or final else None
        if self.settled:
            return
        try:
            self.decoder.decode(block, final)
        except UnicodeDecodeError:
            self.valid = False

    def result(self) -> str:
        self.feed(b"", final=True)
        if self.marked is not None:
            return self.marked
        return UTF8 if self.valid else WINDOWS_1252


def detect(stream: BinaryIO) -> str:
    check = EncodingCheck()
    while not check.settled and (block := stream.read(BLOCK)):
        check.feed(block)
    return check.result()


def transcode_utf16(source: BinaryIO, target: BinaryIO) -> None:
    decoder = codecs.getincrementaldecoder("utf-16")(errors="replace")
    while block := source.read(BLOCK):
        target.write(decoder.decode(block).encode(UTF8))
    target.write(decoder.decode(b"", True).encode(UTF8))


def transcode(source: BinaryIO, target: BinaryIO, encoding: str = WINDOWS_1252) -> None:
    if encoding in UTF16_MARKS.values():
        transcode_utf16(source, target)
        return
    mark = codecs.BOM_UTF8
    while block := source.read(BLOCK):
        target.write(block.removeprefix(mark).decode("cp1252", errors=UNDEFINED_AS_LATIN1).encode(UTF8))
        mark = b""


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
