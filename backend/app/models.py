"""Relational graph model; graph edges always carry their evidence."""

from datetime import date
from decimal import Decimal

from sqlalchemy import Boolean, Date, ForeignKey, JSON, Numeric, String, Text
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
