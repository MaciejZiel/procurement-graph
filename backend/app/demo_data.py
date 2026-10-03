"""Fictional records used to make the product demo understandable."""

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import GraphEdge, GraphNode


NODES = [
    {
        "id": "authority-roads",
        "kind": "institution",
        "label": "Zarząd Dróg Przykładowego Miasta",
        "subtitle": "Jednostka samorządowa · DEMO",
        "city": "Warszawa · scenariusz demonstracyjny",
        "details": {"nip": "DEMO-0001", "sector": "Infrastruktura"},
    },
    {
        "id": "authority-digital",
        "kind": "institution",
        "label": "Centrum Usług Miejskich (DEMO)",
        "subtitle": "Jednostka samorządowa · DEMO",
        "city": "Warszawa · scenariusz demonstracyjny",
        "details": {"nip": "DEMO-0002", "sector": "Usługi cyfrowe"},
    },
    {
        "id": "company-infra",
        "kind": "company",
        "label": "Infrastruktura Północ sp. z o.o. (DEMO)",
        "subtitle": "Wykonawca · podmiot fikcyjny",
        "city": "Warszawa · scenariusz demonstracyjny",
        "details": {"nip": "DEMO-1001", "sector": "Roboty drogowe"},
    },
    {
        "id": "company-maps",
        "kind": "company",
        "label": "Pracownia Mapowa Demo sp. z o.o.",
        "subtitle": "Wykonawca · podmiot fikcyjny",
        "city": "Warszawa · scenariusz demonstracyjny",
        "details": {"nip": "DEMO-1002", "sector": "Geodezja i mapy"},
    },
    {
        "id": "company-digital",
        "kind": "company",
        "label": "DigitLab Demo sp. z o.o.",
        "subtitle": "Wykonawca · podmiot fikcyjny",
        "city": "Warszawa · scenariusz demonstracyjny",
        "details": {"nip": "DEMO-1003", "sector": "Oprogramowanie"},
    },
    {
        "id": "tender-roadworks",
        "kind": "procurement",
        "label": "Modernizacja ulic — etap II",
        "subtitle": "Roboty budowlane · DEMO",
        "city": "Warszawa · scenariusz demonstracyjny",
        "details": {
            "reference": "DEMO/2025/01",
            "published_on": "2025-02-12",
            "status": "Udzielone",
            "amount_pln": 1_240_000,
            "offers": 3,
        },
    },
    {
        "id": "tender-maps",
        "kind": "procurement",
        "label": "Aktualizacja map infrastruktury miejskiej",
        "subtitle": "Usługi geodezyjne · DEMO",
        "city": "Warszawa · scenariusz demonstracyjny",
        "details": {
            "reference": "DEMO/2025/02",
            "published_on": "2025-05-08",
            "status": "Udzielone",
            "amount_pln": 248_000,
            "offers": 1,
        },
    },
    {
        "id": "tender-digital",
        "kind": "procurement",
        "label": "Portal obsługi mieszkańców — utrzymanie",
        "subtitle": "Usługi IT · DEMO",
        "city": "Warszawa · scenariusz demonstracyjny",
        "details": {
            "reference": "DEMO/2026/01",
            "published_on": "2026-03-17",
            "status": "Udzielone",
            "amount_pln": 410_000,
            "offers": 2,
        },
    },
]

EDGES = [
    ("roads-published-roadworks", "authority-roads", "tender-roadworks", "ogłosiła", "2025-02-12", None),
    ("roadworks-awarded-infra", "tender-roadworks", "company-infra", "wybrano wykonawcę", "2025-04-02", 1_240_000),
    ("roads-published-maps", "authority-roads", "tender-maps", "ogłosiła", "2025-05-08", None),
    ("maps-awarded-maps", "tender-maps", "company-maps", "wybrano wykonawcę", "2025-06-21", 248_000),
    ("digital-published-portal", "authority-digital", "tender-digital", "ogłosiła", "2026-03-17", None),
    ("portal-awarded-digital", "tender-digital", "company-digital", "wybrano wykonawcę", "2026-05-30", 410_000),
]

STORIES = [
    {
        "id": "roads-story",
        "eyebrow": "Historia demonstracyjna · fikcyjne dane",
        "title": "Od miejskiej ulicy do wykonawcy",
        "summary": "Przejdź od instytucji przez ogłoszenie i wynik do firmy wybranej w postępowaniu.",
        "node_ids": ["authority-roads", "tender-roadworks", "company-infra"],
        "minutes": 2,
    },
    {
        "id": "one-offer-story",
        "eyebrow": "Sygnał do sprawdzenia · fikcyjne dane",
        "title": "Postępowanie z jedną ofertą",
        "summary": "Zobacz, jak aplikacja pokazuje liczbę ofert wraz z kontekstem i źródłem.",
        "node_ids": ["authority-roads", "tender-maps", "company-maps"],
        "minutes": 2,
    },
    {
        "id": "it-story",
        "eyebrow": "Historia demonstracyjna · fikcyjne dane",
        "title": "Zamówienie na usługi cyfrowe",
        "summary": "Otwórz postępowanie IT, sprawdź jego wartość i przejdź do wybranego wykonawcy.",
        "node_ids": ["authority-digital", "tender-digital", "company-digital"],
        "minutes": 2,
    },
]


def seed_demo_data(session: Session) -> None:
    """Insert fictional demo content once, leaving imported records untouched."""
    if session.scalar(select(GraphNode.id).limit(1)):
        return

    session.add_all([GraphNode(**node, is_demo=True) for node in NODES])
    session.flush()
    session.add_all(
        [
            GraphEdge(
                id=edge_id,
                source_id=source_id,
                target_id=target_id,
                relationship_type=relationship,
                evidence_label="Fikcyjny rekord demonstracyjny",
                evidence_url=None,
                occurred_at=date.fromisoformat(occurred_at),
                amount_pln=amount,
                is_demo=True,
            )
            for edge_id, source_id, target_id, relationship, occurred_at, amount in EDGES
        ]
    )
    session.commit()
