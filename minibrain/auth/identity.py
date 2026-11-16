from contextvars import ContextVar
from dataclasses import dataclass

from minibrain.auth.roles import Role


@dataclass(frozen=True)
class Person:
    id: int
    name: str
    email: str | None
    source: str
    role: Role | None
    role_locked: bool = False
    subject: str = ""

    @property
    def actor(self) -> str:
        return handle_of(self.email, self.source, self.subject)


def handle_of(email: str | None, source: str, subject: str) -> str:
    return email or f"{source}:{subject}"


CURRENT: ContextVar[Person | None] = ContextVar("person", default=None)


class NobodySignedIn(LookupError):
    pass


def current_person() -> Person | None:
    return CURRENT.get()


def current_actor() -> str:
    person = CURRENT.get()
    if person is None:
        raise NobodySignedIn("No one is signed in")
    return person.actor


def current_account() -> int:
    person = CURRENT.get()
    if person is None:
        raise NobodySignedIn("No one is signed in")
    return person.id


def current_role() -> Role | None:
    person = CURRENT.get()
    return person.role if person is not None else None
