from decimal import ROUND_HALF_UP, Decimal


def half_up(value: float, digits: int) -> Decimal:
    return Decimal(repr(value)).quantize(Decimal(1).scaleb(-digits), rounding=ROUND_HALF_UP)


def percent_number(value: float) -> Decimal:
    return half_up(value * 100, 1)


def percent_text(value: float) -> str:
    return f"{percent_number(value)}%"


def points_text(value: float) -> str:
    return f"{percent_number(value):+}"
