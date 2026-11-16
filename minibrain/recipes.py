from typing import Any

from minibrain.ml.planner import EFFECTIVE_BATCH, Settings

DEFAULTS = Settings()
DEFAULT_RECIPE: dict[str, Any] = {
    "max_rows": DEFAULTS.max_rows,
    "epochs": DEFAULTS.epochs,
    "rank": DEFAULTS.rank,
    "alpha": 2 * DEFAULTS.rank,
    "learning_rate": DEFAULTS.learning_rate,
    "warmup": DEFAULTS.warmup,
    "scheduler": DEFAULTS.scheduler,
    "dropout": DEFAULTS.dropout,
    "weight_decay": DEFAULTS.weight_decay,
    "batch": EFFECTIVE_BATCH,
}
