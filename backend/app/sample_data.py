"""Dated BZP snapshot so a fresh installation has real records to explore."""

import json
from pathlib import Path

from sqlalchemy import Engine, inspect, select
from sqlalchemy.orm import Session

from .import_bzp import save_notices
from .models import ProcurementFacts

SNAPSHOT_PATH = Path(__file__).with_name("bzp_sample.json")


def rebuild_stale_facts(engine: Engine) -> bool:
    """Drop ``procurement_facts`` when its columns differ from the model.

    The table only holds figures derived from the notices, so instead of a migration
    it is recreated and refilled by the seed. Returns whether it was dropped.
    """
    inspector = inspect(engine)
    if not inspector.has_table(ProcurementFacts.__tablename__):
        return False
    existing = {column["name"] for column in inspector.get_columns(ProcurementFacts.__tablename__)}
    expected = {column.name for column in ProcurementFacts.__table__.columns}
    if existing == expected:
        return False
    ProcurementFacts.__table__.drop(engine)
    return True


def seed_bzp_sample(session: Session, path: Path = SNAPSHOT_PATH) -> int:
    """Load the bundled snapshot unless its records (and their facts) are already present.

    Databases created before the analytics facts existed are re-seeded once; the import
    is idempotent, so this only fills in the new table.
    """
    existing = session.scalar(
        select(ProcurementFacts.procurement_id).where(ProcurementFacts.is_demo.is_(False)).limit(1)
    )
    if existing:
        return 0
    payload = json.loads(path.read_text(encoding="utf-8"))
    return save_notices(session, payload["notices"], city_filter=payload["city"])
