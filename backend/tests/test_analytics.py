import os
from datetime import date
from decimal import Decimal

import pytest
from bzp_fixtures import result_notice
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app import analytics
from app.api import router
from app.database import Base, get_db
from app.import_bzp import save_notices

BUYER_A = ("Urząd Testowy A", "1111111111")
BUYER_B = ("Szpital Testowy B", "4444444444")
X = ("Firma X sp. z o.o.", "2222222222")
Y = ("Firma Y S.A.", "3333333333")
Z = ("Firma Z", "5555555555")


def fixture_notices() -> list[dict]:
    def notice(number, buyer, suppliers, parts, **options):
        return result_notice(
            number,
            buyer=buyer[0],
            buyer_tax_id=buyer[1],
            suppliers=suppliers,
            parts=parts,
            **options,
        )

    return [
        notice(
            1,
            BUYER_A,
            [X],
            [{"offers": 1, "value": "100000,00", "tax_ids": [X[1]]}],
            published="2026-09-07",
        ),
        notice(
            2,
            BUYER_A,
            [X],
            [{"offers": 3, "value": "50000,00", "tax_ids": [X[1]]}],
            published="2026-09-08",
        ),
        notice(
            3,
            BUYER_A,
            [Y],
            [{"offers": 2, "value": "50000,00", "tax_ids": [Y[1]]}],
            published="2026-09-15",
        ),
        notice(
            4,
            BUYER_B,
            [Y, Z],
            [
                {"offers": 4, "value": "30000,00", "tax_ids": [Y[1]]},
                {"offers": 1, "value": "10000,00", "tax_ids": [Z[1]]},
            ],
            published="2026-09-16",
            order_type="Works",
        ),
        notice(5, BUYER_B, [], [{"cancelled": True}], published="2026-09-16"),
        notice(
            6,
            BUYER_B,
            [Z],
            [{"offers": None, "value": "20000,00", "tax_ids": [Z[1]]}],
            published="2026-09-21",
            mode="Zamówienie udzielane jest w trybie zamówienia z wolnej ręki",
            preceding=None,
        ),
        notice(
            7,
            BUYER_A,
            [X],
            [{"offers": 1, "value": "999,00", "tax_ids": [X[1]]}],
            published="2026-09-07",
            city="Kraków",
        ),
    ]


def make_engine():
    """SQLite in memory by default; set TEST_DATABASE_URL to run the same SQL on PostgreSQL."""
    url = os.getenv("TEST_DATABASE_URL")
    if url:
        engine = create_engine(url)
        Base.metadata.drop_all(engine)
        return engine
    return create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )


@pytest.fixture
def session():
    engine = make_engine()
    Base.metadata.create_all(engine)
    with Session(engine) as database:
        rows = fixture_notices()
        assert save_notices(database, rows[:6], city_filter="Warszawa") == 6
        assert save_notices(database, rows[6:], city_filter="Kraków") == 1
        yield database
    Base.metadata.drop_all(engine)
    engine.dispose()


WARSAW = analytics.Scope(city="Warszawa")


def test_summary_counts_values_and_single_bid_rate(session):
    result = analytics.summary(session, WARSAW)
    assert result.notices == 6
    assert result.awarded_notices == 5
    assert result.total_value_pln == Decimal("260000.00")
    assert (result.buyers, result.suppliers) == (2, 3)
    assert result.notices_with_offer_count == 4
    assert result.single_bid_notices == 2
    assert result.single_bid_rate == 0.5
    assert result.average_offers == 1.75
    assert result.first_published_on == date(2026, 9, 7)
    assert {row.key: row.notices for row in result.by_order_type} == {"Services": 5, "Works": 1}
    assert result.cities == ["Warszawa", "Kraków"]


def test_city_and_date_filters_narrow_the_scope(session):
    assert analytics.summary(session, analytics.Scope()).notices == 7
    assert analytics.summary(session, analytics.Scope(city="Kraków")).notices == 1
    assert analytics.summary(session, analytics.Scope(since=date(2026, 9, 15))).notices == 4


def test_top_buyers_and_suppliers_are_ranked_by_value_and_count(session):
    buyers = analytics.top_buyers(session, WARSAW, by="value", limit=10)
    assert [(row.label, row.value_pln, row.notices) for row in buyers] == [
        ("Urząd Testowy A", Decimal("200000.00"), 3),
        ("Szpital Testowy B", Decimal("60000.00"), 3),
    ]
    assert buyers[0].value_share == pytest.approx(0.7692, abs=1e-4)
    assert buyers[0].counterparts == 2

    suppliers = analytics.top_suppliers(session, WARSAW, by="value", limit=10)
    assert [(row.label, row.value_pln, row.notices) for row in suppliers] == [
        ("Firma X sp. z o.o.", Decimal("150000.00"), 2),
        ("Firma Y S.A.", Decimal("80000.00"), 2),
        ("Firma Z", Decimal("30000.00"), 2),
    ]
    by_count = analytics.top_suppliers(session, WARSAW, by="count", limit=1)
    assert by_count[0].rank == 1 and by_count[0].notices == 2


def test_concentration_hhi_and_top_supplier_share(session):
    by_value = analytics.concentration(session, WARSAW, basis="value", min_awards=1, limit=10)
    assert [(row.buyer_label, row.hhi, row.top_supplier_label) for row in by_value] == [
        ("Urząd Testowy A", 6250.0, "Firma X sp. z o.o."),
        ("Szpital Testowy B", 5000.0, "Firma Z"),
    ]
    assert by_value[0].top_supplier_share == 0.75
    assert by_value[0].top_supplier_wins == 2

    by_count = analytics.concentration(session, WARSAW, basis="count", min_awards=1, limit=10)
    assert by_count[0].hhi == pytest.approx(5555.6, abs=0.1)
    assert analytics.concentration(session, WARSAW, basis="value", min_awards=4, limit=10) == []


def test_weekly_trends_with_running_totals(session):
    points = analytics.trends(session, WARSAW, granularity="week")
    assert [
        (p.period, p.notices, p.value_pln, p.single_bid_rate, p.cumulative_value_pln)
        for p in points
    ] == [
        (date(2026, 9, 7), 2, Decimal("150000.00"), 0.5, Decimal("150000.00")),
        (date(2026, 9, 14), 3, Decimal("90000.00"), 0.5, Decimal("240000.00")),
        (date(2026, 9, 21), 1, Decimal("20000.00"), None, Decimal("260000.00")),
    ]
    assert [p.cumulative_notices for p in points] == [2, 5, 6]
    monthly = analytics.trends(session, WARSAW, granularity="month")
    assert [(p.period, p.notices) for p in monthly] == [(date(2026, 9, 1), 6)]


def test_analytics_endpoints_validate_parameters_and_return_typed_json(session):
    from fastapi import FastAPI

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_db] = lambda: session
    client = TestClient(app)

    summary = client.get("/api/analytics/summary", params={"city": "Warszawa"})
    assert summary.status_code == 200
    assert summary.json()["single_bid_rate"] == 0.5

    top = client.get("/api/analytics/top-suppliers", params={"by": "count", "limit": 2})
    assert top.status_code == 200 and len(top.json()) == 2

    concentration = client.get(
        "/api/analytics/concentration", params={"min_awards": 1, "city": "Warszawa"}
    )
    assert concentration.json()[0]["hhi"] == 6250.0

    trends = client.get("/api/analytics/trends", params={"granularity": "month"})
    assert trends.json()[0]["period"] == "2026-09-01"

    assert client.get("/api/analytics/top-buyers", params={"by": "bogus"}).status_code == 422
    assert client.get("/api/analytics/trends", params={"granularity": "day"}).status_code == 422
