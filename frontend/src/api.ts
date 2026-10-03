import type { GraphData, ProcurementPage, Story } from "./types";

const apiBase = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBase}/api/${path}`);
  if (!response.ok) {
    throw new Error(`API odpowiedziało kodem ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function fetchGraph(options: {
  query?: string;
  kinds?: string[];
  dataset?: "demo" | "live";
  since?: string;
  until?: string;
  focus?: string;
  orderType?: string;
  offset?: number;
} = {}): Promise<GraphData> {
  const params = new URLSearchParams();
  if (options.query?.trim()) params.set("q", options.query.trim());
  for (const kind of options.kinds ?? []) params.append("kinds", kind);
  params.set("dataset", options.dataset ?? "demo");
  if (options.since) params.set("since", options.since);
  if (options.until) params.set("until", options.until);
  if (options.focus) params.set("focus", options.focus);
  if (options.orderType) params.set("order_type", options.orderType);
  if (options.offset) params.set("offset", String(options.offset));
  return getJson<GraphData>(`graph?${params.toString()}`);
}

export function fetchProcurements(options: {
  query?: string;
  dataset: "demo" | "live";
  since?: string;
  until?: string;
  orderType?: string;
  hasSupplier?: boolean;
  sort: "newest" | "oldest" | "title";
  page: number;
  pageSize?: number;
}): Promise<ProcurementPage> {
  const params = new URLSearchParams({
    dataset: options.dataset,
    sort: options.sort,
    page: String(options.page),
    page_size: String(options.pageSize ?? 12),
  });
  if (options.query?.trim()) params.set("q", options.query.trim());
  if (options.since) params.set("since", options.since);
  if (options.until) params.set("until", options.until);
  if (options.orderType) params.set("order_type", options.orderType);
  if (options.hasSupplier !== undefined) params.set("has_supplier", String(options.hasSupplier));
  return getJson<ProcurementPage>(`procurements?${params.toString()}`);
}

export function fetchStories(): Promise<Story[]> {
  return getJson<Story[]>("stories");
}
