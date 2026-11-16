import shutil
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import BinaryIO

from minibrain.artifacts import STAGED_NAME, ArtifactStore
from minibrain.connections.s3 import filesystem
from minibrain.data.encoding import UTF8, WINDOWS_1252, is_text, known_encoding, transcode
from minibrain.data.folders import FolderScan
from minibrain.data.remote import S3Reader, plain_message
from minibrain.data.sources import READERS, SourceError, stage_files

Opener = Callable[[], BinaryIO]


def overall(encodings: Sequence[str]) -> str:
    return WINDOWS_1252 if WINDOWS_1252 in encodings else UTF8


def readable(open_file: Opener, label: str) -> BinaryIO:
    try:
        return open_file()
    except Exception as error:
        raise SourceError(f"could not read {label}: {plain_message(error)}") from error


def folder_encodings(found: FolderScan) -> list[str]:
    if not is_text(found.format):
        return []
    return [
        known_encoding(
            ("file", item.path, item.size, item.modified),
            lambda path=item.path: readable(local_opener(path), path),
        )
        for item in found.files
    ]


def s3_encodings(reader: S3Reader, format: str | None) -> list[str]:
    if format is None or not is_text(format):
        return []
    fs = filesystem(reader.connection)
    return [
        known_encoding(("s3", url, line), lambda url=url: readable(lambda: fs.open(url, "rb"), url))
        for url, line in zip(reader.files, reader.objects, strict=True)
    ]


def copy_as_utf8(open_file: Opener, label: str, target: Path, encoding: str) -> str:
    with readable(open_file, label) as source, target.open("wb") as out:
        if encoding == WINDOWS_1252:
            transcode(source, out)
        else:
            shutil.copyfileobj(source, out)
    return str(target)


def local_opener(path: str) -> Opener:
    return lambda: Path(path).open("rb")


def folder_build(found: FolderScan, encodings: Sequence[str]) -> Callable[[Path], None]:
    def build(target: Path) -> None:
        files = []
        for index, (item, encoding) in enumerate(zip(found.files, encodings, strict=True)):
            if encoding == WINDOWS_1252:
                plain = target.parent / f"part-{index}{found.format}"
                files.append(copy_as_utf8(local_opener(item.path), item.path, plain, encoding))
            else:
                files.append(item.path)
        stage_files(files, READERS[found.format], found.root.name or str(found.root), target)

    return build


def s3_build(reader: S3Reader, format: str, encodings: Sequence[str]) -> Callable[[Path], None]:
    def build(target: Path) -> None:
        fs = filesystem(reader.connection)
        files = [
            copy_as_utf8(lambda url=url: fs.open(url, "rb"), url, target.parent / f"part-{index}{format}", encoding)
            for index, (url, encoding) in enumerate(zip(reader.files, encodings, strict=True))
        ]
        stage_files(files, READERS[format], reader.scope, target)

    return build


def fallback_prefix(table_name: str) -> str:
    return f"{table_name}-"


def drop_fallbacks(store: ArtifactStore, table_name: str, keep: str | None = None) -> None:
    if not store.staging.is_dir():
        return
    for entry in store.staging.iterdir():
        if entry.is_dir() and entry.name.startswith(fallback_prefix(table_name)) and entry.name != keep:
            shutil.rmtree(entry, ignore_errors=True)


def fallback_staging(store: ArtifactStore, table_name: str, fingerprint: str, build: Callable[[Path], None]) -> str:
    key = f"{fallback_prefix(table_name)}{fingerprint[:32]}"
    if not store.staged_path(f"{key}/{STAGED_NAME}").exists():
        drop_fallbacks(store, table_name, keep=key)
    return store.staged(key, build)
