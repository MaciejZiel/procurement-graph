"""Statistical red-flag signals for procurement notices.

A signal marks a pattern that procurement-integrity research associates with weaker
competition, so that a reader knows where to look first. It is not a finding: every
signal has ordinary explanations (a niche market, an urgent repair, a framework
supplier) and the notice itself must be read before drawing any conclusion.

Each signal is computed in SQL over ``procurement_facts`` and the supplier edges and
returns the numbers behind it, so the interface can explain why a case was marked.
"""

from dataclasses import dataclass
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from .analytics import AWARD_RELATIONSHIPS
from .schemas import RedFlagDefinitionOut, RedFlagOut, RedFlagSummaryOut

REPEAT_MIN_WINS = 3
SHORT_PROCEDURE_PERCENTILE = 0.05
SHORT_PROCEDURE_MIN_SAMPLE = 20

DEFINITIONS: dict[str, dict[str, str]] = {
    "single_bid": {
        "title": "Single bid",
        "description": (
            "At least one awarded part of the procedure received exactly one offer (BZP field 6.1)."
        ),
    },
    "repeat_supplier": {
        "title": "Repeat supplier",
        "description": (
            f"The same supplier won at least {REPEAT_MIN_WINS} notices from this buyer "
            "within the loaded data."
        ),
    },
    "short_procedure": {
        "title": "Unusually short procedure",
        "description": (
            "The time from the contract notice to signing the contract is among the "
            f"shortest {int(SHORT_PROCEDURE_PERCENTILE * 100)}% for this procurement type "
            f"(computed only when at least {SHORT_PROCEDURE_MIN_SAMPLE} comparable notices "
            "have both dates)."
        ),
    },
    "non_competitive": {
        "title": "Awarded without competition",
        "description": (
            "The notice states a single-source procedure (zamówienie z wolnej ręki) or "
            "negotiation without prior publication."
        ),
    },
}

DISCLAIMER = (
    "Signals are statistical patterns, not accusations. Each has ordinary explanations; "
    "read the linked notice before drawing conclusions."
)


@dataclass(frozen=True)
class FlagScope:
    dataset: str = "live"
    city: str | None = None

    def where(self, alias: str = "f") -> tuple[str, dict[str, Any]]:
        clauses = [f"{alias}.is_demo = :is_demo"]
        params: dict[str, Any] = {"is_demo": self.dataset == "demo"}
        if self.city:
            clauses.append(f"{alias}.city = :city")
            params["city"] = self.city
        return " AND ".join(clauses), params


def _days_between(dialect: str, start: str, end: str) -> str:
    if dialect == "postgresql":
        return f"({end} - {start})"
    return f"CAST(julianday({end}) - julianday({start}) AS INTEGER)"


def _single_bid(db: Session, scope: FlagScope) -> dict[str, list[RedFlagOut]]:
    where, params = scope.where()
    rows = db.execute(
        text(
            f"""
            SELECT f.procurement_id, f.awarded_parts
            FROM procurement_facts f
            WHERE {where} AND f.offers_count = 1
            """
        ),
        params,
    ).mappings()
    return {
        row["procurement_id"]: [
            RedFlagOut(code="single_bid", params={"awarded_parts": row["awarded_parts"]})
        ]
        for row in rows
    }


def _non_competitive(db: Session, scope: FlagScope) -> dict[str, list[RedFlagOut]]:
    where, params = scope.where()
    rows = db.execute(
        text(
            f"""
            SELECT f.procurement_id, f.procedure_kind
            FROM procurement_facts f
            WHERE {where}
              AND f.procedure_kind IN ('single_source', 'negotiated_without_notice')
              AND f.awarded_parts > 0
            """
        ),
        params,
    ).mappings()
    return {
        row["procurement_id"]: [
            RedFlagOut(code="non_competitive", params={"procedure_kind": row["procedure_kind"]})
        ]
        for row in rows
    }


def _repeat_supplier(db: Session, scope: FlagScope) -> dict[str, list[RedFlagOut]]:
    """Mark the notices won by a supplier that won at least three notices from the same buyer."""
    where, params = scope.where()
    relationships = ", ".join(f"'{value}'" for value in AWARD_RELATIONSHIPS)
    rows = db.execute(
        text(
            f"""
            WITH awards AS (
                SELECT DISTINCT f.procurement_id, f.buyer_id, e.target_id AS supplier_id
                FROM procurement_facts f
                JOIN graph_edges e ON e.source_id = f.procurement_id
                JOIN graph_nodes c ON c.id = e.target_id AND c.kind = 'company'
                WHERE {where} AND f.buyer_id IS NOT NULL
                  AND e.relationship_type IN ({relationships})
            ),
            counted AS (
                SELECT a.*,
                       COUNT(*) OVER (PARTITION BY a.buyer_id, a.supplier_id) AS pair_wins,
                       COUNT(*) OVER (PARTITION BY a.buyer_id) AS buyer_awards
                FROM awards a
            )
            SELECT c.procurement_id, c.supplier_id, s.label AS supplier_label,
                   b.label AS buyer_label, c.pair_wins, c.buyer_awards
            FROM counted c
            JOIN graph_nodes s ON s.id = c.supplier_id
            JOIN graph_nodes b ON b.id = c.buyer_id
            WHERE c.pair_wins >= :min_wins
            ORDER BY c.procurement_id, c.pair_wins DESC, s.label
            """
        ),
        {**params, "min_wins": REPEAT_MIN_WINS},
    ).mappings()
    flags: dict[str, list[RedFlagOut]] = {}
    for row in rows:
        if row["procurement_id"] in flags:
            continue  # keep the supplier with the most wins for each notice
        flags[row["procurement_id"]] = [
            RedFlagOut(
                code="repeat_supplier",
                params={
                    "supplier_id": row["supplier_id"],
                    "supplier": row["supplier_label"],
                    "buyer": row["buyer_label"],
                    "wins": row["pair_wins"],
                    "buyer_awards": row["buyer_awards"],
                },
            )
        ]
    return flags


def _short_procedure(db: Session, scope: FlagScope) -> dict[str, list[RedFlagOut]]:
    where, params = scope.where()
    days = _days_between(
        db.get_bind().dialect.name, "f.procedure_started_on", "f.contract_signed_on"
    )
    rows = db.execute(
        text(
            f"""
            WITH durations AS (
                SELECT f.procurement_id, COALESCE(f.order_type, 'Unknown') AS order_type,
                       {days} AS days
                FROM procurement_facts f
                WHERE {where}
                  AND f.procedure_started_on IS NOT NULL
                  AND f.contract_signed_on IS NOT NULL
                  AND f.contract_signed_on >= f.procedure_started_on
            ),
            ranked AS (
                SELECT d.*,
                       PERCENT_RANK() OVER (PARTITION BY order_type ORDER BY days) AS pct,
                       ROW_NUMBER() OVER (PARTITION BY order_type ORDER BY days) AS position,
                       COUNT(*) OVER (PARTITION BY order_type) AS sample
                FROM durations d
            ),
            medians AS (
                SELECT order_type, MIN(days) AS median_days
                FROM ranked
                WHERE position >= (sample + 1) / 2
                GROUP BY order_type
            )
            SELECT r.procurement_id, r.order_type, r.days, r.pct, r.sample, m.median_days
            FROM ranked r
            JOIN medians m ON m.order_type = r.order_type
            WHERE r.sample >= :min_sample AND r.pct < :percentile
            """
        ),
        {
            **params,
            "min_sample": SHORT_PROCEDURE_MIN_SAMPLE,
            "percentile": SHORT_PROCEDURE_PERCENTILE,
        },
    ).mappings()
    return {
        row["procurement_id"]: [
            RedFlagOut(
                code="short_procedure",
                params={
                    "days": int(row["days"]),
                    "median_days": int(row["median_days"]),
                    "order_type": row["order_type"],
                    "percentile": round(float(row["pct"]), 3),
                    "sample": row["sample"],
                },
            )
        ]
        for row in rows
    }


SIGNALS = {
    "single_bid": _single_bid,
    "repeat_supplier": _repeat_supplier,
    "short_procedure": _short_procedure,
    "non_competitive": _non_competitive,
}


def flags_by_procurement(
    db: Session, scope: FlagScope, codes: list[str] | None = None
) -> dict[str, list[RedFlagOut]]:
    """All signals for every notice in scope, keyed by procurement id."""
    combined: dict[str, list[RedFlagOut]] = {}
    for code, compute in SIGNALS.items():
        if codes and code not in codes:
            continue
        for procurement_id, flags in compute(db, scope).items():
            combined.setdefault(procurement_id, []).extend(flags)
    return combined


def flags_for(db: Session, procurement_id: str) -> list[RedFlagOut]:
    row = db.execute(
        text("SELECT is_demo FROM procurement_facts WHERE procurement_id = :id"),
        {"id": procurement_id},
    ).first()
    if row is None:
        return []
    scope = FlagScope(dataset="demo" if row[0] else "live")
    return flags_by_procurement(db, scope).get(procurement_id, [])


def summary(db: Session, scope: FlagScope) -> RedFlagSummaryOut:
    flags = flags_by_procurement(db, scope)
    where, params = scope.where()
    total = db.execute(
        text(f"SELECT COUNT(*) FROM procurement_facts f WHERE {where}"), params
    ).scalar_one()
    counts = {code: 0 for code in SIGNALS}
    for items in flags.values():
        for flag in items:
            counts[flag.code] += 1
    return RedFlagSummaryOut(
        notices=total,
        flagged_notices=len(flags),
        disclaimer=DISCLAIMER,
        signals=[
            RedFlagDefinitionOut(code=code, count=counts[code], **DEFINITIONS[code])
            for code in SIGNALS
        ],
    )
