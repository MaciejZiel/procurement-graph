"""Stable response shapes for the public REST API."""

from datetime import date
from decimal import Decimal
from typing import Any

from pydantic import BaseModel


class NodeOut(BaseModel):
    id: str
    kind: str
    label: str
    subtitle: str
    city: str
    details: dict[str, Any]
    is_demo: bool


class EdgeOut(BaseModel):
    id: str
    source_id: str
    target_id: str
    relationship_type: str
    evidence_label: str
    evidence_url: str | None
    occurred_at: date | None
    amount_pln: Decimal | None
    is_demo: bool


class GraphOut(BaseModel):
    nodes: list[NodeOut]
    edges: list[EdgeOut]
    latest_event_at: date | None
    data_mode: str
    notice: str


class StoryOut(BaseModel):
    id: str
    eyebrow: str
    title: str
    summary: str
    node_ids: list[str]
    minutes: int


class HealthOut(BaseModel):
    status: str
    database: str


class SearchOut(BaseModel):
    results: list[NodeOut]
