import pytest

from tests.conftest import Harness

HUGE = "99999999999999999999999"


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", f"/api/jobs/{HUGE}"),
        ("get", f"/api/jobs/-{HUGE}"),
        ("delete", f"/api/dataset-folders/{HUGE}"),
        ("get", f"/api/sources/{HUGE}"),
        ("delete", f"/api/me/sessions/{HUGE}"),
    ],
)
def test_ids_beyond_64_bits_are_not_found(harness: Harness, method: str, path: str) -> None:
    response = harness.client.request(method.upper(), path)
    assert response.status_code == 404, response.text


def test_ids_within_64_bits_still_reach_the_route(harness: Harness) -> None:
    assert harness.client.get(f"/api/jobs/{2**63 - 1}").status_code == 404
    assert harness.client.get("/api/jobs/abc").status_code == 422
