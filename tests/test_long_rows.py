from pathlib import Path

import duckdb
import pytest

from minibrain.data.sources import readable_error
from tests.conftest import Harness

LONG = 3 * 1024 * 1024


def test_rows_longer_than_duckdbs_default_are_read(harness: Harness) -> None:
    data = f"text,category\n{'a' * LONG},billing\nshort,bug\n".encode()
    response = harness.client.post("/api/sources", files={"file": ("long.csv", data, "text/csv")})
    assert response.status_code == 201, response.text
    assert (response.json()["rows"], response.json()["error"]) == (2, None)


def test_a_row_over_the_limit_gets_a_plain_message(tmp_path: Path) -> None:
    path = tmp_path / "huge.csv"
    path.write_text(f"text,category\n{'a' * 3000},billing\n")
    with duckdb.connect() as connection, pytest.raises(duckdb.Error) as raised:
        connection.execute(f"SELECT * FROM read_csv_auto('{path}', max_line_size = 1000)").fetchall()
    message = readable_error(raised.value)
    assert message == "a row in huge.csv is longer than 64 MB, the most minibrain reads in one row; split or shorten it"
    assert "aaaa" not in message
