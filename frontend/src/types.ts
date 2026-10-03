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
