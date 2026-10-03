import type { GraphData, Story } from "./types";

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
} = {}): Promise<GraphData> {
  const params = new URLSearchParams();
  if (options.query?.trim()) params.set("q", options.query.trim());
  for (const kind of options.kinds ?? []) params.append("kinds", kind);
  params.set("dataset", options.dataset ?? "demo");
  return getJson<GraphData>(`graph?${params.toString()}`);
}

export function fetchStories(): Promise<Story[]> {
  return getJson<Story[]>("stories");
}
