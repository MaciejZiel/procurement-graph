"""Read-only endpoints for the graph and curated demo investigations."""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from . import analytics
from .catalog import list_procurements
from .database import get_db
from .demo_data import STORIES
from .models import GraphEdge, GraphNode
from .schemas import (
    AnalyticsSummaryOut,
    BuyerConcentrationOut,
    EdgeOut,
    GraphOut,
    HealthOut,
    NodeOut,
    ProcurementPageOut,
    RankedEntityOut,
    SearchOut,
    StoryOut,
    TrendPointOut,
)

router = APIRouter(prefix="/api")


def _display_text(value: str) -> str:
    """Translate our metadata while preserving names copied from source notices."""
    for original, translated in (
        ("Warszawa · dane BZP", "Warsaw · BZP data"),
        ("Warszawa · scenariusz demonstracyjny", "Warsaw · demo scenario"),
        ("Zamawiający · dane źródłowe", "Buyer · source data"),
        ("Postępowanie · dane BZP", "Procurement · BZP data"),
        ("Wykonawca wskazany w danych BZP", "Supplier named in BZP data"),
        ("Ogłoszenie o wyniku postępowania", "Procurement result notice"),
        ("Ogłoszenie BZP", "BZP notice"),
        ("Fikcyjny rekord demonstracyjny", "Fictional demo record"),
        ("wybrano wykonawcę", "selected supplier"),
        ("wskazano wykonawcę", "named supplier"),
        ("ogłosiła", "published"),
        ("Nie podano", "Not provided"),
        ("Warszawa", "Warsaw"),
        ("Udzielone", "Awarded"),
    ):
        value = value.replace(original, translated)
    return value


def _node_out(node: GraphNode) -> NodeOut:
    details = dict(node.details or {})
    for field in ("status", "sector"):
        if isinstance(details.get(field), str):
            details[field] = _display_text(details[field])
    return NodeOut(
        id=node.id,
        kind=node.kind,
        label=node.label,
        subtitle=_display_text(node.subtitle),
        city=_display_text(node.city),
        details=details,
        is_demo=node.is_demo,
    )


def _edge_out(edge: GraphEdge) -> EdgeOut:
    return EdgeOut(
        id=edge.id,
        source_id=edge.source_id,
        target_id=edge.target_id,
        relationship_type=_display_text(edge.relationship_type),
        evidence_label=_display_text(edge.evidence_label),
        evidence_url=edge.evidence_url,
        occurred_at=edge.occurred_at,
        amount_pln=edge.amount_pln,
        is_demo=edge.is_demo,
    )


@router.get("/health", response_model=HealthOut, tags=["system"])
def health(db: Session = Depends(get_db)) -> HealthOut:
    db.execute(text("SELECT 1"))
    return HealthOut(status="ok", database="connected")


@router.get("/graph", response_model=GraphOut, tags=["graph"])
def graph(
    q: str | None = Query(default=None, max_length=160),
    kinds: list[str] | None = Query(default=None),
    since: date | None = None,
    until: date | None = None,
    max_tenders: int = Query(default=6, ge=1, le=12),
    offset: int = Query(default=0, ge=0),
    dataset: str = Query(default="demo", pattern="^(demo|live)$"),
    focus: str | None = None,
    order_type: str | None = None,
    db: Session = Depends(get_db),
) -> GraphOut:
    is_demo = dataset == "demo"
    all_nodes = db.scalars(select(GraphNode).where(GraphNode.is_demo.is_(is_demo))).all()
    all_edges = db.scalars(select(GraphEdge).where(GraphEdge.is_demo.is_(is_demo))).all()
    node_by_id = {node.id: node for node in all_nodes}
    if focus and (focus not in node_by_id or node_by_id[focus].kind != "procurement"):
        raise HTTPException(status_code=404, detail="Procurement not found")

    if since or until:
        all_edges = [
            edge
            for edge in all_edges
            if edge.occurred_at is not None
            and (since is None or edge.occurred_at >= since)
            and (until is None or edge.occurred_at <= until)
        ]

    query = q.strip().casefold() if q else ""
    matching_ids = {
        node.id
        for node in all_nodes
        if query
        and query
        in " ".join((node.label, node.subtitle, node.city, node.kind, str(node.details))).casefold()
    }

    candidate_tenders = {
        node_id for node_id in matching_ids if node_by_id[node_id].kind == "procurement"
    }
    for edge in all_edges:
        if edge.source_id in matching_ids and node_by_id[edge.target_id].kind == "procurement":
            candidate_tenders.add(edge.target_id)
        if edge.target_id in matching_ids and node_by_id[edge.source_id].kind == "procurement":
            candidate_tenders.add(edge.source_id)
    if not query:
        candidate_tenders = {node.id for node in all_nodes if node.kind == "procurement"}
    if focus:
        candidate_tenders = {focus}
        matching_ids = set()

    def tender_in_period(node_id: str) -> bool:
        published = node_by_id[node_id].details.get("published_on")
        try:
            published_date = date.fromisoformat(str(published)[:10])
        except (TypeError, ValueError):
            return since is None and until is None
        return (since is None or published_date >= since) and (
            until is None or published_date <= until
        )

    candidate_tenders = {
        node_id
        for node_id in candidate_tenders
        if tender_in_period(node_id)
        and (not order_type or node_by_id[node_id].details.get("order_type") == order_type)
    }

    ordered_tenders = sorted(
        candidate_tenders,
        key=lambda node_id: (
            str(node_by_id[node_id].details.get("published_on") or ""),
            node_id,
        ),
        reverse=True,
    )
    selected_tenders = ordered_tenders[
        0 if focus else offset : (0 if focus else offset) + max_tenders
    ]
    visible_ids = set(selected_tenders)
    if query and not selected_tenders:
        visible_ids.update(sorted(matching_ids)[:12])
    for edge in all_edges:
        if edge.source_id in selected_tenders or edge.target_id in selected_tenders:
            visible_ids.update((edge.source_id, edge.target_id))
    nodes = [node for node in all_nodes if node.id in visible_ids]
    all_edges = [
        edge
        for edge in all_edges
        if edge.source_id in visible_ids and edge.target_id in visible_ids
    ]

    if kinds:
        allowed = set(kinds)
        nodes = [node for node in nodes if node.kind in allowed]
        allowed_ids = {node.id for node in nodes}
        all_edges = [
            edge
            for edge in all_edges
            if edge.source_id in allowed_ids and edge.target_id in allowed_ids
        ]

    return GraphOut(
        nodes=[_node_out(node) for node in nodes],
        edges=[_edge_out(edge) for edge in all_edges],
        total_tenders=len(ordered_tenders),
        offset=0 if focus else offset,
        limit=max_tenders,
        latest_event_at=max(
            (edge.occurred_at for edge in all_edges if edge.occurred_at is not None),
            default=None,
        ),
        data_mode=dataset,
        notice=(
            "Fictional demo data. These records do not describe real procurements or entities."
            if is_demo
            else "Source data. Verify each relationship in the linked notice."
        ),
    )


@router.get("/procurements", response_model=ProcurementPageOut, tags=["procurements"])
def procurements(
    q: str | None = Query(default=None, max_length=160),
    dataset: str = Query(default="live", pattern="^(demo|live)$"),
    since: date | None = None,
    until: date | None = None,
    order_type: str | None = Query(default=None, pattern="^(Delivery|Services|Works)$"),
    has_supplier: bool | None = None,
    sort: str = Query(default="newest", pattern="^(newest|oldest|title)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=12, ge=1, le=48),
    db: Session = Depends(get_db),
) -> ProcurementPageOut:
    return list_procurements(
        db,
        dataset=dataset,
        q=q,
        since=since,
        until=until,
        order_type=order_type,
        has_supplier=has_supplier,
        sort=sort,
        page=page,
        page_size=page_size,
    )


@router.get("/search", response_model=SearchOut, tags=["search"])
def search(
    q: str = Query(min_length=1, max_length=160),
    dataset: str = Query(default="demo", pattern="^(demo|live)$"),
    db: Session = Depends(get_db),
) -> SearchOut:
    needle = q.strip().casefold()
    nodes = db.scalars(
        select(GraphNode).where(GraphNode.is_demo.is_(dataset == "demo")).limit(500)
    ).all()
    results = [
        _node_out(node)
        for node in nodes
        if needle in f"{node.label} {node.subtitle} {node.city} {node.details}".casefold()
    ][:20]
    return SearchOut(results=results)


@router.get("/entities/{entity_id}", response_model=NodeOut, tags=["entities"])
def entity(entity_id: str, db: Session = Depends(get_db)) -> NodeOut:
    node = db.get(GraphNode, entity_id)
    if node is None:
        raise HTTPException(status_code=404, detail="Entity not found")
    return _node_out(node)


@router.get("/stories", response_model=list[StoryOut], tags=["stories"])
def stories() -> list[StoryOut]:
    return [StoryOut(**story) for story in STORIES]


@router.get("/stories/{story_id}", response_model=StoryOut, tags=["stories"])
def story(story_id: str) -> StoryOut:
    match = next((item for item in STORIES if item["id"] == story_id), None)
    if match is None:
        raise HTTPException(status_code=404, detail="Demo path not found")
    return StoryOut(**match)


def analytics_scope(
    dataset: str = Query(default="live", pattern="^(demo|live)$"),
    city: str | None = Query(default=None, max_length=120),
    since: date | None = None,
    until: date | None = None,
) -> analytics.Scope:
    return analytics.Scope(dataset=dataset, city=city or None, since=since, until=until)


@router.get("/analytics/summary", response_model=AnalyticsSummaryOut, tags=["analytics"])
def analytics_summary(
    scope: analytics.Scope = Depends(analytics_scope), db: Session = Depends(get_db)
) -> AnalyticsSummaryOut:
    return analytics.summary(db, scope)


@router.get("/analytics/top-buyers", response_model=list[RankedEntityOut], tags=["analytics"])
def analytics_top_buyers(
    by: str = Query(default="value", pattern="^(value|count)$"),
    limit: int = Query(default=10, ge=1, le=50),
    scope: analytics.Scope = Depends(analytics_scope),
    db: Session = Depends(get_db),
) -> list[RankedEntityOut]:
    return analytics.top_buyers(db, scope, by=by, limit=limit)


@router.get("/analytics/top-suppliers", response_model=list[RankedEntityOut], tags=["analytics"])
def analytics_top_suppliers(
    by: str = Query(default="value", pattern="^(value|count)$"),
    limit: int = Query(default=10, ge=1, le=50),
    scope: analytics.Scope = Depends(analytics_scope),
    db: Session = Depends(get_db),
) -> list[RankedEntityOut]:
    return analytics.top_suppliers(db, scope, by=by, limit=limit)


@router.get(
    "/analytics/concentration", response_model=list[BuyerConcentrationOut], tags=["analytics"]
)
def analytics_concentration(
    basis: str = Query(default="value", pattern="^(value|count)$"),
    min_awards: int = Query(default=3, ge=1, le=100),
    limit: int = Query(default=10, ge=1, le=50),
    scope: analytics.Scope = Depends(analytics_scope),
    db: Session = Depends(get_db),
) -> list[BuyerConcentrationOut]:
    return analytics.concentration(db, scope, basis=basis, min_awards=min_awards, limit=limit)


@router.get("/analytics/trends", response_model=list[TrendPointOut], tags=["analytics"])
def analytics_trends(
    granularity: str = Query(default="week", pattern="^(week|month)$"),
    scope: analytics.Scope = Depends(analytics_scope),
    db: Session = Depends(get_db),
) -> list[TrendPointOut]:
    return analytics.trends(db, scope, granularity=granularity)
