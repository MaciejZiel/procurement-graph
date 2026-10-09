"""Aggregate procurement statistics computed in SQL.

All queries read ``procurement_facts`` (one row per notice) and the supplier edges in
``graph_edges``. They use CTEs and window functions that behave the same on
PostgreSQL and SQLite, so the tests exercise the exact SQL that runs in production.
Only the date bucketing for trends needs a dialect-specific expression.
"""

from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from .schemas import (
    AnalyticsSummaryOut,
    BreakdownOut,
    BuyerConcentrationOut,
    RankedEntityOut,
    TrendPointOut,
)

AWARD_RELATIONSHIPS = ("wybrano wykonawcę", "wskazano wykonawcę", "selected supplier")


@dataclass(frozen=True)
class Scope:
    """Filters shared by every analytics query."""

    dataset: str = "live"
    city: str | None = None
    since: date | None = None
    until: date | None = None

    def where(self, alias: str = "f") -> tuple[str, dict[str, Any]]:
        clauses = [f"{alias}.is_demo = :is_demo"]
        params: dict[str, Any] = {"is_demo": self.dataset == "demo"}
        if self.city:
            clauses.append(f"{alias}.city = :city")
            params["city"] = self.city
        if self.since:
            clauses.append(f"{alias}.published_on >= :since")
            params["since"] = self.since
        if self.until:
            clauses.append(f"{alias}.published_on <= :until")
            params["until"] = self.until
        return " AND ".join(clauses), params


def _facts_cte(scope: Scope) -> tuple[str, dict[str, Any]]:
    where, params = scope.where("f")
    return f"scoped AS (SELECT f.* FROM procurement_facts f WHERE {where})", params


def _awards_cte() -> str:
    """One row per (procurement, supplier) taken from evidence-backed supplier edges."""
    relationships = ", ".join(f"'{value}'" for value in AWARD_RELATIONSHIPS)
    return f"""awards AS (
        SELECT s.procurement_id, s.buyer_id, e.target_id AS supplier_id,
               e.amount_pln AS value_pln, s.offers_count
        FROM scoped s
        JOIN graph_edges e ON e.source_id = s.procurement_id
        JOIN graph_nodes c ON c.id = e.target_id AND c.kind = 'company'
        WHERE e.relationship_type IN ({relationships})
    )"""


def _money(value: Any) -> Decimal | None:
    if value is None:
        return None
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _ratio(value: Any) -> float | None:
    return None if value is None else round(float(value), 4)


def summary(db: Session, scope: Scope) -> AnalyticsSummaryOut:
    facts, params = _facts_cte(scope)
    totals = (
        db.execute(
            text(
                f"""
            WITH {facts}, {_awards_cte()}
            SELECT
                (SELECT COUNT(*) FROM scoped) AS notices,
                (SELECT COUNT(*) FROM scoped WHERE awarded_parts > 0) AS awarded_notices,
                (SELECT SUM(contract_value_pln) FROM scoped) AS total_value,
                (SELECT COUNT(DISTINCT buyer_id) FROM scoped) AS buyers,
                (SELECT COUNT(DISTINCT supplier_id) FROM awards) AS suppliers,
                (SELECT COUNT(offers_count) FROM scoped) AS with_offers,
                (SELECT COUNT(*) FROM scoped WHERE offers_count = 1) AS single_bid,
                (SELECT AVG(CAST(offers_count AS FLOAT)) FROM scoped) AS avg_offers,
                (SELECT MIN(published_on) FROM scoped) AS first_day,
                (SELECT MAX(published_on) FROM scoped) AS last_day
            """
            ),
            params,
        )
        .mappings()
        .one()
    )

    breakdown_rows = db.execute(
        text(
            f"""
            WITH {facts}
            SELECT COALESCE(order_type, 'Unknown') AS key,
                   COUNT(*) AS notices,
                   SUM(contract_value_pln) AS value,
                   COUNT(offers_count) AS with_offers,
                   SUM(CASE WHEN offers_count = 1 THEN 1 ELSE 0 END) AS single_bid
            FROM scoped
            GROUP BY COALESCE(order_type, 'Unknown')
            ORDER BY notices DESC, key
            """
        ),
        params,
    ).mappings()

    city_where, city_params = Scope(dataset=scope.dataset).where("f")
    cities = [
        row[0]
        for row in db.execute(
            text(
                f"SELECT f.city, COUNT(*) AS n FROM procurement_facts f "
                f"WHERE {city_where} GROUP BY f.city ORDER BY n DESC, f.city"
            ),
            city_params,
        )
    ]

    with_offers = totals["with_offers"] or 0
    return AnalyticsSummaryOut(
        notices=totals["notices"] or 0,
        awarded_notices=totals["awarded_notices"] or 0,
        total_value_pln=_money(totals["total_value"]),
        buyers=totals["buyers"] or 0,
        suppliers=totals["suppliers"] or 0,
        notices_with_offer_count=with_offers,
        single_bid_notices=totals["single_bid"] or 0,
        single_bid_rate=_ratio((totals["single_bid"] or 0) / with_offers) if with_offers else None,
        average_offers=_ratio(totals["avg_offers"]),
        first_published_on=_as_date(totals["first_day"]),
        last_published_on=_as_date(totals["last_day"]),
        by_order_type=[
            BreakdownOut(
                key=row["key"],
                notices=row["notices"],
                value_pln=_money(row["value"]),
                single_bid_rate=_ratio(row["single_bid"] / row["with_offers"])
                if row["with_offers"]
                else None,
            )
            for row in breakdown_rows
        ],
        cities=cities,
    )


def _as_date(value: Any) -> date | None:
    if value is None or isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


def top_buyers(db: Session, scope: Scope, by: str, limit: int) -> list[RankedEntityOut]:
    facts, params = _facts_cte(scope)
    order = "value_pln DESC, notices DESC" if by == "value" else "notices DESC, value_pln DESC"
    rows = db.execute(
        text(
            f"""
            WITH {facts}, {_awards_cte()},
            per_buyer AS (
                SELECT buyer_id,
                       COUNT(*) AS notices,
                       COALESCE(SUM(contract_value_pln), 0) AS value_pln,
                       SUM(CASE WHEN offers_count = 1 THEN 1 ELSE 0 END) AS single_bid
                FROM scoped
                WHERE buyer_id IS NOT NULL
                GROUP BY buyer_id
            ),
            partners AS (
                SELECT buyer_id, COUNT(DISTINCT supplier_id) AS counterparts
                FROM awards GROUP BY buyer_id
            ),
            ranked AS (
                SELECT p.*,
                       RANK() OVER (ORDER BY {order}) AS position,
                       CAST(p.value_pln AS FLOAT)
                           / NULLIF(SUM(CAST(p.value_pln AS FLOAT)) OVER (), 0) AS value_share
                FROM per_buyer p
            )
            SELECT r.*, n.label, n.city, COALESCE(pt.counterparts, 0) AS counterparts
            FROM ranked r
            JOIN graph_nodes n ON n.id = r.buyer_id
            LEFT JOIN partners pt ON pt.buyer_id = r.buyer_id
            ORDER BY r.position, n.label
            LIMIT :limit
            """
        ),
        {**params, "limit": limit},
    ).mappings()
    return [_ranked(row, "buyer_id") for row in rows]


def top_suppliers(db: Session, scope: Scope, by: str, limit: int) -> list[RankedEntityOut]:
    facts, params = _facts_cte(scope)
    order = "value_pln DESC, notices DESC" if by == "value" else "notices DESC, value_pln DESC"
    rows = db.execute(
        text(
            f"""
            WITH {facts}, {_awards_cte()},
            per_supplier AS (
                SELECT supplier_id,
                       COUNT(DISTINCT procurement_id) AS notices,
                       COALESCE(SUM(value_pln), 0) AS value_pln,
                       SUM(CASE WHEN offers_count = 1 THEN 1 ELSE 0 END) AS single_bid,
                       COUNT(DISTINCT buyer_id) AS counterparts
                FROM awards
                GROUP BY supplier_id
            ),
            ranked AS (
                SELECT p.*,
                       RANK() OVER (ORDER BY {order}) AS position,
                       CAST(p.value_pln AS FLOAT)
                           / NULLIF(SUM(CAST(p.value_pln AS FLOAT)) OVER (), 0) AS value_share
                FROM per_supplier p
            )
            SELECT r.*, n.label, n.city
            FROM ranked r
            JOIN graph_nodes n ON n.id = r.supplier_id
            ORDER BY r.position, n.label
            LIMIT :limit
            """
        ),
        {**params, "limit": limit},
    ).mappings()
    return [_ranked(row, "supplier_id") for row in rows]


def _ranked(row: Any, id_column: str) -> RankedEntityOut:
    return RankedEntityOut(
        id=row[id_column],
        label=row["label"],
        city=row["city"],
        rank=row["position"],
        notices=row["notices"],
        value_pln=_money(row["value_pln"]) or Decimal("0.00"),
        value_share=_ratio(row["value_share"]),
        single_bid_notices=row["single_bid"] or 0,
        counterparts=row["counterparts"] or 0,
    )


def concentration(
    db: Session, scope: Scope, basis: str, min_awards: int, limit: int
) -> list[BuyerConcentrationOut]:
    """Supplier concentration per buyer: HHI and the share of the largest supplier.

    Shares are computed from contract value (``basis=value``) or from the number of
    awarded notices (``basis=count``). HHI is the sum of squared shares on the usual
    0–10,000 scale: 10,000 means one supplier received everything.
    """
    facts, params = _facts_cte(scope)
    measure = "CAST(value_pln AS FLOAT)" if basis == "value" else "CAST(wins AS FLOAT)"
    rows = db.execute(
        text(
            f"""
            WITH {facts}, {_awards_cte()},
            pairs AS (
                SELECT buyer_id, supplier_id,
                       COUNT(DISTINCT procurement_id) AS wins,
                       COALESCE(SUM(value_pln), 0) AS value_pln
                FROM awards
                WHERE buyer_id IS NOT NULL
                GROUP BY buyer_id, supplier_id
            ),
            shares AS (
                SELECT buyer_id, supplier_id, wins, value_pln,
                       {measure} / NULLIF(SUM({measure}) OVER (PARTITION BY buyer_id), 0)
                           AS share,
                       ROW_NUMBER() OVER (
                           PARTITION BY buyer_id ORDER BY {measure} DESC, wins DESC, supplier_id
                       ) AS supplier_rank
                FROM pairs
            ),
            per_buyer AS (
                SELECT buyer_id,
                       SUM(wins) AS awards,
                       COUNT(*) AS suppliers,
                       SUM(value_pln) AS value_pln,
                       SUM(share * share) * 10000 AS hhi
                FROM shares
                GROUP BY buyer_id
                HAVING SUM(wins) >= :min_awards
            )
            SELECT p.buyer_id, b.label AS buyer_label, b.city AS buyer_city,
                   p.awards, p.suppliers, p.value_pln, p.hhi,
                   t.supplier_id AS top_supplier_id, s.label AS top_supplier_label,
                   t.share AS top_share, t.wins AS top_wins
            FROM per_buyer p
            JOIN shares t ON t.buyer_id = p.buyer_id AND t.supplier_rank = 1
            JOIN graph_nodes b ON b.id = p.buyer_id
            JOIN graph_nodes s ON s.id = t.supplier_id
            WHERE p.hhi IS NOT NULL
            ORDER BY p.hhi DESC, p.awards DESC, b.label
            LIMIT :limit
            """
        ),
        {**params, "min_awards": min_awards, "limit": limit},
    ).mappings()
    return [
        BuyerConcentrationOut(
            buyer_id=row["buyer_id"],
            buyer_label=row["buyer_label"],
            buyer_city=row["buyer_city"],
            awards=row["awards"],
            suppliers=row["suppliers"],
            value_pln=_money(row["value_pln"]) or Decimal("0.00"),
            hhi=round(float(row["hhi"]), 1),
            top_supplier_id=row["top_supplier_id"],
            top_supplier_label=row["top_supplier_label"],
            top_supplier_share=_ratio(row["top_share"]) or 0.0,
            top_supplier_wins=row["top_wins"],
            basis=basis,
        )
        for row in rows
    ]


def _bucket_expression(dialect: str, granularity: str) -> str:
    if dialect == "postgresql":
        return f"to_char(date_trunc('{granularity}', published_on), 'YYYY-MM-DD')"
    if granularity == "week":
        # Monday of the ISO week: jump to the next Sunday (or stay), then back six days.
        return "date(published_on, 'weekday 0', '-6 days')"
    return "strftime('%Y-%m-01', published_on)"


def trends(db: Session, scope: Scope, granularity: str) -> list[TrendPointOut]:
    facts, params = _facts_cte(scope)
    bucket = _bucket_expression(db.get_bind().dialect.name, granularity)
    rows = db.execute(
        text(
            f"""
            WITH {facts},
            buckets AS (
                SELECT {bucket} AS period,
                       COUNT(*) AS notices,
                       COALESCE(SUM(contract_value_pln), 0) AS value_pln,
                       COUNT(offers_count) AS with_offers,
                       SUM(CASE WHEN offers_count = 1 THEN 1 ELSE 0 END) AS single_bid
                FROM scoped
                WHERE published_on IS NOT NULL
                GROUP BY {bucket}
            )
            SELECT period, notices, value_pln, with_offers, single_bid,
                   SUM(notices) OVER (ORDER BY period) AS cumulative_notices,
                   SUM(value_pln) OVER (ORDER BY period) AS cumulative_value_pln
            FROM buckets
            ORDER BY period
            """
        ),
        params,
    ).mappings()
    return [
        TrendPointOut(
            period=_as_date(row["period"]),
            notices=row["notices"],
            value_pln=_money(row["value_pln"]) or Decimal("0.00"),
            single_bid_rate=_ratio(row["single_bid"] / row["with_offers"])
            if row["with_offers"]
            else None,
            cumulative_notices=row["cumulative_notices"],
            cumulative_value_pln=_money(row["cumulative_value_pln"]) or Decimal("0.00"),
        )
        for row in rows
    ]
