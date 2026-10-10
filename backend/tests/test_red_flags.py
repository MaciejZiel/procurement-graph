import json
import os
from datetime import date, timedelta

import httpx
import pytest
from bzp_fixtures import result_notice
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app import red_flags
from app.api import router
from app.catalog import list_procurements
from app.database import Base, get_db
from app.import_bzp import resolve_procedure_starts, save_notices

BUYER_A = ("Urząd Testowy A", "1111111111")
BUYER_B = ("Szpital Testowy B", "4444444444")
REPEATED = ("Firma Powtarzalna", "2222222222")
SIGNED = date(2026, 9, 1)


def notice(number, buyer, supplier, *, offers=3, days=None, **options):
    """One awarded notice; ``days`` sets the time from contract notice to signing."""
    preceding = f"2026/BZP {900000 + number:08d}" if days is not None else None
    row = result_notice(
        number,
        buyer=buyer[0],
        buyer_tax_id=buyer[1],
        suppliers=[supplier],
        parts=[
            {
                "offers": offers,
                "value": "1000,00",
                "tax_ids": [supplier[1]],
                "signed": SIGNED.isoformat(),
            }
        ],
        preceding=preceding,
        **options,
    )
    return row, (preceding, (SIGNED - timedelta(days=days)).isoformat() if days else None)


def fixture_rows():
    built = [
        # Buyer A: the same supplier wins three times; one award had a single offer.
        notice(1, BUYER_A, REPEATED, offers=1, days=40),
        notice(2, BUYER_A, REPEATED, days=41),
        notice(3, BUYER_A, REPEATED, days=42),
        notice(4, BUYER_A, ("Inna Firma", "3333333333"), days=43),
        # Single-source award: no contract notice, no offer count.
        notice(
            5,
            BUYER_B,
            ("Dostawca Jedyny", "5555555555"),
            offers=None,
            mode="Zamówienie udzielane jest w trybie zamówienia z wolnej ręki",
        ),
        # Buyer B: twenty ordinary procedures and one that took five days.
        notice(6, BUYER_B, ("Szybka Firma", "6666666666"), days=5),
    ]
    built += [
        notice(10 + index, BUYER_B, (f"Firma {index}", f"77777777{index:02d}"), days=30 + index)
        for index in range(16)
    ]
    rows = [row for row, _ in built]
    start_dates = {number: started for _, (number, started) in built if number}
    return rows, start_dates


def mock_bzp(start_dates):
    """Answer contract-notice lookups like the BZP endpoint does."""

    def handler(request: httpx.Request) -> httpx.Response:
        number = request.url.params["NoticeNumber"].removesuffix("/01")
        started = start_dates.get(number)
        body = [{"noticeNumber": f"{number}/01", "publicationDate": f"{started}T09:00:00Z"}]
        return httpx.Response(200, json=body if started else [])

    return httpx.Client(transport=httpx.MockTransport(handler))


@pytest.fixture
def session():
    url = os.getenv("TEST_DATABASE_URL")
    if url:
        engine = create_engine(url)
        Base.metadata.drop_all(engine)
    else:
        engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
    Base.metadata.create_all(engine)
    rows, start_dates = fixture_rows()
    with mock_bzp(start_dates) as client:
        cache = resolve_procedure_starts(rows, client, delay=0)
    assert cache["2026/BZP 00900006"] == "2026-08-27"
    with Session(engine) as database:
        assert save_notices(database, rows) == len(rows)
        yield database
    Base.metadata.drop_all(engine)
    engine.dispose()


def test_procedure_start_dates_are_resolved_once_per_number():
    rows, start_dates = fixture_rows()
    calls = []

    def handler(request):
        calls.append(request.url.params["NoticeNumber"])
        return httpx.Response(200, json=[])

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        cache = resolve_procedure_starts(rows + rows[:2], client, delay=0)
    assert len(calls) == len(start_dates)
    assert all(value is None for value in cache.values())
    assert all(number.endswith("/01") for number in calls)


def test_each_signal_marks_the_expected_notices(session):
    flags = red_flags.flags_by_procurement(session, red_flags.FlagScope())
    by_code = {}
    for procurement_id, items in flags.items():
        for item in items:
            by_code.setdefault(item.code, {})[procurement_id] = item.params

    assert set(by_code["single_bid"]) == {"bzp-2026-BZP-00000001-01"}
    assert set(by_code["repeat_supplier"]) == {
        "bzp-2026-BZP-00000001-01",
        "bzp-2026-BZP-00000002-01",
        "bzp-2026-BZP-00000003-01",
    }
    repeat = by_code["repeat_supplier"]["bzp-2026-BZP-00000002-01"]
    assert (repeat["supplier"], repeat["wins"], repeat["buyer_awards"]) == (
        "Firma Powtarzalna",
        3,
        4,
    )
    assert set(by_code["non_competitive"]) == {"bzp-2026-BZP-00000005-01"}
    assert by_code["short_procedure"] == {
        "bzp-2026-BZP-00000006-01": {
            "days": 5,
            "median_days": 39,
            "order_type": "Services",
            "percentile": 0.0,
            "sample": 21,
        }
    }


def test_short_procedure_needs_a_large_enough_sample(session, monkeypatch):
    monkeypatch.setattr(red_flags, "SHORT_PROCEDURE_MIN_SAMPLE", 22)
    flags = red_flags.flags_by_procurement(session, red_flags.FlagScope(), ["short_procedure"])
    assert flags == {}


def test_registry_filter_and_summary(session):
    def page(flag):
        return list_procurements(
            session,
            dataset="live",
            q=None,
            since=None,
            until=None,
            order_type=None,
            has_supplier=None,
            sort="newest",
            page=1,
            page_size=48,
            flag=flag,
        )

    assert page(None).total == 22
    assert page("any").total == 5
    assert [item.id for item in page("single_bid").items] == ["bzp-2026-BZP-00000001-01"]
    assert page("single_bid").items[0].flags == ["repeat_supplier", "single_bid"]

    summary = red_flags.summary(session, red_flags.FlagScope())
    assert summary.flagged_notices == 5
    assert {signal.code: signal.count for signal in summary.signals} == {
        "single_bid": 1,
        "repeat_supplier": 3,
        "short_procedure": 1,
        "non_competitive": 1,
    }
    assert "not accusations" in summary.disclaimer


def test_flag_endpoints(session):
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_db] = lambda: session
    client = TestClient(app)

    response = client.get("/api/procurements/bzp-2026-BZP-00000006-01/flags")
    assert response.status_code == 200
    body = response.json()
    assert [flag["code"] for flag in body["flags"]] == ["short_procedure"]
    assert json.dumps(body["flags"][0]["params"])
    assert client.get("/api/procurements/missing/flags").status_code == 404
    assert client.get("/api/procurements", params={"flag": "bogus"}).status_code == 422
    assert client.get("/api/red-flags").json()["flagged_notices"] == 5
