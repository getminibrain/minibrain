from minibrain.api import card_export, model_status
from minibrain.api.card_builder import rounded
from minibrain.api.numbers import percent_text, points_text


def test_percentages_round_half_up_to_one_decimal() -> None:
    assert [percent_text(value) for value in (0.8125, 0.8135, 0.0005, 0.99949, 1.0, 0.0)] == [
        "81.3%",
        "81.4%",
        "0.1%",
        "99.9%",
        "100.0%",
        "0.0%",
    ]
    assert [points_text(value) for value in (0.0125, -0.0125, 0.0)] == ["+1.3", "-1.3", "+0.0"]


def test_status_lines_cards_and_ai_boms_round_scores_the_same_way() -> None:
    assert model_status.share(0.8125) == card_export.percent(0.8125) == "81.3%"
    assert model_status.points(0.0125) == "+1.3"
    assert card_export.change(0.0125) == "+1.3 pts"
    assert card_export.change(0.0004) == "Same"
    assert rounded(0.81245) == 0.8125
