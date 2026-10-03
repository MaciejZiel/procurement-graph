"""Build a searchable, paginated procurement catalog from evidence-backed graph records."""

import math
import unicodedata
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import GraphEdge, GraphNode
from .schemas import EntityRefOut, ProcurementOut, ProcurementPageOut


def _date(value: object) -> date | None:
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def _search_text(value: object) -> str:
    normalized = unicodedata.normalize("NFKD", str(value).casefold().replace("ł", "l"))
    return "".join(char for char in normalized if not unicodedata.combining(char))


def _entity(node: GraphNode) -> EntityRefOut:
    return EntityRefOut(id=node.id, label=node.label, city=node.city)


def list_procurements(
    db: Session,
    *,
    dataset: str,
    q: str | None,
    since: date | None,
    until: date | None,
    order_type: str | None,
    has_supplier: bool | None,
    sort: str,
    page: int,
    page_size: int,
) -> ProcurementPageOut:
    is_demo = dataset == "demo"
    nodes = db.scalars(select(GraphNode).where(GraphNode.is_demo.is_(is_demo))).all()
    edges = db.scalars(select(GraphEdge).where(GraphEdge.is_demo.is_(is_demo))).all()
    by_id = {node.id: node for node in nodes}
    incoming: dict[str, list[GraphEdge]] = {}
    outgoing: dict[str, list[GraphEdge]] = {}
    for edge in edges:
        incoming.setdefault(edge.target_id, []).append(edge)
        outgoing.setdefault(edge.source_id, []).append(edge)

    needle = _search_text(q.strip()) if q else ""
    rows: list[ProcurementOut] = []
    for node in nodes:
        if node.kind != "procurement":
            continue
        details = node.details or {}
        published = _date(details.get("published_on"))
        if since and (published is None or published < since):
            continue
        if until and (published is None or published > until):
            continue
        if order_type and details.get("order_type") != order_type:
            continue
        buyer_node = next(
            (
                by_id[edge.source_id]
                for edge in incoming.get(node.id, [])
                if edge.source_id in by_id and by_id[edge.source_id].kind == "institution"
            ),
            None,
        )
        supplier_nodes = [
            by_id[edge.target_id]
            for edge in outgoing.get(node.id, [])
            if edge.target_id in by_id and by_id[edge.target_id].kind == "company"
        ]
        if has_supplier is not None and bool(supplier_nodes) != has_supplier:
            continue
        if needle:
            searchable = " ".join(
                [
                    node.label,
                    str(details.get("reference") or ""),
                    str(details.get("cpv_code") or ""),
                    buyer_node.label if buyer_node else "",
                    *(supplier.label for supplier in supplier_nodes),
                ]
            )
            if needle not in _search_text(searchable):
                continue
        source_url = details.get("source_url") or next(
            (edge.evidence_url for edge in incoming.get(node.id, []) if edge.evidence_url),
            None,
        )
        rows.append(
            ProcurementOut(
                id=node.id,
                title=node.label,
                reference=str(details["reference"]) if details.get("reference") else None,
                published_on=published,
                buyer=_entity(buyer_node) if buyer_node else None,
                suppliers=[_entity(supplier) for supplier in supplier_nodes],
                order_type=str(details["order_type"]) if details.get("order_type") else None,
                cpv_code=str(details["cpv_code"]) if details.get("cpv_code") else None,
                procedure_result=str(details["procedure_result"])
                if details.get("procedure_result")
                else None,
                source_url=str(source_url) if source_url else None,
                is_demo=is_demo,
            )
        )

    if sort == "title":
        rows.sort(key=lambda row: _search_text(row.title))
    else:
        rows.sort(
            key=lambda row: (row.published_on or date.min, row.id),
            reverse=sort == "newest",
        )
    total = len(rows)
    first = (page - 1) * page_size
    return ProcurementPageOut(
        items=rows[first : first + page_size],
        total=total,
        page=page,
        page_size=page_size,
        pages=math.ceil(total / page_size),
        buyers_count=len({row.buyer.id for row in rows if row.buyer}),
        suppliers_count=len({supplier.id for row in rows for supplier in row.suppliers}),
        latest_event_at=max((row.published_on for row in rows if row.published_on), default=None),
    )
