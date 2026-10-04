"""Fictional records used to make the product demo understandable."""

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import GraphEdge, GraphNode

NODES = [
    {
        "id": "authority-roads",
        "kind": "institution",
        "label": "Sample City Roads Authority",
        "subtitle": "Local government unit · DEMO",
        "city": "Warsaw · demo scenario",
        "details": {"nip": "DEMO-0001", "sector": "Infrastructure"},
    },
    {
        "id": "authority-digital",
        "kind": "institution",
        "label": "Municipal Services Centre (DEMO)",
        "subtitle": "Local government unit · DEMO",
        "city": "Warsaw · demo scenario",
        "details": {"nip": "DEMO-0002", "sector": "Digital services"},
    },
    {
        "id": "company-infra",
        "kind": "company",
        "label": "North Infrastructure Ltd (DEMO)",
        "subtitle": "Supplier · fictional entity",
        "city": "Warsaw · demo scenario",
        "details": {"nip": "DEMO-1001", "sector": "Road works"},
    },
    {
        "id": "company-maps",
        "kind": "company",
        "label": "Map Studio Ltd (DEMO)",
        "subtitle": "Supplier · fictional entity",
        "city": "Warsaw · demo scenario",
        "details": {"nip": "DEMO-1002", "sector": "Surveying and maps"},
    },
    {
        "id": "company-digital",
        "kind": "company",
        "label": "DigitLab Ltd (DEMO)",
        "subtitle": "Supplier · fictional entity",
        "city": "Warsaw · demo scenario",
        "details": {"nip": "DEMO-1003", "sector": "Software"},
    },
    {
        "id": "tender-roadworks",
        "kind": "procurement",
        "label": "Street modernisation — phase II",
        "subtitle": "Construction works · DEMO",
        "city": "Warsaw · demo scenario",
        "details": {
            "reference": "DEMO/2025/01",
            "published_on": "2025-02-12",
            "status": "Awarded",
            "amount_pln": 1_240_000,
            "offers": 3,
        },
    },
    {
        "id": "tender-maps",
        "kind": "procurement",
        "label": "Municipal infrastructure map update",
        "subtitle": "Surveying services · DEMO",
        "city": "Warsaw · demo scenario",
        "details": {
            "reference": "DEMO/2025/02",
            "published_on": "2025-05-08",
            "status": "Awarded",
            "amount_pln": 248_000,
            "offers": 1,
        },
    },
    {
        "id": "tender-digital",
        "kind": "procurement",
        "label": "Resident services portal — maintenance",
        "subtitle": "IT services · DEMO",
        "city": "Warsaw · demo scenario",
        "details": {
            "reference": "DEMO/2026/01",
            "published_on": "2026-03-17",
            "status": "Awarded",
            "amount_pln": 410_000,
            "offers": 2,
        },
    },
]

EDGES = [
    (
        "roads-published-roadworks",
        "authority-roads",
        "tender-roadworks",
        "published",
        "2025-02-12",
        None,
    ),
    (
        "roadworks-awarded-infra",
        "tender-roadworks",
        "company-infra",
        "selected supplier",
        "2025-04-02",
        1_240_000,
    ),
    ("roads-published-maps", "authority-roads", "tender-maps", "published", "2025-05-08", None),
    (
        "maps-awarded-maps",
        "tender-maps",
        "company-maps",
        "selected supplier",
        "2025-06-21",
        248_000,
    ),
    (
        "digital-published-portal",
        "authority-digital",
        "tender-digital",
        "published",
        "2026-03-17",
        None,
    ),
    (
        "portal-awarded-digital",
        "tender-digital",
        "company-digital",
        "selected supplier",
        "2026-05-30",
        410_000,
    ),
]

STORIES = [
    {
        "id": "roads-story",
        "eyebrow": "Demo story · fictional data",
        "title": "From a city street to a supplier",
        "summary": (
            "Follow the buyer through the notice and outcome to the supplier "
            "named in the procurement."
        ),
        "node_ids": ["authority-roads", "tender-roadworks", "company-infra"],
        "minutes": 2,
    },
    {
        "id": "one-offer-story",
        "eyebrow": "Pattern to inspect · fictional data",
        "title": "A procurement with one bid",
        "summary": "See how the app presents the bid count with context and a source.",
        "node_ids": ["authority-roads", "tender-maps", "company-maps"],
        "minutes": 2,
    },
    {
        "id": "it-story",
        "eyebrow": "Demo story · fictional data",
        "title": "A digital services procurement",
        "summary": "Open the IT procurement, check its value, and follow the selected supplier.",
        "node_ids": ["authority-digital", "tender-digital", "company-digital"],
        "minutes": 2,
    },
]


def seed_demo_data(session: Session) -> None:
    """Keep the bundled fictional scenario current without touching imported records."""
    existing_nodes = {
        node.id: node
        for node in session.scalars(select(GraphNode).where(GraphNode.is_demo.is_(True)))
    }
    for payload in NODES:
        node = existing_nodes.get(payload["id"])
        if node is None:
            session.add(GraphNode(**payload, is_demo=True))
        else:
            for field, value in payload.items():
                setattr(node, field, value)
    session.flush()
    existing_edges = {
        edge.id: edge
        for edge in session.scalars(select(GraphEdge).where(GraphEdge.is_demo.is_(True)))
    }
    for edge_id, source_id, target_id, relationship, occurred_at, amount in EDGES:
        payload = dict(
            source_id=source_id,
            target_id=target_id,
            relationship_type=relationship,
            evidence_label="Fictional demo record",
            evidence_url=None,
            occurred_at=date.fromisoformat(occurred_at),
            amount_pln=amount,
            is_demo=True,
        )
        edge = existing_edges.get(edge_id)
        if edge is None:
            session.add(GraphEdge(id=edge_id, **payload))
        else:
            for field, value in payload.items():
                setattr(edge, field, value)
    session.commit()
