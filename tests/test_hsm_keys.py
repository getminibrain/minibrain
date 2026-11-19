import io
import os
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from minibrain.encryption import envelope, hsm, keys, rekey
from minibrain.encryption.envelope import HEADER, EnvelopeError
from minibrain.registry.files import store_for
from minibrain.registry.settings_store import write
from tests.conftest import Harness

LIBRARY = "/opt/hsm/libfake-pkcs11.so"
LIBRARY_ENV = "MINIBRAIN_POLICY_HSM_LIBRARY"
EVIL = "/srv/uploads/evil.so"
VALUES = {"encryption": "hsm", "hsm_token": "minibrain", "hsm_key": "minibrain-master"}
SOFTHSM = next(
    (
        path
        for path in (
            "/opt/homebrew/lib/softhsm/libsofthsm2.so",
            "/usr/local/lib/softhsm/libsofthsm2.so",
            "/usr/lib/softhsm/libsofthsm2.so",
            "/usr/lib/x86_64-linux-gnu/softhsm/libsofthsm2.so",
        )
        if Path(path).is_file()
    ),
    None,
)


class FakeToken:
    def __init__(self) -> None:
        self.objects: dict[str, dict[int, bytes]] = {}

    def keys(self, label: str) -> dict[int, Any]:
        return dict(self.objects.get(label, {}))

    def generate(self, label: str, version: int) -> Any:
        self.objects.setdefault(label, {})[version] = AESGCM.generate_key(bit_length=256)
        return self.objects[label][version]

    def encrypt(self, key: Any, iv: bytes, aad: bytes, data: bytes) -> bytes:
        return AESGCM(key).encrypt(iv, data, aad)

    def decrypt(self, key: Any, iv: bytes, aad: bytes, data: bytes) -> bytes:
        try:
            return AESGCM(key).decrypt(iv, data, aad)
        except InvalidTag as error:
            raise EnvelopeError("tag mismatch") from error


@pytest.fixture
def token(monkeypatch: pytest.MonkeyPatch) -> Iterator[FakeToken]:
    fake = FakeToken()
    monkeypatch.setitem(hsm.TOKENS, LIBRARY, fake)
    monkeypatch.setenv(LIBRARY_ENV, LIBRARY)
    yield fake


def newest(path: Path) -> envelope.Wrapped:
    return envelope.parse_header(path.read_bytes()[:HEADER]).newest.wrapped


def test_the_hsm_wraps_new_files_and_rotates_to_a_new_key_object(harness: Harness, token: FakeToken) -> None:
    store = store_for(harness.settings)
    local = store.put_stream(io.BytesIO(b"before the switch")).id
    saved = harness.client.put("/api/settings/encryption", json={"values": VALUES})
    assert saved.status_code == 200, saved.text
    assert saved.json()["key"] == "minibrain/minibrain-master#1" and list(token.objects["minibrain-master"]) == [1]
    stored = store.put_stream(io.BytesIO(b"under the hsm")).id
    assert (newest(store.path(stored)).provider, newest(store.path(stored)).key) == (
        "hsm",
        "minibrain/minibrain-master#1",
    )
    service = keys.keys_for(harness.settings)
    with harness.sessions() as session:
        _, after, _ = rekey.rotate_key(session, service, "tester")
        session.commit()
        tally = rekey.run_pass(session, store, service, rekey.Plan(rewrap=True))
    assert after == "minibrain/minibrain-master#2" and tally.rewrapped == 2 and tally.older == 0
    for artifact_id, payload in ((local, b"before the switch"), (stored, b"under the hsm")):
        assert newest(store.path(artifact_id)).key == after
        with store.open(artifact_id) as stream:
            assert stream.read() == payload


def test_an_hsm_without_the_key_is_refused_once_the_install_uses_it(harness: Harness, token: FakeToken) -> None:
    assert harness.client.put("/api/settings/encryption", json={"values": VALUES}).status_code == 200
    token.objects.clear()
    keys.keys_for(harness.settings).instances.clear()
    with pytest.raises(Exception, match="no AES key"):
        store_for(harness.settings).put_stream(io.BytesIO(b"x"))


def test_hsm_settings_and_pin_are_required(harness: Harness, monkeypatch: pytest.MonkeyPatch) -> None:
    missing = harness.client.put("/api/settings/encryption", json={"values": {"encryption": "hsm"}})
    assert missing.status_code == 422 and "library path" in missing.text
    monkeypatch.delenv(hsm.PIN_ENV, raising=False)
    monkeypatch.setenv(LIBRARY_ENV, "/nope.so")
    no_pin = harness.client.put("/api/settings/encryption", json={"values": VALUES})
    assert no_pin.status_code == 422 and hsm.PIN_ENV in no_pin.text


def library_field(harness: Harness) -> dict[str, Any]:
    found = harness.client.get("/api/settings/encryption").json()["fields"]
    return next(field for field in found if field["name"] == "hsm_library")


def test_the_pkcs11_library_is_never_set_from_the_api(harness: Harness, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(LIBRARY_ENV, raising=False)
    loaded: list[str] = []
    monkeypatch.setattr(hsm, "open_token", lambda config: loaded.append(config.library))
    assert (library_field(harness)["locked"], library_field(harness)["source"]) == (True, "config only")
    evil = {"hsm_library": EVIL}
    changed = harness.client.put("/api/settings/encryption", json={"values": VALUES | evil})
    assert changed.status_code == 409 and LIBRARY_ENV in changed.json()["detail"]
    policy = harness.client.put("/api/policies/hsm_library", json={"value": EVIL})
    assert policy.status_code == 409
    tested = harness.client.post("/api/settings/encryption/test", json={"values": VALUES | evil})
    assert tested.status_code == 200 and not tested.json()["ok"] and LIBRARY_ENV in tested.json()["message"]
    with harness.sessions() as session:
        write(session, "policy.hsm_library", EVIL)
        session.commit()
    assert library_field(harness)["value"] == ""
    assert harness.client.put("/api/settings/encryption", json={"values": VALUES}).status_code == 422
    assert loaded == []
    monkeypatch.setenv(LIBRARY_ENV, LIBRARY)
    assert (library_field(harness)["value"], library_field(harness)["source"]) == (LIBRARY, "environment")


@pytest.fixture
def softhsm(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[str]:
    pkcs11 = pytest.importorskip("PyKCS11")
    if SOFTHSM is None:
        pytest.skip("SoftHSM2 is not installed")
    tokens = tmp_path / "tokens"
    tokens.mkdir()
    config = tmp_path / "softhsm2.conf"
    config.write_text(f"directories.tokendir = {tokens}\nobjectstore.backend = file\nlog.level = ERROR\n")
    monkeypatch.setenv("SOFTHSM2_CONF", str(config))
    library = pkcs11.PyKCS11Lib()
    library.load(SOFTHSM)
    slot = library.getSlotList()[0]
    library.initToken(slot, "87654321", "minibrain")
    session = library.openSession(slot, pkcs11.CKF_SERIAL_SESSION | pkcs11.CKF_RW_SESSION)
    session.login("87654321", user_type=pkcs11.CKU_SO)
    session.initPin("12345678")
    session.logout()
    session.closeSession()
    monkeypatch.setenv(hsm.PIN_ENV, "12345678")
    monkeypatch.setattr(hsm, "OPEN", {})
    yield SOFTHSM


def test_softhsm_wraps_unwraps_and_rotates(harness: Harness, softhsm: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(LIBRARY_ENV, softhsm)
    saved = harness.client.put("/api/settings/encryption", json={"values": VALUES})
    assert saved.status_code == 200, saved.text
    store = store_for(harness.settings)
    payload = os.urandom(2 * (1 << 20) + 3)
    stored = store.put_stream(io.BytesIO(payload)).id
    wrapped = newest(store.path(stored))
    assert (wrapped.provider, wrapped.key) == ("hsm", "minibrain/minibrain-master#1")
    with store.open(stored) as stream:
        assert stream.read() == payload
    service = keys.keys_for(harness.settings)
    with harness.sessions() as session:
        _, after, _ = rekey.rotate_key(session, service, "tester")
        session.commit()
        tally = rekey.run_pass(session, store, service, rekey.Plan(rewrap=True))
    assert after.endswith("#2") and tally.rewrapped == 1
    with store.open(stored) as stream:
        assert stream.read() == payload
    provider = service.target()
    other = provider.wrap(envelope.new_key(), b"minibrain.artifact.one")
    with pytest.raises(EnvelopeError):
        provider.unwrap(other, b"minibrain.artifact.two")
