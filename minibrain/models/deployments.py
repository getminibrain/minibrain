from sqlalchemy import ColumnElement, Select, select
from sqlalchemy.orm import Session

from minibrain.models.hardware import LOCAL_POOL
from minibrain.registry.models import BaseModel, Deployment, Model, Version, now

Owner = Model | BaseModel


def is_deployed(row: Owner) -> bool:
    return row.deployment is not None


def owner_row(found: Deployment) -> Owner:
    owner = found.model or found.base_model
    if owner is None:
        raise LookupError(f"deployment {found.id} has no model")
    return owner


def owner_key(row: Owner) -> str:
    return f"model:{row.id}" if isinstance(row, Model) else f"base:{row.id}"


def served_name(row: Owner) -> str:
    return row.slug if isinstance(row, Model) else row.id


def deployed_base(model: Model) -> str:
    found = model.deployment
    return (found.base if found is not None else None) or model.base_model


def live_version(model: Model) -> Version | None:
    if not is_deployed(model) or model.current_version is None:
        return None
    return next((item for item in model.versions if item.number == model.current_version), None)


def serving_base(model: Model) -> str:
    live = live_version(model)
    if live is not None:
        return live.base_model
    return deployed_base(model)


def served_base(row: Owner) -> str:
    return serving_base(row) if isinstance(row, Model) else row.id


def current_pool(row: Owner) -> str | None:
    found = row.deployment
    return found.pool if found is not None else None


def serving_pool(found: Deployment) -> str:
    return found.moving_from or found.pool


def moving_to(found: Deployment) -> str | None:
    return found.pool if found.moving_from else None


def pools_of(found: Deployment) -> set[str]:
    return {found.pool} | ({found.moving_from} if found.moving_from else set())


def deployed_bases() -> Select[BaseModel]:
    return select(BaseModel).join(BaseModel.deployment)


def deployed_rows(session: Session, *bases_where: ColumnElement[bool]) -> list[tuple[Owner, Deployment]]:
    models = select(Model, Deployment).join(Model.deployment).order_by(Model.name)
    bases = select(BaseModel, Deployment).join(BaseModel.deployment).where(*bases_where).order_by(BaseModel.name)
    return [(row, found) for row, found in [*session.execute(models), *session.execute(bases)]]


def model_deployed() -> ColumnElement[bool]:
    return Model.deployment.has()


def moving(session: Session) -> list[Deployment]:
    return list(session.scalars(select(Deployment).where(Deployment.moving_from.is_not(None)).order_by(Deployment.id)))


def deployment_for(row: Owner) -> Deployment:
    found = row.deployment
    if found is None:
        found = Deployment(pool=LOCAL_POOL, base=row.base_model if isinstance(row, Model) else None)
        row.deployment = found
    return found


def remove_deployment(row: Owner) -> None:
    row.deployment = None


def stop_moving(found: Deployment) -> None:
    found.moving_from = None
    found.moving_since = None
    found.updated_at = now()


def begin_move(found: Deployment, before: str | None, pool: str) -> None:
    found.move_failure = None
    if before is None:
        stop_moving(found)
        return
    if before == pool:
        return
    if found.moving_from == pool:
        stop_moving(found)
        return
    found.moving_from = found.moving_from or before
    found.moving_since = now()


def place(found: Deployment, before: str | None, pool: str, replicas: int) -> None:
    begin_move(found, before, pool)
    found.pool, found.replicas = pool, replicas
    found.updated_at = now()


def roll_back(found: Deployment, failure: str) -> None:
    target, back = found.pool, found.moving_from or LOCAL_POOL
    found.move_failure = f"Moving to {target} failed: {failure}. It stays on {back}."
    found.pool = back
    stop_moving(found)
