"""Dated BZP snapshot so a fresh installation has real records to explore."""

import json
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from .import_bzp import save_notices
from .models import GraphNode


def seed_bzp_sample(session: Session) -> int:
    existing = session.scalar(
        select(GraphNode.id)
        .where(GraphNode.is_demo.is_(False), GraphNode.kind == "procurement")
        .limit(1)
    )
    if existing:
        return 0
    payload = json.loads(Path(__file__).with_name("bzp_sample.json").read_text(encoding="utf-8"))
    return save_notices(session, payload["notices"], city_filter=payload["city"])
