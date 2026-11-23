import argparse
import datetime
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHANGELOG = ROOT / "CHANGELOG.md"
SERVER = "https://github.com"
SITE = "https://getminibrain.com"
DOCS = f"{SITE}/docs"
CHANGELOG_PAGE = f"{SITE}/changelog"
OIDC_ISSUER = "https://token.actions.githubusercontent.com"
HEADER = re.compile(r"^(?P<kind>[a-z]+)(?:\((?P<scope>[^)]+)\))?(?P<breaking>!)?: (?P<summary>.+)$")
BREAKING_FOOTER = re.compile(r"^BREAKING[ -]CHANGE: ", re.MULTILINE)
BREAKING = "Breaking changes"
OTHER = "Other changes"
SECTIONS = {
    "feat": "Features",
    "fix": "Fixes",
    "perf": "Performance",
    "refactor": "Refactoring",
    "docs": "Documentation",
    "build": "Build",
    "ci": "CI",
    "test": "Tests",
    "style": "Style",
    "chore": "Chores",
    "revert": "Reverts",
}
ORDER = [BREAKING, *SECTIONS.values(), OTHER]
FIELD = "\x1f"
RECORD = "\x1e"
UNRELEASED = "## Unreleased"
RELEASE_HEADING = re.compile(r"^## (?P<version>\d+\.\d+\.\d+(?:(?:a|b|rc)\d+)?) - (?P<date>\d{4}-\d{2}-\d{2})$")
PRERELEASE = re.compile(r"(a|b|rc|\.dev)\d+")


@dataclass(frozen=True)
class Change:
    sha: str
    section: str
    scope: str | None
    summary: str

    def render(self) -> str:
        scope = f"**{self.scope}:** " if self.scope else ""
        return f"- {scope}{self.summary} ({self.sha})"


@dataclass(frozen=True)
class Release:
    version: str
    date: datetime.date
    notes: str


def releases(text: str) -> list[Release]:
    found: list[Release] = []
    heading: tuple[str, datetime.date] | None = None
    lines: list[str] = []

    def close() -> None:
        if heading is not None:
            found.append(Release(heading[0], heading[1], "\n".join(lines).strip()))

    for number, line in enumerate(text.splitlines(), start=1):
        if not line.startswith("## "):
            lines.append(line)
            continue
        close()
        lines = []
        if line == UNRELEASED:
            heading = None
            continue
        match = RELEASE_HEADING.match(line)
        if match is None:
            raise ValueError(f"CHANGELOG.md line {number}: expected '## X.Y.Z - YYYY-MM-DD' or '{UNRELEASED}'")
        try:
            heading = (match["version"], datetime.date.fromisoformat(match["date"]))
        except ValueError as error:
            raise ValueError(f"CHANGELOG.md line {number}: {error}") from error
    close()
    return found


def highlights(version: str, path: Path = CHANGELOG) -> str | None:
    if not path.exists():
        return None
    entry = next((release for release in releases(path.read_text()) if release.version == version), None)
    return entry.notes if entry else None


def parse(sha: str, subject: str, body: str = "") -> Change:
    found = HEADER.match(subject.strip())
    if found is None or found["kind"] not in SECTIONS:
        section = BREAKING if BREAKING_FOOTER.search(body) else OTHER
        return Change(sha, section, None, subject.strip())
    breaking = bool(found["breaking"]) or bool(BREAKING_FOOTER.search(body))
    section = BREAKING if breaking else SECTIONS[found["kind"]]
    return Change(sha, section, found["scope"], found["summary"].strip())


def git(*args: str, cwd: Path = ROOT, check: bool = True) -> str:
    executable = shutil.which("git")
    if executable is None:
        raise RuntimeError("git is not installed")
    done = subprocess.run([executable, *args], cwd=cwd, capture_output=True, text=True, check=False)
    if check and done.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {done.stderr.strip()}")
    return done.stdout if done.returncode == 0 else ""


def previous_tag(ref: str, cwd: Path = ROOT) -> str | None:
    found = git("describe", "--tags", "--abbrev=0", "--match", "v[0-9]*", f"{ref}^", cwd=cwd, check=False).strip()
    return found or None


def changes(ref: str, since: str | None, cwd: Path = ROOT) -> list[Change]:
    span = f"{since}..{ref}" if since else ref
    log = git("log", "--no-merges", f"--format=%h{FIELD}%s{FIELD}%b{RECORD}", span, cwd=cwd)
    records = [record.strip("\n") for record in log.split(RECORD) if record.strip()]
    return [parse(*record.split(FIELD, 2)) for record in records]


def install_lines(version: str, repo: str, image: str) -> list[str]:
    files = f"{SERVER}/{repo}/releases/download/v{version}"
    guide = f"{DOCS}/get-started/installation"
    wheel = f"{files}/minibrain-{version}-py3-none-any.whl"
    identity = f"--certificate-identity {SERVER}/{repo}/.github/workflows/release.yml@refs/tags/v{version}"
    issuer = f"--certificate-oidc-issuer {OIDC_ISSUER}"
    return [
        "## Install",
        "",
        f"- Installer: `curl -LsSf {files}/install.sh | MINIBRAIN_VERSION={version} sh`",
        f"- Wheel: `uv tool install --python 3.12 {wheel}`",
        f"- Docker, CPU: `docker run -p 127.0.0.1:8000:8000 -v minibrain-data:/data {image}:{version}`",
        f"- Docker, NVIDIA CUDA 13.2: `{image}:{version}-cuda`",
        "",
        "## Verify",
        "",
        "Every file has a Sigstore bundle (`<file>.sigstore.json`) and every image a signature, signed keyless by this",
        "release's workflow run. With [cosign](https://docs.sigstore.dev/cosign/system_config/installation/):",
        "",
        f"- Files: `cosign verify-blob --bundle SHA256SUMS.sigstore.json {identity} {issuer} SHA256SUMS`, then",
        "  `sha256sum --check --ignore-missing SHA256SUMS`",
        f"- Images: `cosign verify {identity} {issuer} {image}:{version}`",
        f"- Provenance: `gh attestation verify <file or oci://{image}:{version}> --repo {repo}`",
        f"- Offline and air-gapped: [Verify a release]({DOCS}/install/verify-release)",
        "",
        f"Guide: [Installation]({guide})",
    ]


def render(
    found: list[Change], *, version: str, since: str | None, repo: str, image: str, notes: str | None = None
) -> str:
    lines = ["## What's new", "", notes, "", f"[Changelog]({CHANGELOG_PAGE}#v{version})", ""] if notes else []
    lines += install_lines(version, repo, image)
    lines += ["", f"## Changes since {since}" if since else "## Changes", ""]
    for section in ORDER:
        entries = [change.render() for change in found if change.section == section]
        if entries:
            lines += [f"### {section}", "", *entries, ""]
    if not found:
        lines += ["No commits.", ""]
    if since:
        lines += [f"**Full changelog**: {SERVER}/{repo}/compare/{since}...v{version}", ""]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Release notes from Conventional Commits since the previous v* tag")
    parser.add_argument("--version", required=True, help="the version being released, without the leading v")
    parser.add_argument("--ref", default="HEAD", help="the commit or tag being released")
    parser.add_argument("--repo", default="getminibrain/minibrain", help="owner/name on GitHub")
    parser.add_argument("--image", default="ghcr.io/getminibrain/minibrain", help="the container image name")
    parser.add_argument("--changelog", type=Path, default=CHANGELOG, help="the changelog to take the highlights from")
    parser.add_argument("--check", action="store_true", help="only check the changelog has this version")
    args = parser.parse_args(argv)
    try:
        notes = highlights(args.version, args.changelog)
    except ValueError as error:
        sys.stderr.write(f"{error}\n")
        return 1
    if notes is None and not PRERELEASE.search(args.version):
        entry = f"## {args.version} - YYYY-MM-DD"
        sys.stderr.write(f"{args.changelog.name} has no '{entry}' entry: write one before releasing\n")
        return 1
    if args.check:
        return 0
    since = previous_tag(args.ref)
    body = render(
        changes(args.ref, since), version=args.version, since=since, repo=args.repo, image=args.image, notes=notes
    )
    sys.stdout.write(body)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
