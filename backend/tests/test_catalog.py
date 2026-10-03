from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.api import graph
from app.catalog import list_procurements
from app.database import Base
from app.demo_data import seed_demo_data
from app.sample_data import seed_bzp_sample


def test_sample_catalog_supports_pages_filters_and_focused_graph():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        seed_demo_data(session)
        assert seed_bzp_sample(session) == 1214
        assert seed_bzp_sample(session) == 0
        page = list_procurements(
            session,
            dataset="live",
            q=None,
            since=None,
            until=None,
            order_type=None,
            has_supplier=None,
            sort="newest",
            page=1,
            page_size=12,
        )
        assert page.total == 1214
        assert page.pages == 102
        assert len(page.items) == 12
        assert page.buyers_count > 0
        assert page.suppliers_count > 0
        assert all(item.source_url for item in page.items)

        second_page = list_procurements(
            session,
            dataset="live",
            q=None,
            since=None,
            until=None,
            order_type=None,
            has_supplier=None,
            sort="newest",
            page=2,
            page_size=12,
        )
        assert len(second_page.items) == 12
        assert set(item.id for item in page.items).isdisjoint(item.id for item in second_page.items)

        buyer_results = list_procurements(
            session,
            dataset="live",
            q="generalna dyrekcja",
            since=None,
            until=None,
            order_type="Works",
            has_supplier=True,
            sort="oldest",
            page=1,
            page_size=12,
        )
        assert buyer_results.total > 0
        assert all(item.order_type == "Works" for item in buyer_results.items)

        selected = buyer_results.items[0]
        focused = graph(
            q=None,
            kinds=None,
            since=None,
            until=None,
            max_tenders=6,
            offset=0,
            dataset="live",
            focus=selected.id,
            order_type=None,
            db=session,
        )
        assert {node.id for node in focused.nodes if node.kind == "procurement"} == {selected.id}
        assert len(focused.edges) >= 2

        searched = graph(
            q="Warszawa",
            kinds=None,
            since=None,
            until=None,
            max_tenders=6,
            offset=0,
            dataset="live",
            focus=None,
            order_type=None,
            db=session,
        )
        procurement_ids = {node.id for node in searched.nodes if node.kind == "procurement"}
        assert len(procurement_ids) <= 6
        assert all(
            node.kind == "procurement"
            or any(
                (edge.source_id == node.id and edge.target_id in procurement_ids)
                or (edge.target_id == node.id and edge.source_id in procurement_ids)
                for edge in searched.edges
            )
            for node in searched.nodes
        )
        first_graph = graph(
            q=None,
            kinds=None,
            since=None,
            until=None,
            max_tenders=6,
            offset=0,
            dataset="live",
            focus=None,
            order_type=None,
            db=session,
        )
        next_graph = graph(
            q=None,
            kinds=None,
            since=None,
            until=None,
            max_tenders=6,
            offset=6,
            dataset="live",
            focus=None,
            order_type=None,
            db=session,
        )
        assert next_graph.total_tenders == 1214
        assert next_graph.offset == 6
        assert {node.id for node in next_graph.nodes if node.kind == "procurement"}.isdisjoint(
            node.id for node in first_graph.nodes if node.kind == "procurement"
        )
    engine.dispose()
