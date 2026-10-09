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
    total_tenders: int
    offset: int
    limit: int
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


class EntityRefOut(BaseModel):
    id: str
    label: str
    city: str


class RedFlagOut(BaseModel):
    code: str
    params: dict[str, Any]


class RedFlagDefinitionOut(BaseModel):
    code: str
    title: str
    description: str
    count: int


class RedFlagSummaryOut(BaseModel):
    notices: int
    flagged_notices: int
    disclaimer: str
    signals: list[RedFlagDefinitionOut]


class ProcurementFlagsOut(BaseModel):
    procurement_id: str
    flags: list[RedFlagOut]
    disclaimer: str


class ProcurementOut(BaseModel):
    id: str
    title: str
    reference: str | None
    published_on: date | None
    buyer: EntityRefOut | None
    suppliers: list[EntityRefOut]
    order_type: str | None
    cpv_code: str | None
    procedure_result: str | None
    source_url: str | None
    is_demo: bool
    flags: list[str] = []


class ProcurementPageOut(BaseModel):
    items: list[ProcurementOut]
    total: int
    page: int
    page_size: int
    pages: int
    buyers_count: int
    suppliers_count: int
    latest_event_at: date | None


class BreakdownOut(BaseModel):
    key: str
    notices: int
    value_pln: Decimal | None
    single_bid_rate: float | None


class AnalyticsSummaryOut(BaseModel):
    notices: int
    awarded_notices: int
    total_value_pln: Decimal | None
    buyers: int
    suppliers: int
    notices_with_offer_count: int
    single_bid_notices: int
    single_bid_rate: float | None
    average_offers: float | None
    first_published_on: date | None
    last_published_on: date | None
    by_order_type: list[BreakdownOut]
    cities: list[str]


class RankedEntityOut(BaseModel):
    id: str
    label: str
    city: str
    rank: int
    notices: int
    value_pln: Decimal
    value_share: float | None
    single_bid_notices: int
    counterparts: int


class BuyerConcentrationOut(BaseModel):
    buyer_id: str
    buyer_label: str
    buyer_city: str
    awards: int
    suppliers: int
    value_pln: Decimal
    hhi: float
    top_supplier_id: str
    top_supplier_label: str
    top_supplier_share: float
    top_supplier_wins: int
    basis: str


class TrendPointOut(BaseModel):
    period: date
    notices: int
    value_pln: Decimal
    single_bid_rate: float | None
    cumulative_notices: int
    cumulative_value_pln: Decimal
