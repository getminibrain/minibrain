from typing import Any

from sqlalchemy.orm import Session

from minibrain.auth.identity import current_actor
from minibrain.models.deployments import current_pool, deployment_for, owner_key, place, served_base
from minibrain.models.hardware import NodeReport
from minibrain.models.placement import Asked, replica_count, resolve_pool
from minibrain.registry.models import AuditEvent, BaseModel, Deployment, Model


def changes(before: str | None, pool: str, replicas: int, had: int) -> dict[str, Any] | None:
    if before == pool and had == replicas:
        return None
    facts: dict[str, Any] = {"pool": pool, "replicas": replicas}
    return facts | ({"from_pool": before} if before is not None and before != pool else {})


def chosen_replicas(
    session: Session, pool: str, key: str, name: str, found: Deployment, asked: Asked, before: str | None
) -> int:
    kept = found.replicas if before is not None else 1
    if asked.replicas is None and before == pool:
        return kept
    return replica_count(session, pool, key, name, asked.replicas, kept)


def placed(
    session: Session, row: Model | BaseModel, local: NodeReport, asked: Asked
) -> tuple[Deployment, str | None, str, int]:
    before = current_pool(row)
    found = deployment_for(row)
    key = served_base(row)
    pool = resolve_pool(session, local, key, owner_key(row), row.name, asked.pool, before)
    return found, before, pool, chosen_replicas(session, pool, key, row.name, found, asked, before)


def place_custom(session: Session, model: Model, local: NodeReport, asked: Asked) -> dict[str, Any] | None:
    found, before, pool, replicas = placed(session, model, local, asked)
    facts = changes(before, pool, replicas, found.replicas)
    place(found, before, pool, replicas)
    return facts


def audit_deploy(session: Session, model: Model, facts: dict[str, Any]) -> None:
    detail = {"name": model.name, "version": model.current_version} | facts
    session.add(AuditEvent(actor=current_actor(), action="model.deploy", target=model.slug, detail=detail))


def place_base(session: Session, base: BaseModel, local: NodeReport, asked: Asked) -> None:
    found, before, pool, replicas = placed(session, base, local, asked)
    facts = changes(before, pool, replicas, found.replicas)
    if facts is not None:
        detail = {"name": base.name} | facts
        session.add(AuditEvent(actor=current_actor(), action="model.deploy", target=base.id, detail=detail))
    place(found, before, pool, replicas)
