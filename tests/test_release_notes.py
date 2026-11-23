import datetime
import os
from pathlib import Path

import pytest

from scripts.release_notes import (
    BREAKING,
    CHANGELOG,
    OTHER,
    Change,
    changes,
    git,
    highlights,
    main,
    parse,
    previous_tag,
    releases,
    render,
)

IDENTITY = {
    "GIT_CONFIG_GLOBAL": os.devnull,
    "GIT_CONFIG_NOSYSTEM": "1",
    "GIT_AUTHOR_NAME": "Release Test",
    "GIT_AUTHOR_EMAIL": "release@example.com",
    "GIT_COMMITTER_NAME": "Release Test",
    "GIT_COMMITTER_EMAIL": "release@example.com",
}


@pytest.fixture
def repo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    for name, value in IDENTITY.items():
        monkeypatch.setenv(name, value)
    git("init", "--quiet", "--initial-branch", "main", cwd=tmp_path)
    return tmp_path


def commit(repo: Path, subject: str, body: str = "") -> None:
    message = ["-m", subject, "-m", body] if body else ["-m", subject]
    git("commit", "--quiet", "--allow-empty", *message, cwd=repo)


def test_conventional_headers_pick_the_section_and_scope() -> None:
    assert parse("a1", "feat(auth): sign in with OIDC") == Change("a1", "Features", "auth", "sign in with OIDC")
    assert parse("b2", "fix: wrap header actions") == Change("b2", "Fixes", None, "wrap header actions")
    assert parse("c3", "feat(api)!: drop /api/v0").section == BREAKING
    assert parse("d4", "refactor: one guard", "BREAKING CHANGE: roles renamed").section == BREAKING
    assert parse("e5", "Merge branch main") == Change("e5", OTHER, None, "Merge branch main")
    assert parse("f6", "wip: half done") == Change("f6", OTHER, None, "wip: half done")


def test_changes_since_the_previous_tag(repo: Path) -> None:
    commit(repo, "feat: first")
    git("tag", "v0.1.0", cwd=repo)
    commit(repo, "fix(web): second")
    commit(repo, "feat(api)!: third")
    git("tag", "-a", "v0.2.0", "-m", "v0.2.0", cwd=repo)
    commit(repo, "docs: fourth")

    assert previous_tag("v0.1.0", cwd=repo) is None
    assert previous_tag("v0.2.0", cwd=repo) == "v0.1.0"
    assert previous_tag("HEAD", cwd=repo) == "v0.2.0"
    assert [change.summary for change in changes("v0.2.0", "v0.1.0", cwd=repo)] == ["third", "second"]
    assert [change.summary for change in changes("v0.1.0", None, cwd=repo)] == ["first"]


def test_notes_list_breaking_changes_first_and_link_the_comparison() -> None:
    found = [
        Change("a1", "Fixes", "web", "wrap header actions"),
        Change("b2", BREAKING, "api", "drop /api/v0"),
        Change("c3", "Features", None, "release workflow"),
    ]
    notes = render(found, version="0.2.0", since="v0.1.0", repo="getminibrain/minibrain", image="ghcr.io/o/minibrain")
    sections = [line for line in notes.splitlines() if line.startswith("### ")]
    assert sections == ["### Breaking changes", "### Features", "### Fixes"]
    assert "- **api:** drop /api/v0 (b2)" in notes
    assert "- release workflow (c3)" in notes
    assert "releases/download/v0.2.0/minibrain-0.2.0-py3-none-any.whl" in notes
    assert "`ghcr.io/o/minibrain:0.2.0-cuda`" in notes
    assert "releases/download/v0.2.0/install.sh | MINIBRAIN_VERSION=0.2.0 sh" in notes
    identity = "--certificate-identity https://github.com/getminibrain/minibrain/.github/workflows/release.yml@refs/tags/v0.2.0"
    assert f"cosign verify {identity} --certificate-oidc-issuer https://token.actions.githubusercontent.com" in notes
    assert notes.rstrip().endswith("https://github.com/getminibrain/minibrain/compare/v0.1.0...v0.2.0")


def test_a_first_release_lists_every_commit_without_a_comparison() -> None:
    notes = render([Change("a1", "Features", None, "first")], version="0.1.0", since=None, repo="o/m", image="i")
    assert "## Changes\n" in notes
    assert "compare" not in notes


CHANGELOG_TEXT = """# Changelog

Newest first.

## Unreleased

- not out yet

## 0.2.0 - 2026-12-01

- tool calling

### Data

- folders

## 0.1.0 - 2026-11-04

The first release.
"""


def test_the_changelog_splits_into_releases_and_skips_unreleased() -> None:
    found = releases(CHANGELOG_TEXT)
    assert [(release.version, release.date) for release in found] == [
        ("0.2.0", datetime.date(2026, 12, 1)),
        ("0.1.0", datetime.date(2026, 11, 4)),
    ]
    assert found[0].notes == "- tool calling\n\n### Data\n\n- folders"
    assert found[1].notes == "The first release."


@pytest.mark.parametrize("heading", ["## v0.2.0 - 2026-12-01", "## 0.2.0", "## 0.2.0 - 2026-13-01", "## Next"])
def test_a_changelog_heading_that_is_not_a_release_is_refused(heading: str) -> None:
    with pytest.raises(ValueError, match="line 3"):
        releases(f"# Changelog\n\n{heading}\n")


def test_the_repository_changelog_is_well_formed_and_newest_first() -> None:
    found = releases(CHANGELOG.read_text())
    versions = [release.version for release in found]
    assert len(versions) == len(set(versions))
    assert [release.date for release in found] == sorted((release.date for release in found), reverse=True)
    assert all(release.notes for release in found)


def test_notes_lead_with_the_changelog_entry_when_there_is_one() -> None:
    notes = render([], version="0.2.0", since="v0.1.0", repo="o/m", image="i", notes="- tool calling")
    assert notes.startswith("## What's new\n\n- tool calling\n\n[Changelog](https://getminibrain.com/changelog#v0.2.0)")
    assert render([], version="0.2.0", since="v0.1.0", repo="o/m", image="i").startswith("## Install")


def test_a_release_needs_a_changelog_entry_but_a_prerelease_does_not(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    changelog = tmp_path / "CHANGELOG.md"
    changelog.write_text(CHANGELOG_TEXT)
    assert highlights("0.2.0", changelog) == "- tool calling\n\n### Data\n\n- folders"
    assert main(["--version", "0.2.0", "--changelog", str(changelog), "--check"]) == 0
    assert main(["--version", "0.3.0", "--changelog", str(changelog), "--check"]) == 1
    assert "no '## 0.3.0 - YYYY-MM-DD' entry" in capsys.readouterr().err
    assert main(["--version", "0.3.0rc1", "--changelog", str(changelog), "--check"]) == 0
