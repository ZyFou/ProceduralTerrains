"""Safe package opening for ZIP exports and direct .ptrterrain documents."""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
import os
from pathlib import Path
import shutil
import stat
import tempfile
from typing import Iterator
import zipfile


MAXIMUM_ENTRY_COUNT = 4096
MAXIMUM_EXPANDED_BYTES = 8 * 1024 * 1024 * 1024
ALLOWED_EXTENSIONS = frozenset((
    ".ptrterrain", ".raw", ".png", ".glb", ".gltf", ".bin",
    ".obj", ".mtl", ".json", ".txt",
))


class TerrainPackageError(ValueError):
    pass


@dataclass(frozen=True)
class ProjectSource:
    document_path: Path
    root: Path
    source_path: Path
    from_archive: bool


def _validated_member_path(name: str) -> tuple[str, ...]:
    if not name or "\\" in name or name.startswith("/") or ":" in name or "\x00" in name:
        raise TerrainPackageError(f"The ZIP contains an unsafe path: {name}")
    trimmed = name[:-1] if name.endswith("/") else name
    parts = tuple(trimmed.split("/"))
    if not parts or any(part in ("", ".", "..") for part in parts):
        raise TerrainPackageError(f"The ZIP contains an unsafe path: {name}")
    return parts


def _validate_archive(archive: zipfile.ZipFile) -> tuple[list[zipfile.ZipInfo], zipfile.ZipInfo]:
    entries = archive.infolist()
    if not entries or len(entries) > MAXIMUM_ENTRY_COUNT:
        raise TerrainPackageError(f"The ZIP must contain between 1 and {MAXIMUM_ENTRY_COUNT} entries.")
    seen: set[str] = set()
    projects: list[zipfile.ZipInfo] = []
    expanded = 0
    for entry in entries:
        parts = _validated_member_path(entry.filename)
        key = "/".join(parts).casefold()
        if key in seen:
            raise TerrainPackageError(f"The ZIP contains a duplicate path: {entry.filename}")
        seen.add(key)
        unix_mode = (entry.external_attr >> 16) & 0xFFFF
        if stat.S_IFMT(unix_mode) == stat.S_IFLNK:
            raise TerrainPackageError(f"The ZIP contains a symbolic link: {entry.filename}")
        if entry.flag_bits & 0x1:
            raise TerrainPackageError(f"Encrypted ZIP entries are not supported: {entry.filename}")
        if not entry.is_dir():
            extension = Path(parts[-1]).suffix.casefold()
            if extension not in ALLOWED_EXTENSIONS:
                raise TerrainPackageError(f"The ZIP contains a file type terrain exports do not use: {entry.filename}")
            expanded += entry.file_size
            if expanded > MAXIMUM_EXPANDED_BYTES:
                raise TerrainPackageError("The expanded ZIP exceeds the 8 GB import limit.")
            if parts[-1].casefold() == "project.ptrterrain":
                projects.append(entry)
    if len(projects) != 1:
        raise TerrainPackageError("The ZIP must contain exactly one project.ptrterrain document.")
    return entries, projects[0]


def _extract_archive(archive: zipfile.ZipFile, entries: list[zipfile.ZipInfo], destination: Path) -> None:
    destination_resolved = destination.resolve()
    for entry in entries:
        parts = _validated_member_path(entry.filename)
        output = destination.joinpath(*parts)
        output_resolved = output.resolve()
        try:
            common = os.path.commonpath((str(destination_resolved), str(output_resolved)))
        except ValueError as exc:
            raise TerrainPackageError(f"The ZIP path escapes its import folder: {entry.filename}") from exc
        if common != str(destination_resolved):
            raise TerrainPackageError(f"The ZIP path escapes its import folder: {entry.filename}")
        if entry.is_dir():
            output.mkdir(parents=True, exist_ok=True)
            continue
        output.parent.mkdir(parents=True, exist_ok=True)
        with archive.open(entry, "r") as source, output.open("xb") as target:
            shutil.copyfileobj(source, target, length=1024 * 1024)


@contextmanager
def open_project_source(path: str | Path) -> Iterator[ProjectSource]:
    source = Path(path).expanduser().resolve()
    if not source.is_file():
        raise TerrainPackageError(f"Select a Procedural Terrains ZIP or .ptrterrain file: {source}")
    if source.suffix.casefold() == ".ptrterrain":
        yield ProjectSource(source, source.parent, source, False)
        return
    if source.suffix.casefold() != ".zip":
        raise TerrainPackageError("Select a Procedural Terrains ZIP or .ptrterrain file.")
    try:
        with zipfile.ZipFile(source, "r") as archive:
            entries, project_entry = _validate_archive(archive)
            with tempfile.TemporaryDirectory(prefix="procedural-terrains-") as temporary:
                root = Path(temporary)
                _extract_archive(archive, entries, root)
                document_path = root.joinpath(*_validated_member_path(project_entry.filename))
                yield ProjectSource(document_path, document_path.parent, source, True)
    except zipfile.BadZipFile as exc:
        raise TerrainPackageError("The selected file is not a valid ZIP archive.") from exc
