export type NodeKind = "institution" | "company" | "procurement";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  subtitle: string;
  city: string;
  details: Record<string, string | number | null>;
  is_demo: boolean;
}

export interface GraphEdge {
  id: string;
  source_id: string;
  target_id: string;
  relationship_type: string;
  evidence_label: string;
  evidence_url: string | null;
  occurred_at: string | null;
  amount_pln: string | number | null;
  is_demo: boolean;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  total_tenders: number;
  offset: number;
  limit: number;
  latest_event_at: string | null;
  data_mode: "demo" | "live";
  notice: string;
}

export interface Story {
  id: string;
  eyebrow: string;
  title: string;
  summary: string;
  node_ids: string[];
  minutes: number;
}

export interface EntityRef {
  id: string;
  label: string;
  city: string;
}

export interface ProcurementItem {
  id: string;
  title: string;
  reference: string | null;
  published_on: string | null;
  buyer: EntityRef | null;
  suppliers: EntityRef[];
  order_type: string | null;
  cpv_code: string | null;
  procedure_result: string | null;
  source_url: string | null;
  is_demo: boolean;
  flags: RedFlagCode[];
}

export interface ProcurementPage {
  items: ProcurementItem[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
  buyers_count: number;
  suppliers_count: number;
  latest_event_at: string | null;
}

export interface Breakdown {
  key: string;
  notices: number;
  value_pln: string | null;
  single_bid_rate: number | null;
}

export interface AnalyticsSummary {
  notices: number;
  awarded_notices: number;
  total_value_pln: string | null;
  buyers: number;
  suppliers: number;
  notices_with_offer_count: number;
  single_bid_notices: number;
  single_bid_rate: number | null;
  average_offers: number | null;
  first_published_on: string | null;
  last_published_on: string | null;
  by_order_type: Breakdown[];
  cities: string[];
}

export interface RankedEntity {
  id: string;
  label: string;
  city: string;
  rank: number;
  notices: number;
  value_pln: string;
  value_share: number | null;
  single_bid_notices: number;
  counterparts: number;
}

export interface BuyerConcentration {
  buyer_id: string;
  buyer_label: string;
  buyer_city: string;
  awards: number;
  suppliers: number;
  value_pln: string;
  hhi: number;
  top_supplier_id: string;
  top_supplier_label: string;
  top_supplier_share: number;
  top_supplier_wins: number;
  basis: "value" | "count";
}

export interface TrendPoint {
  period: string;
  notices: number;
  value_pln: string;
  single_bid_rate: number | null;
  cumulative_notices: number;
  cumulative_value_pln: string;
}

export type RedFlagCode = "single_bid" | "repeat_supplier" | "short_procedure" | "non_competitive";

export interface RedFlag {
  code: RedFlagCode;
  params: Record<string, string | number | null>;
}

export interface ProcurementFlags {
  procurement_id: string;
  flags: RedFlag[];
  disclaimer: string;
}

export interface RedFlagSummary {
  notices: number;
  flagged_notices: number;
  disclaimer: string;
  signals: { code: RedFlagCode; title: string; description: string; count: number }[];
}
