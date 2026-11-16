import math
from datetime import datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from minibrain.registry.models import SignInAttempt

ADDRESS_LIMIT = 30
ADDRESS_WINDOW = timedelta(minutes=5)
LOCK_AFTER = 10
LOCK_LIFETIME = timedelta(minutes=15)
KEPT_FOR = max(ADDRESS_WINDOW, LOCK_LIFETIME)


class TooManyAttempts(Exception):
    pass


def minutes_until(moment: datetime, until: datetime) -> int:
    return max(1, math.ceil((until - moment).total_seconds() / 60))


def forget_old(session: Session, moment: datetime) -> None:
    session.execute(delete(SignInAttempt).where(SignInAttempt.at < moment - KEPT_FOR))


def check_address(session: Session, address: str, moment: datetime) -> None:
    query = select(SignInAttempt.at).where(
        SignInAttempt.address == address, SignInAttempt.at >= moment - ADDRESS_WINDOW
    )
    times = sorted(session.scalars(query))
    if len(times) >= ADDRESS_LIMIT:
        minutes = minutes_until(moment, times[-ADDRESS_LIMIT] + ADDRESS_WINDOW)
        raise TooManyAttempts(f"Too many sign-in attempts from this address. Try again in {minutes} minutes.")


def lock_ends(session: Session, address: str, email: str, moment: datetime) -> datetime | None:
    query = select(SignInAttempt.at).where(
        SignInAttempt.address == address,
        SignInAttempt.email == email,
        SignInAttempt.failed.is_(True),
        SignInAttempt.at >= moment - LOCK_LIFETIME,
    )
    failures = sorted(session.scalars(query))
    return failures[-LOCK_AFTER] + LOCK_LIFETIME if len(failures) >= LOCK_AFTER else None


def record(session: Session, address: str, email: str, moment: datetime) -> SignInAttempt:
    attempt = SignInAttempt(address=address, email=email, failed=False, at=moment)
    session.add(attempt)
    return attempt


def forget_failures(session: Session, email: str, address: str | None = None) -> None:
    query = delete(SignInAttempt).where(SignInAttempt.email == email, SignInAttempt.failed.is_(True))
    if address is not None:
        query = query.where(SignInAttempt.address == address)
    session.execute(query)
