import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { fetchGraph, fetchProcurements, fetchStories } from "./api";
import Catalog from "./Catalog";
import type { GraphData, GraphNode, NodeKind, ProcurementItem, ProcurementPage, Story } from "./types";

const kinds: { id: NodeKind; label: string; color: string }[] = [
  { id: "institution", label: "Instytucje", color: "#a99bff" },
  { id: "procurement", label: "Postępowania", color: "#a5e9c1" },
  { id: "company", label: "Wykonawcy", color: "#ffc18e" },
];

const kindLabels: Record<NodeKind, string> = {
  institution: "Instytucja",
  procurement: "Postępowanie",
  company: "Wykonawca",
};
const validKinds: NodeKind[] = ["institution", "procurement", "company"];
const graphPageSize = 6;
const defaultViewport = { x: 0, y: 0, width: 1100, height: 700 };

function formatMoney(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat("pl-PL", {
    style: "currency",
    currency: "PLN",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(value: unknown): string {
  if (typeof value !== "string" || !value) return "Brak daty";
  return new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium" }).format(new Date(value));
}

function dateInputValue(value: Date): string {
  return [value.getFullYear(), String(value.getMonth() + 1).padStart(2, "0"), String(value.getDate()).padStart(2, "0")].join("-");
}

function periodBounds(window: string): { since?: string; until?: string } {
  if (window === "all") return {};
  const today = new Date();
  return {
    since: dateInputValue(new Date(today.getFullYear() - (window === "24m" ? 2 : 1), today.getMonth(), today.getDate())),
    until: dateInputValue(today),
  };
}

function orderTypeLabel(value: unknown): string {
  return value === "Delivery" ? "Dostawy" : value === "Services" ? "Usługi" : value === "Works" ? "Roboty budowlane" : "Nie podano";
}

function getNodePositions(nodes: GraphNode[]) {
  const columns: Record<NodeKind, GraphNode[]> = {
    institution: nodes.filter((node) => node.kind === "institution"),
    procurement: nodes.filter((node) => node.kind === "procurement"),
    company: nodes.filter((node) => node.kind === "company"),
  };
  const x: Record<NodeKind, number> = { institution: 150, procurement: 550, company: 950 };
  const positions = new Map<string, { x: number; y: number }>();
  (Object.keys(columns) as NodeKind[]).forEach((kind) => {
    const list = columns[kind];
    const top = list.length === 1 ? 360 : 132;
    const bottom = list.length === 1 ? 360 : 580;
    list.forEach((node, index) => {
      const y = list.length === 1 ? 360 : top + ((bottom - top) * index) / (list.length - 1);
      positions.set(node.id, { x: x[kind], y });
    });
  });
  return positions;
}

function shortLabel(label: string): string[] {
  const words = label.split(" ");
  const lines = [""];
  const maxWidth = 190;
  const width = (value: string) => [...value].reduce((sum, char) => sum + (/\s|[.,]/.test(char) ? 4 : /[A-ZĄĆĘŁŃÓŚŹŻ]/.test(char) ? 9 : 7.2), 0);
  for (const word of words) {
    const last = lines.length - 1;
    if (width((lines[last] + " " + word).trim()) > maxWidth && lines.length < 2) lines.push(word);
    else lines[last] = (lines[last] + " " + word).trim();
  }
  return lines.map((line) => {
    if (width(line) <= maxWidth) return line;
    let cut = line;
    while (cut.length && width(`${cut}…`) > maxWidth) cut = cut.slice(0, -1);
    return `${cut.trimEnd()}…`;
  });
}

function Symbol({ name }: { name: "search" | "share" | "download" | "arrow" | "close" | "menu" }) {
  const common = { width: 17, height: 17, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  if (name === "search") return <svg {...common}><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.5 4.5" /></svg>;
  if (name === "share") return <svg {...common}><circle cx="18" cy="5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="19" r="2.5" /><path d="m8.2 10.8 7.5-4.3M8.2 13.2l7.5 4.3" /></svg>;
  if (name === "download") return <svg {...common}><path d="M12 3v12m0 0 4-4m-4 4-4-4" /><path d="M5 17v3h14v-3" /></svg>;
  if (name === "arrow") return <svg {...common}><path d="M5 12h14m-6-6 6 6-6 6" /></svg>;
  if (name === "close") return <svg {...common}><path d="m6 6 12 12M18 6 6 18" /></svg>;
  return <svg {...common}><path d="M4 7h16M4 12h16M4 17h16" /></svg>;
}

function GraphCanvas({
  data,
  selectedId,
  activeStory,
  onSelect,
  expanded,
  onExpand,
}: {
  data: GraphData;
  selectedId: string | null;
  activeStory: Story | null;
  onSelect: (node: GraphNode) => void;
  expanded: boolean;
  onExpand: () => void;
}) {
  const positions = useMemo(() => getNodePositions(data.nodes), [data.nodes]);
  const storyIds = new Set(activeStory?.node_ids ?? []);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [viewport, setViewport] = useState(defaultViewport);
  const [dragging, setDragging] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ clientX: number; clientY: number; x: number; y: number } | null>(null);
  const activeId = hoveredId ?? selectedId;
  const tracedEdges = useMemo(() => {
    if (!activeId) return new Set<string>();
    const tenders = new Set<string>();
    const selected = data.nodes.find((node) => node.id === activeId);
    if (selected?.kind === "procurement") tenders.add(activeId);
    for (const edge of data.edges) {
      if (edge.source_id !== activeId && edge.target_id !== activeId) continue;
      const otherId = edge.source_id === activeId ? edge.target_id : edge.source_id;
      if (data.nodes.some((node) => node.id === otherId && node.kind === "procurement")) tenders.add(otherId);
    }
    return new Set(data.edges.filter((edge) => tenders.has(edge.source_id) || tenders.has(edge.target_id)).map((edge) => edge.id));
  }, [activeId, data]);
  const tracedNodes = useMemo(() => {
    const ids = new Set<string>(activeId ? [activeId] : []);
    for (const edge of data.edges) {
      if (tracedEdges.has(edge.id)) {
        ids.add(edge.source_id);
        ids.add(edge.target_id);
      }
    }
    return ids;
  }, [activeId, data.edges, tracedEdges]);

  useEffect(() => {
    setViewport(defaultViewport);
    setHoveredId(null);
    if (window.innerWidth <= 700 && canvasRef.current) canvasRef.current.scrollLeft = 112;
  }, [data]);

  function zoom(factor: number) {
    setViewport((current) => {
      const width = Math.max(520, Math.min(1100, current.width * factor));
      const height = width * 700 / 1100;
      return {
        x: Math.max(0, Math.min(1100 - width, current.x + (current.width - width) / 2)),
        y: Math.max(0, Math.min(700 - height, current.y + (current.height - height) / 2)),
        width,
        height,
      };
    });
  }

  function startDrag(event: ReactPointerEvent<SVGSVGElement>) {
    if (viewport.width === 1100 || (event.target as Element).closest(".graph-node")) return;
    dragStart.current = { clientX: event.clientX, clientY: event.clientY, x: viewport.x, y: viewport.y };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }

  function moveDrag(event: ReactPointerEvent<SVGSVGElement>) {
    const start = dragStart.current;
    if (!start) return;
    const box = event.currentTarget.getBoundingClientRect();
    const dx = (event.clientX - start.clientX) * viewport.width / box.width;
    const dy = (event.clientY - start.clientY) * viewport.height / box.height;
    setViewport((current) => ({
      ...current,
      x: Math.max(0, Math.min(1100 - current.width, start.x - dx)),
      y: Math.max(0, Math.min(700 - current.height, start.y - dy)),
    }));
  }

  function stopDrag() {
    dragStart.current = null;
    setDragging(false);
  }
  const counts = useMemo(() => ({
    institution: data.nodes.filter((node) => node.kind === "institution").length,
    procurement: data.nodes.filter((node) => node.kind === "procurement").length,
    company: data.nodes.filter((node) => node.kind === "company").length,
  }), [data.nodes]);

  return (
    <div ref={canvasRef} className={`graph-canvas ${dragging ? "map-dragging" : ""}`} aria-label="Interaktywny graf relacji">
      <div className="map-tools" aria-label="Narzędzia mapy">
        <button onClick={() => zoom(.78)} disabled={viewport.width <= 520} aria-label="Powiększ mapę" title="Powiększ">+</button>
        <button onClick={() => zoom(1.28)} disabled={viewport.width >= 1100} aria-label="Pomniejsz mapę" title="Pomniejsz">−</button>
        <button onClick={() => setViewport(defaultViewport)} disabled={viewport.width >= 1100} aria-label="Dopasuj mapę" title="Dopasuj mapę">⌖</button>
        <button onClick={onExpand} aria-label={expanded ? "Zamknij pełny ekran mapy" : "Otwórz mapę na pełnym ekranie"} title={expanded ? "Zamknij pełny ekran" : "Pełny ekran"}>{expanded ? "↙" : "⛶"}</button>
      </div>
      <svg viewBox={`${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`} role="group" aria-labelledby="graph-title graph-description" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={stopDrag} onPointerCancel={stopDrag}>
        <title id="graph-title">Graf zamówień i podmiotów</title>
        <desc id="graph-description">Kliknij węzeł, aby zobaczyć szczegóły i dowody relacji.</desc>
        <defs>
          <pattern id="graph-grid" width="28" height="28" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="#4b6159" opacity=".55" />
          </pattern>
          <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
            <path d="M0 0 8 4 0 8z" fill="#78968b" />
          </marker>
        </defs>
        <rect width="1100" height="700" fill="url(#graph-grid)" />
        <g className="graph-columns" aria-hidden="true">
          <text x="26" y="60">01 / ZAMAWIAJĄCY</text>
          <text x="426" y="60">02 / POSTĘPOWANIA</text>
          <text x="826" y="60">03 / WYKONAWCY</text>
          <path d="M26 74 H274 M426 74 H674 M826 74 H1074" />
        </g>
        <g className="edge-layer">
          {data.edges.map((edge, index) => {
            const source = positions.get(edge.source_id);
            const target = positions.get(edge.target_id);
            if (!source || !target) return null;
            const sx = source.x + (target.x > source.x ? 126 : -126);
            const tx = target.x + (source.x < target.x ? -130 : 130);
            const bend = (index % 2 === 0 ? -1 : 1) * Math.min(35, Math.abs(target.y - source.y) * 0.12);
            const path = `M ${sx} ${source.y} C ${(sx + tx) / 2} ${source.y + bend}, ${(sx + tx) / 2} ${target.y - bend}, ${tx} ${target.y}`;
            const isActive = storyIds.has(edge.source_id) && storyIds.has(edge.target_id);
            return (
              <g key={edge.id} className={`edge ${isActive ? "edge-active" : ""} ${tracedEdges.has(edge.id) ? "edge-traced" : activeId ? "edge-muted" : ""}`}>
                <path d={path} markerEnd="url(#arrowhead)" />
              </g>
            );
          })}
        </g>
        <g className="node-layer">
          {data.nodes.map((node, nodeIndex) => {
            const point = positions.get(node.id);
            if (!point) return null;
            const selected = node.id === selectedId;
            const inStory = storyIds.has(node.id);
            const compact = counts[node.kind] > 7;
            const lines = compact ? shortLabel(node.label).slice(0, 1) : shortLabel(node.label);
            const cardY = compact ? -18 : -35;
            const cardHeight = compact ? 36 : 70;
            return (
              <g
                key={node.id}
                className={`graph-node node-${node.kind} ${compact ? "node-compact" : ""} ${selected ? "is-selected" : ""} ${inStory ? "in-story" : ""} ${activeId && !tracedNodes.has(node.id) ? "node-muted" : ""}`}
                style={{ "--node-order": nodeIndex } as CSSProperties}
                transform={`translate(${point.x} ${point.y})`}
                role="button"
                tabIndex={0}
                aria-label={`${kindLabels[node.kind]}: ${node.label}`}
                aria-pressed={selected}
                onClick={() => onSelect(node)}
                onPointerEnter={() => setHoveredId(node.id)}
                onPointerLeave={() => setHoveredId(null)}
                onFocus={() => setHoveredId(node.id)}
                onBlur={() => setHoveredId(null)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(node);
                  }
                }}
              >
                <rect className="node-halo" x="-128" y={compact ? -22 : -39} width="256" height={compact ? 44 : 78} rx="9" />
                <rect className="node-card" x="-124" y={cardY} width="248" height={cardHeight} rx="5" />
                <rect className="node-accent" x="-124" y={cardY} width="4" height={cardHeight} rx="2" />
                {!compact && <text className="node-kind" x="-107" y="-14">{kindLabels[node.kind].toUpperCase()}</text>}
                <text className="node-index" x="107" y={compact ? 4 : -14}>{String(data.nodes.filter((item) => item.kind === node.kind).findIndex((item) => item.id === node.id) + 1).padStart(2, "0")}</text>
                <text className="node-name" x="-107" y={compact ? 5 : 8}>
                  {lines.map((line, index) => <tspan key={index} x="-107" dy={index === 0 ? 0 : 17}>{line}</tspan>)}
                </text>
                <title>{node.label}</title>
                <rect className="node-hit-area" x="-124" y={cardY} width="248" height={cardHeight} fill="transparent" />
              </g>
            );
          })}
        </g>
      </svg>
      {data.nodes.length === 0 && (
        <div className="graph-empty">
          <span className="empty-mark">∅</span>
          <strong>Tu jeszcze nie ma połączeń</strong>
          <p>Zmień filtry albo wpisz nazwę instytucji, firmy lub postępowania.</p>
        </div>
      )}
      <div className="graph-axis" aria-hidden="true">
        <span>→</span><small>{viewport.width < 1100 ? "przeciągnij, aby przesunąć" : "kliknij węzeł, aby śledzić relację"}</small><span>↗</span>
      </div>
    </div>
  );
}

function EvidenceRoute({ data, selectedNode, onSelect }: {
  data: GraphData;
  selectedNode: GraphNode | null;
  onSelect: (node: GraphNode) => void;
}) {
  if (!selectedNode) return null;
  const byId = new Map(data.nodes.map((node) => [node.id, node]));
  const tender = selectedNode.kind === "procurement" ? selectedNode : data.edges
    .filter((edge) => edge.source_id === selectedNode.id || edge.target_id === selectedNode.id)
    .map((edge) => byId.get(edge.source_id === selectedNode.id ? edge.target_id : edge.source_id))
    .find((node) => node?.kind === "procurement");
  if (!tender) return null;
  const buyerEdge = data.edges.find((edge) => edge.target_id === tender.id && byId.get(edge.source_id)?.kind === "institution");
  const buyer = buyerEdge ? byId.get(buyerEdge.source_id) : null;
  const suppliers = data.edges.filter((edge) => edge.source_id === tender.id && byId.get(edge.target_id)?.kind === "company")
    .map((edge) => byId.get(edge.target_id)!)
    .filter(Boolean);
  const source = buyerEdge?.evidence_url ?? data.edges.find((edge) => edge.source_id === tender.id)?.evidence_url;

  return <div className="evidence-route" aria-label="Ścieżka wybranego postępowania">
    <div className="route-heading"><span>AKTYWNA ŚCIEŻKA</span><span>{formatDate(tender.details.published_on)}</span></div>
    <div className="route-content">
      <button className="route-stop route-buyer" onClick={() => buyer && onSelect(buyer)} disabled={!buyer}><small>01 / ZAMAWIAJĄCY</small><strong>{buyer?.label ?? "Nie podano"}</strong></button>
      <span className="route-arrow" aria-hidden="true">⟶</span>
      <button className="route-stop route-main" onClick={() => onSelect(tender)}><small>02 / POSTĘPOWANIE</small><strong>{tender.label}</strong></button>
      <span className="route-arrow" aria-hidden="true">⟶</span>
      <button className="route-stop route-supplier" onClick={() => suppliers[0] && onSelect(suppliers[0])} disabled={!suppliers.length}><small>03 / WYKONAWCA{Math.max(0, suppliers.length - 1) ? ` +${suppliers.length - 1}` : ""}</small><strong>{suppliers[0]?.label ?? "Nie wskazano"}</strong></button>
      {source && <a href={source} target="_blank" rel="noreferrer" className="route-source">Źródło ↗</a>}
    </div>
  </div>;
}

function App() {
  const [data, setData] = useState<GraphData | null>(null);
  const [stories, setStories] = useState<Story[]>([]);
  const [query, setQuery] = useState(() => new URLSearchParams(window.location.search).get("q") ?? "");
  const [visibleKinds, setVisibleKinds] = useState<NodeKind[]>(() => {
    const selected = new URLSearchParams(window.location.search).get("types");
    if (!selected) return validKinds;
    const parsed = selected.split(",").filter((kind): kind is NodeKind => validKinds.includes(kind as NodeKind));
    return parsed.length ? parsed : validKinds;
  });
  const [selectedId, setSelectedId] = useState<string | null>(() => new URLSearchParams(window.location.search).get("node"));
  const [activeStory, setActiveStory] = useState<Story | null>(null);
  const [dataset, setDataset] = useState<"demo" | "live">(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("dataset") === "demo" || params.has("story") ? "demo" : "live";
  });
  const [dateWindow, setDateWindow] = useState(() => {
    const selected = new URLSearchParams(window.location.search).get("period");
    return selected === "12m" || selected === "all" ? selected : "24m";
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false);
  const [catalogData, setCatalogData] = useState<ProcurementPage | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogPage, setCatalogPage] = useState(1);
  const [catalogOrderType, setCatalogOrderType] = useState("");
  const [supplierFilter, setSupplierFilter] = useState<"all" | "with" | "without">("all");
  const [catalogSort, setCatalogSort] = useState<"newest" | "oldest" | "title">("newest");
  const [focusTender, setFocusTender] = useState<string | null>(() => new URLSearchParams(window.location.search).get("focus"));
  const [graphOffset, setGraphOffset] = useState(() => {
    const raw = Number(new URLSearchParams(window.location.search).get("offset") ?? 0);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw / graphPageSize) * graphPageSize : 0;
  });
  const [mapExpanded, setMapExpanded] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const requestVersion = useRef(0);
  const catalogRequestVersion = useRef(0);

  useEffect(() => {
    function onSearchShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInput.current?.focus();
      }
      if (event.key === "Escape" && document.activeElement === searchInput.current) {
        searchInput.current?.blur();
      }
      if (event.key === "Escape") {
        setMobileDetailsOpen(false);
        setMobileNavOpen(false);
        setMapExpanded(false);
      }
    }
    window.addEventListener("keydown", onSearchShortcut);
    return () => window.removeEventListener("keydown", onSearchShortcut);
  }, []);

  useEffect(() => {
    document.body.style.overflow = mapExpanded ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mapExpanded]);

  async function loadGraph(nextQuery = query, nextKinds = visibleKinds, nextDateWindow = dateWindow, nextDataset = dataset) {
    const version = ++requestVersion.current;
    setLoading(true);
    setError(null);
    try {
      const next = await fetchGraph({
        query: nextQuery,
        kinds: nextKinds,
        dataset: nextDataset,
        ...periodBounds(nextDateWindow),
        focus: focusTender ?? undefined,
        orderType: catalogOrderType || undefined,
        offset: focusTender ? 0 : graphOffset,
      });
      if (version !== requestVersion.current) return;
      setData(next);
      setSelectedId((current) => next.nodes.some((node) => node.id === current) ? current : next.nodes.find((node) => node.kind === "procurement")?.id ?? next.nodes[0]?.id ?? null);
    } catch (caught) {
      if (version === requestVersion.current) setError(caught instanceof Error ? caught.message : "Nie udało się pobrać danych.");
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }

  useEffect(() => {
    fetchStories().then((items) => {
      setStories(items);
      const sharedStory = new URLSearchParams(window.location.search).get("story");
      const match = items.find((item) => item.id === sharedStory);
      if (match) {
        setActiveStory(match);
        setSelectedId(match.node_ids[0] ?? null);
        setDataset("demo");
      }
    }).catch(() => setStories([]));
  }, []);

  useEffect(() => {
    requestVersion.current += 1;
    setLoading(true);
    setError(null);
    const timer = window.setTimeout(() => void loadGraph(query, visibleKinds, dateWindow, dataset), 180);
    return () => window.clearTimeout(timer);
  }, [query, visibleKinds, dateWindow, dataset, focusTender, catalogOrderType, graphOffset]);

  useEffect(() => {
    const version = ++catalogRequestVersion.current;
    setCatalogLoading(true);
    setCatalogError(null);
    const timer = window.setTimeout(() => {
      void fetchProcurements({
        query,
        dataset,
        ...periodBounds(dateWindow),
        orderType: catalogOrderType || undefined,
        hasSupplier: supplierFilter === "all" ? undefined : supplierFilter === "with",
        sort: catalogSort,
        page: catalogPage,
      }).then((next) => {
        if (version === catalogRequestVersion.current) setCatalogData(next);
      }).catch((caught) => {
        if (version === catalogRequestVersion.current) setCatalogError(caught instanceof Error ? caught.message : "Nie udało się pobrać katalogu.");
      }).finally(() => {
        if (version === catalogRequestVersion.current) setCatalogLoading(false);
      });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query, dataset, dateWindow, catalogOrderType, supplierFilter, catalogSort, catalogPage]);

  const selectedNode = data?.nodes.find((node) => node.id === selectedId) ?? null;
  const relatedEdges = data?.edges.filter((edge) => edge.source_id === selectedId || edge.target_id === selectedId) ?? [];
  const institutions = data?.nodes.filter((node) => node.kind === "institution").length ?? 0;
  const companies = data?.nodes.filter((node) => node.kind === "company").length ?? 0;
  const relationCount = data?.edges.length ?? 0;
  function toggleKind(kind: NodeKind) {
    setVisibleKinds((current) => {
      if (current.includes(kind) && current.length === 1) return current;
      return current.includes(kind)
        ? current.filter((item) => item !== kind)
        : [...current, kind];
    });
  }

  async function shareView() {
    const url = new URL(window.location.href);
    if (selectedId) url.searchParams.set("node", selectedId);
    if (activeStory) url.searchParams.set("story", activeStory.id);
    else url.searchParams.delete("story");
    if (query.trim()) url.searchParams.set("q", query.trim());
    else url.searchParams.delete("q");
    url.searchParams.set("period", dateWindow);
    url.searchParams.set("types", visibleKinds.join(","));
    url.searchParams.set("dataset", dataset);
    if (focusTender) url.searchParams.set("focus", focusTender);
    else url.searchParams.delete("focus");
    if (graphOffset && !focusTender) url.searchParams.set("offset", String(graphOffset));
    else url.searchParams.delete("offset");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Przeglądarka zablokowała kopiowanie linku.");
    }
  }

  function exportGraph() {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = "jawny-slad-graf.json";
    link.click();
    URL.revokeObjectURL(href);
  }

  function openStory(story: Story) {
    if (dataset !== "demo") {
      requestVersion.current += 1;
      setData(null);
      setLoading(true);
    }
    setDataset("demo");
    setCatalogOrderType("");
    setSupplierFilter("all");
    setCatalogPage(1);
    setFocusTender(null);
    setGraphOffset(0);
    setActiveStory(story);
    setSelectedId(story.node_ids[0] ?? null);
    setMobileDetailsOpen(false);
  }

  function selectNode(node: GraphNode) {
    setSelectedId(node.id);
    setMobileDetailsOpen(true);
  }

  function showGraphPage(offset: number) {
    requestVersion.current += 1;
    setData(null);
    setLoading(true);
    setSelectedId(null);
    setFocusTender(null);
    setActiveStory(null);
    setGraphOffset(offset);
  }

  function showRandomGraphPage() {
    const pages = Math.ceil((data?.total_tenders ?? 0) / graphPageSize);
    if (pages < 2) return;
    const current = Math.floor(graphOffset / graphPageSize);
    const chosen = Math.floor(Math.random() * (pages - 1));
    showGraphPage((chosen >= current ? chosen + 1 : chosen) * graphPageSize);
  }

  function selectProcurement(item: ProcurementItem) {
    requestVersion.current += 1;
    setData(null);
    setLoading(true);
    setFocusTender(item.id);
    setGraphOffset(0);
    setSelectedId(item.id);
    setActiveStory(null);
    setMobileDetailsOpen(window.innerWidth <= 1060);
    document.querySelector(".graph-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function resetCatalogFilters() {
    setQuery("");
    setCatalogOrderType("");
    setSupplierFilter("all");
    setDateWindow("all");
    setCatalogPage(1);
    setFocusTender(null);
    setGraphOffset(0);
  }

  return (
    <div className="app-shell">
      <header className={`topbar ${mobileNavOpen ? "nav-open" : ""}`}>
        <a className="brand" href="#top" aria-label="Jawny Ślad — strona główna">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span className="brand-wordmark">JAWNY<span>ŚLAD</span></span>
        </a>
        <nav className="top-nav" aria-label="Nawigacja główna">
          <a className="nav-active" href="#explore" onClick={() => setMobileNavOpen(false)}>Eksploruj</a>
          <a href="#catalog" onClick={() => setMobileNavOpen(false)}>Rejestr</a>
          <a href="#stories" onClick={() => setMobileNavOpen(false)}>Ścieżki</a>
          <a href="#methodology" onClick={() => setMobileNavOpen(false)}>Metodologia</a>
        </nav>
        <div className="top-meta">
          <span className="data-status"><i /> {dataset === "demo" ? "DEMO / WARSZAWA" : "BZP / WARSZAWA"}</span>
          <a className="github-link" href="#methodology">O projekcie <Symbol name="arrow" /></a>
          <button className="mobile-menu" aria-label="Otwórz menu" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen((open) => !open)}><Symbol name="menu" /></button>
        </div>
      </header>

      <main id="top">
        <section className="intro-section" id="explore">
          <div className="intro-copy">
            <div className="eyebrow"><span className="eyebrow-line" /> PRACOWNIA DANYCH PUBLICZNYCH <span className="eyebrow-year">VOL. 01 / 2026</span></div>
            <h1>Każdy przetarg<br />zostawia <em>ślad.</em></h1>
            <p>Połącz instytucje, postępowania i wykonawców. Potem sprawdź, co naprawdę mówią źródła.</p>
            <div className="intro-actions">
              <button onClick={() => setMapExpanded(true)}>Otwórz atlas powiązań <span aria-hidden="true">↗</span></button>
              <a href="#catalog">Zobacz rejestr{catalogData ? ` · ${catalogData.total.toLocaleString("pl-PL")}` : ""} <span aria-hidden="true">→</span></a>
            </div>
          </div>
          <div className="intro-side-note">
            <span>W TEJ PRACOWNI</span>
            <p>Nie zgadujemy.<br />Pokazujemy, skąd<br />pochodzi każdy wniosek.</p>
            <a href="#methodology">Jak czytać dane <Symbol name="arrow" /></a>
          </div>
        </section>

        <section className={`demo-ribbon ${dataset === "live" ? "source-ribbon" : ""}`} aria-label="Informacja o danych">
          <div className="ribbon-stamp">{dataset === "demo" ? "DEMO" : "BZP"}</div>
          <p>{dataset === "demo" ? <><strong>Scenariusz demonstracyjny.</strong> Widoczne tu podmioty i zamówienia są fikcyjne. Nie opisują prawdziwych relacji.</> : <><strong>Dane źródłowe BZP.</strong> Sprawdź każde połączenie w opublikowanym ogłoszeniu.</>}</p>
          <span className="ribbon-location">WARSZAWA <b>·</b> POLSKA</span>
        </section>

        <section className="metrics-row" aria-label="Statystyki widoku">
          <div className="metric-cell"><span>POSTĘPOWANIA W KATALOGU</span><strong>{catalogData?.total.toLocaleString("pl-PL") ?? "—"}</strong></div>
          <div className="metric-cell"><span>ZAMAWIAJĄCY NA MAPIE</span><strong>{institutions.toString().padStart(2, "0")}</strong></div>
          <div className="metric-cell"><span>WYKONAWCY NA MAPIE</span><strong>{companies.toString().padStart(2, "0")}</strong></div>
          <div className="metric-cell metric-total"><span>RELACJE NA MAPIE</span><strong>{relationCount.toString().padStart(2, "0")}</strong></div>
          <div className="metric-footnote">Mapa pokazuje wycinek · <a href="#catalog">przejdź do pełnego rejestru ↗</a></div>
        </section>

        <section className={`workbench ${mapExpanded ? "map-expanded" : ""}`} aria-label="Eksplorator powiązań">
          <aside className="left-rail">
            <div className="rail-heading"><span>01 / WARSZAWA</span><span>TYLKO ODCZYT</span></div>
            <div className="search-field">
              <Symbol name="search" />
              <input ref={searchInput} name="search" value={query} onChange={(event) => { setQuery(event.target.value); setCatalogPage(1); setGraphOffset(0); setFocusTender(null); }} placeholder="Szukaj w danych" aria-label="Szukaj instytucji, firmy lub postępowania" />
              {query && <button aria-label="Wyczyść wyszukiwanie" onClick={() => { setQuery(""); setCatalogPage(1); }}><Symbol name="close" /></button>}
              {!query && <kbd>⌘ / Ctrl K</kbd>}
            </div>

            <div className="rail-section">
              <div className="section-label"><span>WARSTWY</span><span className="section-count">03</span></div>
              {kinds.map((kind) => (
                <button key={kind.id} className={`filter-row ${visibleKinds.includes(kind.id) ? "filter-on" : ""}`} onClick={() => toggleKind(kind.id)} aria-pressed={visibleKinds.includes(kind.id)}>
                  <span className="filter-dot" style={{ "--dot-color": kind.color } as CSSProperties} />
                  <span>{kind.label}</span>
                  <span className="filter-check">{visibleKinds.includes(kind.id) ? "✓" : ""}</span>
                </button>
              ))}
            </div>

            <div className="rail-section stories-section" id="stories">
              <div className="section-label"><span>ŚCIEŻKI ŚLEDCZE</span><span className="section-count">{stories.length.toString().padStart(2, "0")}</span></div>
              {stories.map((story, index) => (
                <button key={story.id} className={`story-link ${activeStory?.id === story.id ? "story-active" : ""}`} onClick={() => openStory(story)}>
                  <span className="story-number">0{index + 1}</span>
                  <span className="story-link-copy"><strong>{story.title}</strong><small>{story.minutes} min <i>·</i> demo</small></span>
                  <Symbol name="arrow" />
                </button>
              ))}
              {stories.length === 0 && <p className="muted-small">Ścieżki ładują się z API.</p>}
            </div>

            <div className="rail-bottom" id="methodology">
              <span className="method-mark">i</span>
              <p><strong>Źródło ma znaczenie.</strong> Każdy fakt i każda relacja powinny prowadzić do dokumentu.</p>
              <a href="https://ezamowienia.gov.pl/pl/integracja/" target="_blank" rel="noreferrer">O źródłach BZP <Symbol name="arrow" /></a>
            </div>
          </aside>

          <section className="graph-panel" aria-label="Mapa powiązań">
            <div className="panel-toolbar">
              <div>
                <div className="panel-kicker">MAPA RELACJI <span>·</span> {dataset === "demo" ? "SCENARIUSZ DEMO" : "DANE BZP"}</div>
                <h2>{activeStory?.title ?? "Przepływ zamówień"}</h2>
              </div>
              <div className="toolbar-actions">
                <label className="date-select data-select"><span>ZBIÓR</span><select name="dataset" value={dataset} onChange={(event) => { requestVersion.current += 1; setData(null); setCatalogData(null); setLoading(true); setDataset(event.target.value as "demo" | "live"); setActiveStory(null); setMobileDetailsOpen(false); setFocusTender(null); setGraphOffset(0); setCatalogPage(1); setCatalogOrderType(""); setSupplierFilter("all"); }} aria-label="Wybierz dane demonstracyjne lub BZP">
                  <option value="demo">Scenariusz demo</option>
                  <option value="live">Zaimportowane BZP</option>
                </select></label>
                <label className="date-select"><span>OKRES</span><select name="period" value={dateWindow} onChange={(event) => { setDateWindow(event.target.value); setCatalogPage(1); setGraphOffset(0); setFocusTender(null); }} aria-label="Zakres dat">
                  <option value="24m">Ostatnie 2 lata</option>
                  <option value="12m">Ostatnie 12 miesięcy</option>
                  <option value="all">Cały okres</option>
                </select></label>
                <button className="icon-button" onClick={() => void shareView()} aria-label="Kopiuj link do widoku" title="Kopiuj link"><Symbol name="share" /></button>
                <button className="icon-button" onClick={exportGraph} aria-label="Eksportuj widoczne dane" title="Eksportuj JSON"><Symbol name="download" /></button>
              </div>
            </div>
            {copied && <div className="copy-toast" role="status">Link skopiowany</div>}
            <div className="graph-summary"><span><i className="live-dot" /> {dataset === "demo" ? "DANE DEMONSTRACYJNE" : "OGŁOSZENIA BZP"}</span><span>NAJNOWSZE ZDARZENIE · {formatDate(data?.latest_event_at)}</span></div>
            {activeStory && <div className="story-focus" role="status"><div><span>WYBRANA ŚCIEŻKA · {activeStory.minutes} MIN</span><p>{activeStory.summary}</p></div><button onClick={() => setActiveStory(null)} aria-label="Zamknij ścieżkę"><Symbol name="close" /></button></div>}
            {focusTender && <div className="focus-record"><span>Wybrane postępowanie z rejestru</span><button onClick={() => { setFocusTender(null); setGraphOffset(0); }}>Pokaż najnowsze ↗</button></div>}
            <div className="atlas-navigation" aria-label="Przeglądanie mapy">
              <div className="atlas-position"><span>{focusTender ? "WYBRANA SPRAWA" : `WIDOK ${String(Math.floor(graphOffset / graphPageSize) + 1).padStart(3, "0")}`}</span><strong>{data ? (focusTender ? "1 POSTĘPOWANIE" : `${Math.min(data.offset + 1, data.total_tenders)}–${Math.min(data.offset + data.limit, data.total_tenders)} / ${data.total_tenders.toLocaleString("pl-PL")}`) : "ŁADOWANIE..."}</strong></div>
              <div className="atlas-actions">
                <button onClick={() => showGraphPage(Math.max(0, graphOffset - graphPageSize))} disabled={loading || !!focusTender || graphOffset === 0} aria-label="Poprzednie postępowania">←</button>
                <button onClick={() => showGraphPage(graphOffset + graphPageSize)} disabled={loading || !!focusTender || !data || graphOffset + graphPageSize >= data.total_tenders} aria-label="Kolejne postępowania">→</button>
                <button className="atlas-shuffle" onClick={showRandomGraphPage} disabled={loading || !data || data.total_tenders <= graphPageSize}>Losowy widok ↗</button>
              </div>
            </div>
            <div className="mobile-scroll-hint" aria-hidden="true">Przesuń mapę w bok <span>→</span></div>
            {loading && <div className="loading-line"><i /> Ładowanie grafu…</div>}
            {error && <div className="api-error" role="alert"><strong>Nie mogę połączyć się z API.</strong><span>{error}</span><button onClick={() => void loadGraph()}>Spróbuj ponownie</button></div>}
            {data && <GraphCanvas data={data} selectedId={selectedId} activeStory={activeStory} onSelect={selectNode} expanded={mapExpanded} onExpand={() => setMapExpanded((expanded) => !expanded)} />}
            {data && <EvidenceRoute data={data} selectedNode={selectedNode} onSelect={selectNode} />}
            <div className="graph-legend">
              <div>{kinds.map((kind) => <span key={kind.id}><i style={{ "--dot-color": kind.color } as CSSProperties} />{kind.label}</span>)}</div>
              <span className="legend-hint">KLIKNIJ WĘZEŁ, ABY ZOBACZYĆ SZCZEGÓŁY</span>
            </div>
            <div className="panel-foot"><span>RELACJA WYNIKA Z REKORDU POSTĘPOWANIA</span><span>ŹRÓDŁO · DATA · KONTEKST</span></div>
          </section>

          {mobileDetailsOpen && <button className="detail-backdrop" aria-label="Zamknij szczegóły" onClick={() => setMobileDetailsOpen(false)} />}
          <aside className={`detail-rail ${mobileDetailsOpen ? "details-open" : ""}`} aria-label="Szczegóły wybranego elementu">
            <div className="detail-header">
              <div className="section-label"><span>02 / KARTA PODMIOTU</span></div>
              <button className="mobile-close" onClick={() => setMobileDetailsOpen(false)} aria-label="Zamknij szczegóły"><Symbol name="close" /></button>
              {selectedNode ? <>
                <span className={`kind-pill kind-${selectedNode.kind}`}>{kindLabels[selectedNode.kind]}</span>
                <h3>{selectedNode.label}</h3>
                <p className="detail-subtitle">{selectedNode.subtitle}</p>
              </> : <>
                <span className="kind-pill kind-empty">WYBIERZ WĘZEŁ</span>
                <h3>Sprawdź szczegóły</h3>
                <p className="detail-subtitle">Wybierz element na mapie, aby zobaczyć jego historię i źródła.</p>
              </>}
            </div>

            {selectedNode && <>
              <div className="detail-facts">
                <div><span>LOKALIZACJA</span><strong>{selectedNode.city || "Nie podano"}</strong></div>
                {selectedNode.details.reference && <div><span>NUMER POSTĘPOWANIA</span><strong className="mono-value">{selectedNode.details.reference}</strong></div>}
                {selectedNode.details.published_on && <div><span>DATA OGŁOSZENIA</span><strong>{formatDate(selectedNode.details.published_on)}</strong></div>}
                {selectedNode.details.sector && <div><span>OBSZAR</span><strong>{selectedNode.details.sector}</strong></div>}
                {selectedNode.details.order_type && <div><span>RODZAJ ZAMÓWIENIA</span><strong>{orderTypeLabel(selectedNode.details.order_type)}</strong></div>}
                {selectedNode.details.cpv_code && <div><span>KOD CPV</span><strong>{String(selectedNode.details.cpv_code).split(",")[0]}</strong></div>}
                {(selectedNode.details.nip || selectedNode.details.tax_id) && <div><span>NIP / REGON</span><strong className="mono-value">{String(selectedNode.details.nip ?? selectedNode.details.tax_id)}</strong></div>}
              </div>

              {selectedNode.kind === "procurement" && selectedNode.is_demo && <div className="contract-card">
                <span>WARTOŚĆ UMOWY</span><strong>{formatMoney(selectedNode.details.amount_pln)}</strong>
                <div className="contract-meta"><span>Status</span><b>{String(selectedNode.details.status ?? "Brak danych")}</b></div>
                <div className="contract-meta"><span>Liczba ofert</span><b>{String(selectedNode.details.offers ?? "Nie podano")}</b></div>
              </div>}
              {selectedNode.kind === "procurement" && !selectedNode.is_demo && <div className="contract-card"><span>WYNIK POSTĘPOWANIA</span><strong className="result-value">{selectedNode.details.procedure_result === "zawarcieUmowy" ? "Zawarto umowę" : selectedNode.details.procedure_result ? "Opublikowano wynik" : "Brak informacji"}</strong><div className="contract-meta"><span>Kwota w tym źródle</span><b>{selectedNode.details.amount_pln == null ? "Nie podano" : formatMoney(selectedNode.details.amount_pln)}</b></div></div>}

              <div className="detail-section">
                <div className="section-label"><span>POWIĄZANIA</span><span className="section-count">{relatedEdges.length.toString().padStart(2, "0")}</span></div>
                {relatedEdges.length ? relatedEdges.map((edge) => {
                  const otherId = edge.source_id === selectedNode.id ? edge.target_id : edge.source_id;
                  const otherNode = data?.nodes.find((node) => node.id === otherId);
                  return <button key={edge.id} className="relation-row" onClick={() => { if (otherNode) selectNode(otherNode); }}>
                    <span className="relation-icon">↗</span>
                    <span className="relation-copy"><strong>{edge.relationship_type}</strong><small>{otherNode?.label ?? "Powiązany rekord"}</small></span>
                    <Symbol name="arrow" />
                  </button>;
                }) : <p className="muted-small">Brak relacji w bieżącym widoku.</p>}
              </div>

              <div className="detail-section evidence-section">
                <div className="section-label"><span>DOWODY I ŹRÓDŁA</span></div>
                {relatedEdges.map((edge) => <div className="evidence-card" key={edge.id}>
                  <div className="evidence-icon">↗</div>
                  <div><strong>{edge.evidence_label}</strong><span>{formatDate(edge.occurred_at)}</span>
                    {edge.evidence_url ? <a href={edge.evidence_url} target="_blank" rel="noreferrer">Otwórz dokument źródłowy <Symbol name="arrow" /></a> : <small className="demo-source">Scenariusz fikcyjny · brak dokumentu źródłowego</small>}
                  </div>
                </div>)}
                {relatedEdges.length === 0 && <p className="muted-small">Źródło pojawi się po wybraniu powiązanego postępowania.</p>}
              </div>

              {selectedNode.kind === "procurement" && Number(selectedNode.details.offers) === 1 && <div className="signal-card">
                <span className="signal-icon">!</span><div><b>Sygnał do sprawdzenia</b><p>W scenariuszu demo podano jedną ofertę. To opis wzorca, nie ocena postępowania.</p></div>
              </div>}
            </>}
            <div className="detail-footer"><span>JAWNY ŚLAD / 2026</span><span>METODOLOGIA ↗</span></div>
          </aside>
        </section>

        <Catalog
          data={catalogData}
          loading={catalogLoading}
          error={catalogError}
          dataset={dataset}
          selectedId={focusTender}
          orderType={catalogOrderType}
          supplierFilter={supplierFilter}
          sort={catalogSort}
          onOrderType={(value) => { setCatalogOrderType(value); setCatalogPage(1); setGraphOffset(0); setFocusTender(null); }}
          onSupplierFilter={(value) => { setSupplierFilter(value); setCatalogPage(1); }}
          onSort={(value) => { setCatalogSort(value); setCatalogPage(1); }}
          onPage={setCatalogPage}
          onSelect={selectProcurement}
          onReset={resetCatalogFilters}
        />

        <footer className="site-footer">
          <a className="footer-brand" href="#top">JAWNY ŚLAD</a>
          <span>Otwieramy dane. Pokazujemy dowody.</span>
          <span>DANE PUBLICZNE <i>·</i> WARSZAWA</span>
        </footer>
      </main>
    </div>
  );
}

export default App;
