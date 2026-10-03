from datetime import date

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.database import Base
from app.demo_data import seed_demo_data
from app.import_bzp import extract_rows, normalise_notice, save_notices
from app.models import GraphEdge, GraphNode


@pytest.fixture
def session():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as database:
        yield database
    engine.dispose()


def notice(number: str, title: str) -> dict:
    return {
        "noticeNumber": number,
        "contractingAuthorityName": "Przykładowy Zarząd",
        "contractingAuthorityCity": "Warszawa",
        "contractingAuthorityNip": "5250000000",
        "title": title,
        "publicationDate": "2025-05-12T10:30:00Z",
        "winnerName": "Dostawca Przykład sp. z o.o.",
        "winnerNip": "1112223344",
        "awardValue": "124 500,50",
        "noticeUrl": f"https://example.test/notices/{number}",
    }


def test_extract_rows_accepts_common_pagination_envelope():
    rows = extract_rows({"data": {"content": [notice("1", "Umowa")]}})
    assert len(rows) == 1
    assert rows[0]["noticeNumber"] == "1"


def test_extract_rows_fails_closed_for_unknown_response():
    with pytest.raises(ValueError, match="Nie rozpoznaję struktury"):
        extract_rows({"message": "unexpected"})


def test_normalise_notice_keeps_only_city_with_source_evidence():
    accepted = normalise_notice(notice("2025/01", "Utrzymanie systemu"))
    rejected_city = normalise_notice(
        {**notice("2025/02", "Droga"), "contractingAuthorityCity": "Gdańsk"}
    )
    rejected_source = normalise_notice(
        {key: value for key, value in notice("2025/03", "Mapa").items() if key != "noticeUrl"}
    )

    assert accepted is not None
    assert accepted["published"] == date(2025, 5, 12)
    assert accepted["amount"] == 124500.50
    assert rejected_city is None
    assert rejected_source is None


def test_save_is_idempotent_and_reuses_entities(session):
    count = save_notices(session, [notice("1", "Zamówienie A"), notice("2", "Zamówienie B")])
    count_again = save_notices(session, [notice("1", "Zamówienie A"), notice("2", "Zamówienie B")])

    suppliers = session.scalars(select(GraphNode).where(GraphNode.kind == "company")).all()
    awards = session.scalars(
        select(GraphEdge).where(GraphEdge.relationship_type == "wybrano wykonawcę")
    ).all()
    assert count == count_again == 2
    assert len(suppliers) == 1
    assert len(awards) == 2


def test_demo_seed_is_idempotent_and_explicitly_marked(session):
    seed_demo_data(session)
    seed_demo_data(session)

    nodes = session.scalars(select(GraphNode)).all()
    edges = session.scalars(select(GraphEdge)).all()
    assert len(nodes) == 8
    assert len(edges) == 6
    assert all(node.is_demo for node in nodes)
    assert all(edge.is_demo for edge in edges)
