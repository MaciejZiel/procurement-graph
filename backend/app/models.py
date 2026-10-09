"""Relational graph model; graph edges always carry their evidence."""

from datetime import date
from decimal import Decimal

from sqlalchemy import JSON, Boolean, Date, ForeignKey, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class GraphNode(Base):
    __tablename__ = "graph_nodes"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    kind: Mapped[str] = mapped_column(String(24), index=True)
    label: Mapped[str] = mapped_column(String(240), index=True)
    subtitle: Mapped[str] = mapped_column(String(240), default="")
    city: Mapped[str] = mapped_column(String(120), default="")
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False, index=True)

    outgoing: Mapped[list["GraphEdge"]] = relationship(
        foreign_keys="GraphEdge.source_id", back_populates="source", cascade="all, delete-orphan"
    )
    incoming: Mapped[list["GraphEdge"]] = relationship(
        foreign_keys="GraphEdge.target_id", back_populates="target", cascade="all, delete-orphan"
    )


class GraphEdge(Base):
    __tablename__ = "graph_edges"

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    source_id: Mapped[str] = mapped_column(ForeignKey("graph_nodes.id"), index=True)
    target_id: Mapped[str] = mapped_column(ForeignKey("graph_nodes.id"), index=True)
    relationship_type: Mapped[str] = mapped_column(String(40), index=True)
    evidence_label: Mapped[str] = mapped_column(String(240))
    evidence_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    occurred_at: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    amount_pln: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False, index=True)

    source: Mapped[GraphNode] = relationship(foreign_keys=[source_id], back_populates="outgoing")
    target: Mapped[GraphNode] = relationship(foreign_keys=[target_id], back_populates="incoming")


class ProcurementFacts(Base):
    """One row per procurement with the figures used by analytics.

    The values are read from the notice body (number of offers, contract value and
    signing date) and kept in typed columns so aggregates run in SQL rather than over
    JSON blobs. A missing value means the notice does not state it.
    """

    __tablename__ = "procurement_facts"

    procurement_id: Mapped[str] = mapped_column(ForeignKey("graph_nodes.id"), primary_key=True)
    buyer_id: Mapped[str | None] = mapped_column(ForeignKey("graph_nodes.id"), index=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    city: Mapped[str] = mapped_column(String(120), default="", index=True)
    published_on: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    order_type: Mapped[str | None] = mapped_column(String(24), nullable=True)
    procedure_kind: Mapped[str | None] = mapped_column(String(40), nullable=True)
    parts_count: Mapped[int] = mapped_column(Integer, default=0)
    awarded_parts: Mapped[int] = mapped_column(Integer, default=0)
    offers_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    contract_value_pln: Mapped[Decimal | None] = mapped_column(Numeric(16, 2), nullable=True)
    estimated_value_pln: Mapped[Decimal | None] = mapped_column(Numeric(16, 2), nullable=True)
    contract_signed_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    preceding_notice: Mapped[str | None] = mapped_column(String(60), nullable=True)
    procedure_started_on: Mapped[date | None] = mapped_column(Date, nullable=True)
