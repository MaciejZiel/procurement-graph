"""Read-only endpoints for the graph and curated demo investigations."""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from .database import get_db
from .demo_data import STORIES
from .models import GraphEdge, GraphNode
from .schemas import EdgeOut, GraphOut, HealthOut, NodeOut, SearchOut, StoryOut

router = APIRouter(prefix="/api")


def _node_out(node: GraphNode) -> NodeOut:
    return NodeOut(
        id=node.id,
        kind=node.kind,
        label=node.label,
        subtitle=node.subtitle,
        city=node.city,
        details=node.details,
        is_demo=node.is_demo,
    )


def _edge_out(edge: GraphEdge) -> EdgeOut:
    return EdgeOut(
        id=edge.id,
        source_id=edge.source_id,
        target_id=edge.target_id,
        relationship_type=edge.relationship_type,
        evidence_label=edge.evidence_label,
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
    dataset: str = Query(default="demo", pattern="^(demo|live)$"),
    db: Session = Depends(get_db),
) -> GraphOut:
    is_demo = dataset == "demo"
    nodes = db.scalars(select(GraphNode).where(GraphNode.is_demo.is_(is_demo))).all()
    all_edges = db.scalars(select(GraphEdge).where(GraphEdge.is_demo.is_(is_demo))).all()
    node_by_id = {node.id: node for node in nodes}

    query = q.strip().casefold() if q else ""
    matching_ids = {
        node.id
        for node in nodes
        if query
        and query
        in " ".join((node.label, node.subtitle, node.city, node.kind, str(node.details))).casefold()
    }
    if query:
        related_ids = set(matching_ids)
        for edge in all_edges:
            if edge.source_id in matching_ids or edge.target_id in matching_ids:
                related_ids.update((edge.source_id, edge.target_id))
        nodes = [node for node in nodes if node.id in related_ids]
        all_edges = [edge for edge in all_edges if edge.source_id in related_ids and edge.target_id in related_ids]

    if kinds:
        allowed = set(kinds)
        nodes = [node for node in nodes if node.kind in allowed]
        allowed_ids = {node.id for node in nodes}
        all_edges = [edge for edge in all_edges if edge.source_id in allowed_ids and edge.target_id in allowed_ids]

    if since or until:
        all_edges = [
            edge
            for edge in all_edges
            if edge.occurred_at is not None
            and (since is None or edge.occurred_at >= since)
            and (until is None or edge.occurred_at <= until)
        ]
        connected_ids = {edge.source_id for edge in all_edges} | {edge.target_id for edge in all_edges}
        nodes = [node for node in nodes if node.id in connected_ids]

    edges = [edge for edge in all_edges if edge.source_id in node_by_id and edge.target_id in node_by_id]
    return GraphOut(
        nodes=[_node_out(node) for node in nodes],
        edges=[_edge_out(edge) for edge in edges],
        data_mode=dataset,
        notice=(
            "Fikcyjne dane demonstracyjne. Nie opisują rzeczywistych zamówień ani podmiotów."
            if is_demo
            else "Dane źródłowe. Każda relacja wymaga weryfikacji w podanym dokumencie."
        ),
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
        raise HTTPException(status_code=404, detail="Nie znaleziono podmiotu")
    return _node_out(node)


@router.get("/stories", response_model=list[StoryOut], tags=["stories"])
def stories() -> list[StoryOut]:
    return [StoryOut(**story) for story in STORIES]


@router.get("/stories/{story_id}", response_model=StoryOut, tags=["stories"])
def story(story_id: str) -> StoryOut:
    match = next((item for item in STORIES if item["id"] == story_id), None)
    if match is None:
        raise HTTPException(status_code=404, detail="Nie znaleziono ścieżki demonstracyjnej")
    return StoryOut(**match)
