import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { fetchGraph, fetchProcurements, fetchStories } from "./api";
import Analytics from "./Analytics";
import Catalog from "./Catalog";
import CaseSpotlight from "./CaseSpotlight";
import { localizeSource, t, type Language } from "./i18n";
import type { GraphData, GraphNode, NodeKind, ProcurementItem, ProcurementPage, Story } from "./types";

const kinds: { id: NodeKind; label: string; color: string }[] = [
  { id: "institution", label: "BUYERS", color: "#a99bff" },
  { id: "procurement", label: "PROCUREMENTS", color: "#a5e9c1" },
  { id: "company", label: "SUPPLIERS", color: "#ffc18e" },
];

const kindLabels: Record<NodeKind, string> = {
  institution: "Buyer",
  procurement: "Procurement",
  company: "Supplier",
};
const validKinds: NodeKind[] = ["institution", "procurement", "company"];
const graphPageSize = 6;
const defaultViewport = { x: 0, y: 0, width: 1100, height: 700 };

function formatMoney(value: unknown, language: Language): string {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat(language === "pl" ? "pl-PL" : "en-GB", {
    style: "currency",
    currency: "PLN",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(value: unknown, language: Language): string {
  if (typeof value !== "string" || !value) return t("Date unavailable", language);
  return new Intl.DateTimeFormat(language === "pl" ? "pl-PL" : "en-GB", { dateStyle: "medium" }).format(new Date(value));
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

function orderTypeLabel(value: unknown, language: Language): string {
  const label = value === "Delivery" ? "Supplies" : value === "Services" ? "Services" : value === "Works" ? "Works" : "Not provided";
  return t(label, language);
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
  language,
}: {
  data: GraphData;
  selectedId: string | null;
  activeStory: Story | null;
  onSelect: (node: GraphNode) => void;
  expanded: boolean;
  onExpand: () => void;
  language: Language;
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
    <div ref={canvasRef} className={`graph-canvas ${dragging ? "map-dragging" : ""}`} aria-label={t("Interactive relationship graph", language)}>
      <div className="map-tools" aria-label={t("Map controls", language)}>
        <button onClick={() => zoom(.78)} disabled={viewport.width <= 520} aria-label={t("Zoom in", language)} title={t("Zoom in", language)}>+</button>
        <button onClick={() => zoom(1.28)} disabled={viewport.width >= 1100} aria-label={t("Zoom out", language)} title={t("Zoom out", language)}>−</button>
        <button onClick={() => setViewport(defaultViewport)} disabled={viewport.width >= 1100} aria-label={t("Reset map view", language)} title={t("Reset map view", language)}>⌖</button>
          <button onClick={onExpand} aria-label={t(expanded ? "Close full-screen map" : "Open full-screen map", language)} title={t(expanded ? "Close full screen" : "Full screen", language)}>{expanded ? "↙" : "⛶"}</button>
      </div>
      <svg viewBox={`${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`} role="group" aria-labelledby="graph-title graph-description" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={stopDrag} onPointerCancel={stopDrag}>
        <title id="graph-title">{t("Procurement and entity graph", language)}</title>
        <desc id="graph-description">{t("Select a node to inspect its details and evidence.", language)}</desc>
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
          <text x="26" y="60">01 / {t("BUYERS", language)}</text>
          <text x="426" y="60">02 / {t("PROCUREMENTS", language)}</text>
          <text x="826" y="60">03 / {t("SUPPLIERS", language)}</text>
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
                aria-label={`${t(kindLabels[node.kind], language)}: ${node.label}`}
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
                {!compact && <text className="node-kind" x="-107" y="-14">{t(kindLabels[node.kind], language).toUpperCase()}</text>}
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
          <strong>{t("No connections in this view", language)}</strong>
          <p>{t("Adjust the filters or search for a buyer, supplier, or procurement.", language)}</p>
        </div>
      )}
      <div className="graph-axis" aria-hidden="true">
        <span>→</span><small>{viewport.width < 1100 ? t("drag to pan", language) : t("select a node to trace a relationship", language)}</small><span>↗</span>
      </div>
    </div>
  );
}

function EvidenceRoute({ data, selectedNode, onSelect, language }: {
  data: GraphData;
  selectedNode: GraphNode | null;
  onSelect: (node: GraphNode) => void;
  language: Language;
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

  return <div className="evidence-route" aria-label={t("Selected procurement path", language)}>
    <div className="route-heading"><span>{t("ACTIVE PATH", language)}</span><span>{formatDate(tender.details.published_on, language)}</span></div>
    <div className="route-content">
      <button className="route-stop route-buyer" onClick={() => buyer && onSelect(buyer)} disabled={!buyer}><small>01 / {t("Buyer", language).toUpperCase()}</small><strong>{buyer?.label ?? t("Not provided", language)}</strong></button>
      <span className="route-arrow" aria-hidden="true">⟶</span>
      <button className="route-stop route-main" onClick={() => onSelect(tender)}><small>02 / {t("Procurement", language).toUpperCase()}</small><strong>{tender.label}</strong></button>
      <span className="route-arrow" aria-hidden="true">⟶</span>
      <button className="route-stop route-supplier" onClick={() => suppliers[0] && onSelect(suppliers[0])} disabled={!suppliers.length}><small>03 / {t("Supplier", language).toUpperCase()}{Math.max(0, suppliers.length - 1) ? ` +${suppliers.length - 1}` : ""}</small><strong>{suppliers[0]?.label ?? t("Not named", language)}</strong></button>
      {source && <a href={source} target="_blank" rel="noreferrer" className="route-source">{t("Source ↗", language)}</a>}
    </div>
  </div>;
}

function App() {
  const [language, setLanguage] = useState<Language>(() => window.localStorage.getItem("language") === "en" ? "en" : "pl");
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
  const [view, setView] = useState<"explore" | "analytics">(() => window.location.hash === "#analytics" ? "analytics" : "explore");
  const searchInput = useRef<HTMLInputElement>(null);
  const mapSearchInput = useRef<HTMLInputElement>(null);
  const requestVersion = useRef(0);
  const catalogRequestVersion = useRef(0);

  useEffect(() => {
    document.documentElement.lang = language;
    window.localStorage.setItem("language", language);
    document.title = language === "pl" ? "Jawny Ślad — zamówienia publiczne pod lupą" : "Procurement Graph — public procurement records";
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (description) description.content = t("Explore public procurement results and verify relationships in official notices.", language);
  }, [language]);

  useEffect(() => {
    function onSearchShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        (mapExpanded ? mapSearchInput : searchInput).current?.focus();
      }
      if (event.key === "Escape" && (document.activeElement === searchInput.current || document.activeElement === mapSearchInput.current)) {
        (document.activeElement as HTMLElement).blur();
      }
      if (event.key === "Escape") {
        setMobileDetailsOpen(false);
        setMobileNavOpen(false);
        setMapExpanded(false);
      }
    }
    window.addEventListener("keydown", onSearchShortcut);
    return () => window.removeEventListener("keydown", onSearchShortcut);
  }, [mapExpanded]);

  useEffect(() => {
    function onHashChange() {
      const next = window.location.hash === "#analytics" ? "analytics" : "explore";
      setView(next);
      const target = window.location.hash && next === "explore" ? window.location.hash : null;
      window.requestAnimationFrame(() => {
        if (target) document.querySelector(target)?.scrollIntoView({ block: "start" });
        else window.scrollTo({ top: 0 });
      });
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  function searchRegistry(label: string) {
    setQuery(label);
    setCatalogPage(1);
    setGraphOffset(0);
    setFocusTender(null);
    window.location.hash = "#catalog";
  }

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
      setSelectedId((current) => {
        if (next.nodes.some((node) => node.id === current)) return current;
        const featured = next.nodes
          .filter((node) => node.kind === "procurement" && next.edges.some((edge) => edge.source_id === node.id && next.nodes.some((target) => target.id === edge.target_id && target.kind === "company")))
          .sort((a, b) => a.label.length - b.label.length)[0];
        return featured?.id ?? next.nodes.find((node) => node.kind === "procurement")?.id ?? next.nodes[0]?.id ?? null;
      });
    } catch (caught) {
      if (version === requestVersion.current) setError(caught instanceof Error ? caught.message : "Could not load the graph.");
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
        if (version === catalogRequestVersion.current) setCatalogError(caught instanceof Error ? caught.message : "Could not load the catalog.");
      }).finally(() => {
        if (version === catalogRequestVersion.current) setCatalogLoading(false);
      });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query, dataset, dateWindow, catalogOrderType, supplierFilter, catalogSort, catalogPage]);

  const selectedNode = data?.nodes.find((node) => node.id === selectedId) ?? null;
  const relatedEdges = data?.edges.filter((edge) => edge.source_id === selectedId || edge.target_id === selectedId) ?? [];
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
      setError("The browser blocked copying the link.");
    }
  }

  function exportGraph() {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = "procurement-graph.json";
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
    setMobileDetailsOpen(false);
    setMapExpanded(false);
    document.querySelector("#case")?.scrollIntoView({ behavior: "smooth", block: "start" });
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
        <a className="brand" href="#top" aria-label={t("Procurement Graph — home", language)}>
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span className="brand-wordmark">{language === "pl" ? <>JAWNY<span>ŚLAD</span></> : <>PROCUREMENT<span>GRAPH</span></>}</span>
        </a>
        <nav className="top-nav" aria-label={t("Main navigation", language)}>
          <a className={view === "explore" ? "nav-active" : ""} href="#case" onClick={() => setMobileNavOpen(false)}>{t("Example", language)}</a>
          <a href="#catalog" onClick={() => setMobileNavOpen(false)}>{t("Registry", language)}</a>
          <a className={view === "analytics" ? "nav-active" : ""} href="#analytics" onClick={() => setMobileNavOpen(false)}>{t("Analytics", language)}</a>
          <button onClick={() => { if (view !== "explore") window.location.hash = "#case"; setMapExpanded(true); setMobileNavOpen(false); }}>{t("Relationship map", language)}</button>
          <a href="#sources" onClick={() => setMobileNavOpen(false)}>{t("About the data", language)}</a>
        </nav>
        <div className="top-meta">
          <span className="data-status"><i /> {dataset === "demo" ? t("DEMO DATA", language) : "BZP"} / {t("WARSAW", language)}</span>
          <a className="github-link" href="#sources">{t("About", language)} <Symbol name="arrow" /></a>
          <div className="language-toggle" role="group" aria-label={t("Choose language", language)}>
            <button type="button" aria-label={t("Polish", language)} aria-pressed={language === "pl"} onClick={() => setLanguage("pl")}>PL</button>
            <button type="button" aria-label={t("English", language)} aria-pressed={language === "en"} onClick={() => setLanguage("en")}>EN</button>
          </div>
          <button className="mobile-menu" aria-label={t("Open menu", language)} aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen((open) => !open)}><Symbol name="menu" /></button>
        </div>
      </header>

      <main id="top">
      {view === "analytics" && <Analytics language={language} dataset={dataset} onSearch={searchRegistry} />}
      {view === "explore" && <>
      <section className="intro-section" id="explore">
          <div className="intro-copy">
            <div className="eyebrow"><span className="eyebrow-line" /> {t("PUBLIC PROCUREMENT", language)} / {t("WARSAW", language)}</div>
            <h1>{t("From notice", language)}<br />{t("to", language)} <em>{t("supplier.", language)}</em></h1>
            <p>{t("See who bought what, which supplier was named, and the reported outcome. Open the original BZP notice for the source.", language)}</p>
            <div className="intro-actions">
              <a className="intro-primary" href="#case">{t("Explore one case", language)} <span aria-hidden="true">↓</span></a>
              <a href="#catalog">{t("Search the registry", language)} <span aria-hidden="true">→</span></a>
            </div>
          </div>
          <div className="intro-side-note">
            <span>{t("HOW TO READ THIS", language)}</span>
            <p>{t("One case.", language)}<br />{t("Three answers.", language)}<br />{t("One source.", language)}</p>
            <a href="#sources">{t("Where the data comes from", language)} <Symbol name="arrow" /></a>
          </div>
        </section>

        <CaseSpotlight data={data} language={language} selectedNode={selectedNode} loading={loading} error={error} dataset={dataset} onOpenMap={() => setMapExpanded(true)} onRetry={() => void loadGraph()} />

        {mapExpanded && <section className="workbench map-expanded" aria-label={t("Relationship explorer", language)}>
          <aside className="left-rail">
            <div className="rail-heading"><span>01 / {t("WARSAW", language)}</span><span>{t("READ ONLY", language)}</span></div>
            <div className="search-field">
              <Symbol name="search" />
              <input ref={mapSearchInput} name="search" value={query} onChange={(event) => { setQuery(event.target.value); setCatalogPage(1); setGraphOffset(0); setFocusTender(null); }} placeholder={t("Search the data", language)} aria-label={t("Search buyers, suppliers, or procurements", language)} />
              {query && <button aria-label={t("Clear search", language)} onClick={() => { setQuery(""); setCatalogPage(1); }}><Symbol name="close" /></button>}
              {!query && <kbd>⌘ / Ctrl K</kbd>}
            </div>

            <div className="rail-section">
              <div className="section-label"><span>{t("LAYERS", language)}</span><span className="section-count">03</span></div>
              {kinds.map((kind) => (
                <button key={kind.id} className={`filter-row ${visibleKinds.includes(kind.id) ? "filter-on" : ""}`} onClick={() => toggleKind(kind.id)} aria-pressed={visibleKinds.includes(kind.id)}>
                  <span className="filter-dot" style={{ "--dot-color": kind.color } as CSSProperties} />
                  <span>{t(kind.label, language)}</span>
                  <span className="filter-check">{visibleKinds.includes(kind.id) ? "✓" : ""}</span>
                </button>
              ))}
            </div>

            <div className="rail-section stories-section" id="stories">
              <div className="section-label"><span>{t("GUIDED PATHS", language)}</span><span className="section-count">{stories.length.toString().padStart(2, "0")}</span></div>
              {stories.map((story, index) => (
                <button key={story.id} className={`story-link ${activeStory?.id === story.id ? "story-active" : ""}`} onClick={() => openStory(story)}>
                  <span className="story-number">0{index + 1}</span>
                  <span className="story-link-copy"><strong>{t(story.title, language)}</strong><small>{story.minutes} {t("minutes", language)} <i>·</i> {t("demo", language)}</small></span>
                  <Symbol name="arrow" />
                </button>
              ))}
              {stories.length === 0 && <p className="muted-small">{t("Loading guided paths from the API.", language)}</p>}
            </div>

            <div className="rail-bottom" id="methodology">
              <span className="method-mark">i</span>
              <p><strong>{t("Sources matter.", language)}</strong> {t("Every claim and relationship should point to a document.", language)}</p>
              <a href="https://ezamowienia.gov.pl/pl/integracja/" target="_blank" rel="noreferrer">{t("About BZP sources", language)} <Symbol name="arrow" /></a>
            </div>
          </aside>

          <section className="graph-panel" aria-label={t("Relationship map", language)}>
            <div className="panel-toolbar">
              <div>
                <div className="panel-kicker">{t("RELATIONSHIP MAP", language)} <span>·</span> {dataset === "demo" ? t("DEMO SCENARIO", language) : t("BZP DATA", language)}</div>
                <h2>{activeStory ? t(activeStory.title, language) : t("Procurement flow", language)}</h2>
              </div>
              <div className="toolbar-actions">
                <label className="date-select data-select"><span>{t("DATASET", language)}</span><select name="dataset" value={dataset} onChange={(event) => { requestVersion.current += 1; setData(null); setCatalogData(null); setLoading(true); setDataset(event.target.value as "demo" | "live"); setActiveStory(null); setMobileDetailsOpen(false); setFocusTender(null); setGraphOffset(0); setCatalogPage(1); setCatalogOrderType(""); setSupplierFilter("all"); }} aria-label={t("Choose demo or BZP data", language)}>
                  <option value="demo">{t("Demo scenario", language)}</option>
                  <option value="live">{t("Imported BZP", language)}</option>
                </select></label>
                <label className="date-select"><span>{t("PERIOD", language)}</span><select name="period" value={dateWindow} onChange={(event) => { setDateWindow(event.target.value); setCatalogPage(1); setGraphOffset(0); setFocusTender(null); }} aria-label={t("Date range", language)}>
                  <option value="24m">{t("Last 2 years", language)}</option>
                  <option value="12m">{t("Last 12 months", language)}</option>
                  <option value="all">{t("All dates", language)}</option>
                </select></label>
                <button className="icon-button" onClick={() => void shareView()} aria-label={t("Copy view link", language)} title={t("Copy link", language)}><Symbol name="share" /></button>
                <button className="icon-button" onClick={exportGraph} aria-label={t("Export visible data", language)} title={t("Export JSON", language)}><Symbol name="download" /></button>
              </div>
            </div>
            {copied && <div className="copy-toast" role="status">{t("Link copied", language)}</div>}
            <div className="graph-summary"><span><i className="live-dot" /> {dataset === "demo" ? t("DEMO DATA", language) : t("BZP NOTICES", language)}</span><span>{t("LATEST EVENT", language)} · {formatDate(data?.latest_event_at, language)}</span></div>
            {activeStory && <div className="story-focus" role="status"><div><span>{t("SELECTED PATH", language)} · {activeStory.minutes} {t("minutes", language).toUpperCase()}</span><p>{t(activeStory.summary, language)}</p></div><button onClick={() => setActiveStory(null)} aria-label={t("Close path", language)}><Symbol name="close" /></button></div>}
            {focusTender && <div className="focus-record"><span>{t("Procurement selected from the registry", language)}</span><button onClick={() => { setFocusTender(null); setGraphOffset(0); }}>{t("Show latest", language)} ↗</button></div>}
            <div className="atlas-navigation" aria-label={t("Map navigation", language)}>
              <div className="atlas-position"><span>{focusTender ? t("SELECTED CASE", language) : `${t("VIEW", language)} ${String(Math.floor(graphOffset / graphPageSize) + 1).padStart(3, "0")}`}</span><strong>{data ? (focusTender ? t("1 PROCUREMENT", language) : `${Math.min(data.offset + 1, data.total_tenders)}–${Math.min(data.offset + data.limit, data.total_tenders)} / ${data.total_tenders.toLocaleString(language === "pl" ? "pl-PL" : "en-GB")}`) : t("LOADING...", language)}</strong></div>
              <div className="atlas-actions">
                <button onClick={() => showGraphPage(Math.max(0, graphOffset - graphPageSize))} disabled={loading || !!focusTender || graphOffset === 0} aria-label={t("Previous procurements", language)}>←</button>
                <button onClick={() => showGraphPage(graphOffset + graphPageSize)} disabled={loading || !!focusTender || !data || graphOffset + graphPageSize >= data.total_tenders} aria-label={t("Next procurements", language)}>→</button>
                <button className="atlas-shuffle" onClick={showRandomGraphPage} disabled={loading || !data || data.total_tenders <= graphPageSize}>{t("Random view", language)} ↗</button>
              </div>
            </div>
            <div className="mobile-scroll-hint" aria-hidden="true">{t("Swipe to explore the map", language)} <span>→</span></div>
            {loading && <div className="loading-line"><i /> {t("Loading graph…", language)}</div>}
            {error && <div className="api-error" role="alert"><strong>{t("Could not connect to the API.", language)}</strong><span>{t(error, language)}</span><button onClick={() => void loadGraph()}>{t("Try again", language)}</button></div>}
            {data && <GraphCanvas data={data} selectedId={selectedId} activeStory={activeStory} onSelect={selectNode} expanded={mapExpanded} onExpand={() => setMapExpanded(false)} language={language} />}
            {data && <EvidenceRoute data={data} selectedNode={selectedNode} onSelect={selectNode} language={language} />}
            <div className="graph-legend">
              <div>{kinds.map((kind) => <span key={kind.id}><i style={{ "--dot-color": kind.color } as CSSProperties} />{t(kind.label, language)}</span>)}</div>
              <span className="legend-hint">{t("SELECT A NODE TO SEE DETAILS", language)}</span>
            </div>
            <div className="panel-foot"><span>{t("RELATIONSHIPS COME FROM NOTICE RECORDS", language)}</span><span>{t("SOURCE · DATE · CONTEXT", language)}</span></div>
          </section>

          {mobileDetailsOpen && <button className="detail-backdrop" aria-label={t("Close details", language)} onClick={() => setMobileDetailsOpen(false)} />}
          <aside className={`detail-rail ${mobileDetailsOpen ? "details-open" : ""}`} aria-label={t("Selected item details", language)}>
            <div className="detail-header">
              <div className="section-label"><span>{t("02 / ENTITY DETAILS", language)}</span></div>
              <button className="mobile-close" onClick={() => setMobileDetailsOpen(false)} aria-label={t("Close details", language)}><Symbol name="close" /></button>
              {selectedNode ? <>
                <span className={`kind-pill kind-${selectedNode.kind}`}>{t(kindLabels[selectedNode.kind], language)}</span>
                <h3>{selectedNode.label}</h3>
                <p className="detail-subtitle">{t(selectedNode.subtitle, language)}</p>
              </> : <>
                <span className="kind-pill kind-empty">{t("SELECT A NODE", language)}</span>
                <h3>{t("Inspect the details", language)}</h3>
                <p className="detail-subtitle">{t("Select an item on the map to see its history and sources.", language)}</p>
              </>}
            </div>

            {selectedNode && <>
              <div className="detail-facts">
                <div><span>{t("LOCATION", language)}</span><strong>{t(selectedNode.city || "Not provided", language)}</strong></div>
                {selectedNode.details.reference && <div><span>{t("NOTICE NUMBER", language)}</span><strong className="mono-value">{selectedNode.details.reference}</strong></div>}
                {selectedNode.details.published_on && <div><span>{t("NOTICE DATE", language)}</span><strong>{formatDate(selectedNode.details.published_on, language)}</strong></div>}
                {selectedNode.details.sector && <div><span>{t("SECTOR", language)}</span><strong>{t(String(selectedNode.details.sector), language)}</strong></div>}
                {selectedNode.details.order_type && <div><span>{t("PROCUREMENT TYPE", language)}</span><strong>{orderTypeLabel(selectedNode.details.order_type, language)}</strong></div>}
                {selectedNode.details.cpv_code && <div><span>{t("CPV CODE", language)}</span><strong>{String(selectedNode.details.cpv_code).split(",")[0]}</strong></div>}
                {(selectedNode.details.nip || selectedNode.details.tax_id) && <div><span>{t("TAX ID", language)}</span><strong className="mono-value">{String(selectedNode.details.nip ?? selectedNode.details.tax_id)}</strong></div>}
              </div>

                {selectedNode.kind === "procurement" && selectedNode.is_demo && <div className="contract-card">
                <span>{t("CONTRACT VALUE", language)}</span><strong>{formatMoney(selectedNode.details.amount_pln, language)}</strong>
                <div className="contract-meta"><span>{t("Status", language)}</span><b>{t(String(selectedNode.details.status ?? "Not available"), language)}</b></div>
                <div className="contract-meta"><span>{t("Number of bids", language)}</span><b>{String(selectedNode.details.offers ?? t("Not provided", language))}</b></div>
              </div>}
              {selectedNode.kind === "procurement" && !selectedNode.is_demo && <div className="contract-card"><span>{t("REPORTED OUTCOME", language)}</span><strong className="result-value">{t(selectedNode.details.procedure_result === "zawarcieUmowy" ? "Contract awarded" : selectedNode.details.procedure_result ? "Outcome published" : "No information", language)}</strong><div className="contract-meta"><span>{t("Amount in this source", language)}</span><b>{selectedNode.details.amount_pln == null ? t("Not provided", language) : formatMoney(selectedNode.details.amount_pln, language)}</b></div></div>}

              <div className="detail-section">
                <div className="section-label"><span>{t("RELATIONSHIPS", language)}</span><span className="section-count">{relatedEdges.length.toString().padStart(2, "0")}</span></div>
                {relatedEdges.length ? relatedEdges.map((edge) => {
                  const otherId = edge.source_id === selectedNode.id ? edge.target_id : edge.source_id;
                  const otherNode = data?.nodes.find((node) => node.id === otherId);
                  return <button key={edge.id} className="relation-row" onClick={() => { if (otherNode) selectNode(otherNode); }}>
                    <span className="relation-icon">↗</span>
                    <span className="relation-copy"><strong>{t(edge.relationship_type, language)}</strong><small>{otherNode?.label ?? t("Related record", language)}</small></span>
                    <Symbol name="arrow" />
                  </button>;
                }) : <p className="muted-small">{t("No relationships in this view.", language)}</p>}
              </div>

              <div className="detail-section evidence-section">
                <div className="section-label"><span>{t("EVIDENCE AND SOURCES", language)}</span></div>
                {relatedEdges.map((edge) => <div className="evidence-card" key={edge.id}>
                  <div className="evidence-icon">↗</div>
                  <div><strong>{localizeSource(edge.evidence_label, language)}</strong><span>{formatDate(edge.occurred_at, language)}</span>
                    {edge.evidence_url ? <a href={edge.evidence_url} target="_blank" rel="noreferrer">{t("Open source document", language)} <Symbol name="arrow" /></a> : <small className="demo-source">{t("Fictional scenario · no source document", language)}</small>}
                  </div>
                </div>)}
                {relatedEdges.length === 0 && <p className="muted-small">{t("Select a related procurement to see its source.", language)}</p>}
              </div>

              {selectedNode.kind === "procurement" && Number(selectedNode.details.offers) === 1 && <div className="signal-card">
                <span className="signal-icon">!</span><div><b>{t("Worth checking", language)}</b><p>{t("The demo scenario has one bid. This illustrates a pattern, not an assessment of the procurement.", language)}</p></div>
              </div>}
            </>}
            <div className="detail-footer"><span>{t("PROCUREMENT GRAPH / 2026", language)}</span><span>{t("METHODOLOGY", language)} ↗</span></div>
          </aside>
        </section>}

        <Catalog
          data={catalogData}
          language={language}
          loading={catalogLoading}
          error={catalogError}
          query={query}
          inputRef={searchInput}
          onQuery={(value) => { setQuery(value); setCatalogPage(1); setGraphOffset(0); setFocusTender(null); }}
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
      </>}

        <section className="source-note" id="sources" aria-label={t("About the data", language)}>
          <div><span>{t("ABOUT THE DATA", language)}</span><h2>{t("What does this show?", language)}</h2></div>
          <p>{t(dataset === "demo" ? "The demo scenario contains fictional entities and procurements. It does not describe real relationships. Select the BZP dataset to explore source notices." : "The registry contains result notices for Warsaw buyers from the Polish Public Procurement Bulletin (BZP). The bundled snapshot covers September 1 to October 3, 2026. A map connection represents a relationship reported in a notice. A missing amount or supplier means that the available data does not provide it.", language)}</p>
          <a href="https://ezamowienia.gov.pl/pl/integracja/" target="_blank" rel="noreferrer">{t("BZP data source", language)} ↗</a>
        </section>

        <footer className="site-footer">
          <a className="footer-brand" href="#top">{t("PROCUREMENT GRAPH", language)}</a>
          <span>{t("Public records, linked to sources.", language)}</span>
          <span>{t("PUBLIC DATA", language)} <i>·</i> {t("WARSAW", language)}</span>
        </footer>
      </main>
    </div>
  );
}

export default App;
