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
