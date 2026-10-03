from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.api import graph
from app.database import Base
from app.demo_data import seed_demo_data


def make_session() -> Session:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    session = Session(engine)
    seed_demo_data(session)
    return session


def test_graph_returns_connected_demo_records_and_notice():
    with make_session() as session:
        result = graph(
            q=None,
            kinds=None,
            since=None,
            until=None,
            max_tenders=6,
            dataset="demo",
            db=session,
        )

    assert len(result.nodes) == 8
    assert len(result.edges) == 6
    assert result.data_mode == "demo"
    assert "fikcyjne" in result.notice.casefold()


def test_search_limits_graph_to_matching_node_and_one_hop():
    with make_session() as session:
        result = graph(
            q="Mapowa",
            kinds=None,
            since=None,
            until=None,
            max_tenders=6,
            dataset="demo",
            db=session,
        )

    assert {node.kind for node in result.nodes} == {"institution", "procurement", "company"}
    assert len(result.edges) == 2


def test_date_window_removes_old_relationships():
    with make_session() as session:
        result = graph(
            q=None,
            kinds=None,
            since=date(2026, 1, 1),
            until=None,
            max_tenders=6,
            dataset="demo",
            db=session,
        )

    assert len(result.edges) == 2
    assert all(edge.occurred_at and edge.occurred_at >= date(2026, 1, 1) for edge in result.edges)
