import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { fetchGraph, fetchStories } from "./api";
import type { GraphData, GraphNode, NodeKind, Story } from "./types";

const kinds: { id: NodeKind; label: string; color: string }[] = [
  { id: "institution", label: "Instytucje", color: "#8c7cec" },
  { id: "procurement", label: "Postępowania", color: "#66a791" },
  { id: "company", label: "Wykonawcy", color: "#e5a26b" },
];

const kindLabels: Record<NodeKind, string> = {
  institution: "Instytucja",
  procurement: "Postępowanie",
  company: "Wykonawca",
};

function formatMoney(value: unknown): string {
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

function getNodePositions(nodes: GraphNode[]) {
  const columns: Record<NodeKind, GraphNode[]> = {
    institution: nodes.filter((node) => node.kind === "institution"),
    procurement: nodes.filter((node) => node.kind === "procurement"),
    company: nodes.filter((node) => node.kind === "company"),
  };
  const x: Record<NodeKind, number> = { institution: 154, procurement: 500, company: 846 };
  const positions = new Map<string, { x: number; y: number }>();
  (Object.keys(columns) as NodeKind[]).forEach((kind) => {
    const list = columns[kind];
    const top = list.length === 1 ? 340 : 150;
    const bottom = list.length === 1 ? 340 : 560;
    list.forEach((node, index) => {
      const y = list.length === 1 ? 340 : top + ((bottom - top) * index) / (list.length - 1);
      positions.set(node.id, { x: x[kind], y });
    });
  });
  return positions;
}

function shortLabel(label: string): string[] {
  const words = label.split(" ");
  const lines = [""];
  for (const word of words) {
    const last = lines.length - 1;
    if ((lines[last] + " " + word).trim().length > 23 && lines.length < 2) lines.push(word);
    else lines[last] = (lines[last] + " " + word).trim();
  }
  if (lines[1]?.length > 25) lines[1] = `${lines[1].slice(0, 23)}…`;
  if (lines[0].length > 25) lines[0] = `${lines[0].slice(0, 23)}…`;
  return lines;
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
}: {
  data: GraphData;
  selectedId: string | null;
  activeStory: Story | null;
  onSelect: (node: GraphNode) => void;
}) {
  const positions = useMemo(() => getNodePositions(data.nodes), [data.nodes]);
  const storyIds = new Set(activeStory?.node_ids ?? []);

  return (
    <div className="graph-canvas" aria-label="Interaktywny graf relacji">
      <svg viewBox="0 0 1000 680" role="img" aria-labelledby="graph-title graph-description">
        <title id="graph-title">Graf zamówień i podmiotów</title>
        <desc id="graph-description">Kliknij węzeł, aby zobaczyć szczegóły i dowody relacji.</desc>
        <defs>
          <pattern id="graph-grid" width="32" height="32" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="#c9c6bd" opacity=".56" />
          </pattern>
          <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
            <path d="M0 0 8 4 0 8z" fill="#96958d" />
          </marker>
        </defs>
        <rect width="1000" height="680" fill="url(#graph-grid)" />
        <g className="graph-columns" aria-hidden="true">
          <text x="154" y="56">ZAMAWIAJĄCY</text>
          <text x="500" y="56">POSTĘPOWANIA</text>
          <text x="846" y="56">WYKONAWCY</text>
        </g>
        <g className="edge-layer">
          {data.edges.map((edge, index) => {
            const source = positions.get(edge.source_id);
            const target = positions.get(edge.target_id);
            if (!source || !target) return null;
            const sx = source.x + (target.x > source.x ? 35 : -35);
            const tx = target.x + (source.x < target.x ? -38 : 38);
            const bend = (index % 2 === 0 ? -1 : 1) * Math.min(48, Math.abs(target.y - source.y) * 0.15);
            const path = `M ${sx} ${source.y} C ${(sx + tx) / 2} ${source.y + bend}, ${(sx + tx) / 2} ${target.y - bend}, ${tx} ${target.y}`;
            const isActive = storyIds.has(edge.source_id) && storyIds.has(edge.target_id);
            return (
              <g key={edge.id} className={`edge ${isActive ? "edge-active" : ""}`}>
                <path d={path} markerEnd="url(#arrowhead)" />
                <text x={(sx + tx) / 2} y={(source.y + target.y) / 2 - 8}>{edge.relationship_type}</text>
              </g>
            );
          })}
        </g>
        <g className="node-layer">
          {data.nodes.map((node) => {
            const point = positions.get(node.id);
            if (!point) return null;
            const selected = node.id === selectedId;
            const inStory = storyIds.has(node.id);
            const lines = shortLabel(node.label);
            return (
              <g
                key={node.id}
                className={`graph-node node-${node.kind} ${selected ? "is-selected" : ""} ${inStory ? "in-story" : ""}`}
                transform={`translate(${point.x} ${point.y})`}
                role="button"
                tabIndex={0}
                aria-label={`${kindLabels[node.kind]}: ${node.label}`}
                aria-pressed={selected}
                onClick={() => onSelect(node)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(node);
                  }
                }}
              >
                <circle className="node-halo" r="34" />
                <circle className="node-ring" r="25" />
                <circle className="node-dot" r="6" />
                <text className="node-kind" y="49">{kindLabels[node.kind].toUpperCase()}</text>
                <text className="node-name" y="69">
                  {lines.map((line, index) => <tspan key={index} x="0" dy={index === 0 ? 0 : 16}>{line}</tspan>)}
                </text>
                <title>{node.label}</title>
                <circle className="node-hit-area" r="48" fill="transparent" />
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
        <span>→</span><small>przepływ postępowania</small><span>↗</span>
      </div>
    </div>
  );
}

function App() {
  const [data, setData] = useState<GraphData | null>(null);
  const [stories, setStories] = useState<Story[]>([]);
  const [query, setQuery] = useState("");
  const [visibleKinds, setVisibleKinds] = useState<NodeKind[]>(["institution", "procurement", "company"]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeStory, setActiveStory] = useState<Story | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false);

  async function loadGraph(nextQuery = query, nextKinds = visibleKinds) {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchGraph({ query: nextQuery, kinds: nextKinds });
      setData(next);
      setSelectedId((current) => next.nodes.some((node) => node.id === current) ? current : next.nodes[0]?.id ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nie udało się pobrać danych.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchStories().then(setStories).catch(() => setStories([]));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadGraph(query, visibleKinds), 180);
    return () => window.clearTimeout(timer);
  }, [query, visibleKinds]);

  const selectedNode = data?.nodes.find((node) => node.id === selectedId) ?? null;
  const relatedEdges = data?.edges.filter((edge) => edge.source_id === selectedId || edge.target_id === selectedId) ?? [];
  const institutions = data?.nodes.filter((node) => node.kind === "institution").length ?? 0;
  const tenders = data?.nodes.filter((node) => node.kind === "procurement").length ?? 0;
  const awardTotal = data?.edges
    .filter((edge) => edge.relationship_type === "wybrano wykonawcę")
    .reduce((sum, edge) => sum + Number(edge.amount_pln ?? 0), 0) ?? 0;
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
    await navigator.clipboard?.writeText(url.toString());
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
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
    setActiveStory(story);
    setSelectedId(story.node_ids[0] ?? null);
    setMobileDetailsOpen(false);
  }

  function selectNode(node: GraphNode) {
    setSelectedId(node.id);
    setMobileDetailsOpen(true);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Jawny Ślad — strona główna">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span className="brand-wordmark">JAWNY<span>ŚLAD</span></span>
        </a>
        <nav className="top-nav" aria-label="Nawigacja główna">
          <a className="nav-active" href="#explore">Eksploruj</a>
          <a href="#stories">Ścieżki</a>
          <a href="#methodology">Metodologia</a>
        </nav>
        <div className="top-meta">
          <span className="data-status"><i /> DEMO / WARSZAWA</span>
          <a className="github-link" href="#methodology">O projekcie <Symbol name="arrow" /></a>
          <button className="mobile-menu" aria-label="Otwórz menu"><Symbol name="menu" /></button>
        </div>
      </header>

      <main id="top">
        <section className="intro-section" id="explore">
          <div className="intro-copy">
            <div className="eyebrow"><span className="eyebrow-line" /> PRACOWNIA DANYCH PUBLICZNYCH <span className="eyebrow-year">VOL. 01 / 2026</span></div>
            <h1>Każdy przetarg<br />zostawia <em>ślad.</em></h1>
            <p>Połącz instytucje, postępowania i wykonawców. Potem sprawdź, co naprawdę mówią źródła.</p>
          </div>
          <div className="intro-side-note">
            <span>W TEJ PRACOWNI</span>
            <p>Nie zgadujemy.<br />Pokazujemy, skąd<br />pochodzi każdy wniosek.</p>
            <a href="#methodology">Jak czytać dane <Symbol name="arrow" /></a>
          </div>
        </section>

        <section className="demo-ribbon" aria-label="Informacja o danych">
          <div className="ribbon-stamp">DEMO</div>
          <p><strong>Scenariusz demonstracyjny.</strong> Widoczne tu podmioty i zamówienia są fikcyjne. Nie opisują prawdziwych relacji.</p>
          <span className="ribbon-location">WARSZAWA <b>·</b> POLSKA</span>
        </section>

        <section className="metrics-row" aria-label="Statystyki widoku">
          <div className="metric-cell"><span>WĘZŁY W WIDOKU</span><strong>{data?.nodes.length ?? "—"}<small> elementów</small></strong></div>
          <div className="metric-cell"><span>INSTYTUCJE</span><strong>{institutions.toString().padStart(2, "0")}</strong></div>
          <div className="metric-cell"><span>POSTĘPOWANIA</span><strong>{tenders.toString().padStart(2, "0")}</strong></div>
          <div className="metric-cell metric-total"><span>WARTOŚĆ WIDOCZNYCH UMÓW</span><strong>{formatMoney(awardTotal)}</strong></div>
          <div className="metric-footnote">Wartości z przykładowych rekordów demo</div>
        </section>

        <section className="workbench" aria-label="Eksplorator powiązań">
          <aside className="left-rail">
            <div className="rail-heading"><span>01 / WARSZAWA</span><button aria-label="Ustawienia widoku">•••</button></div>
            <div className="search-field">
              <Symbol name="search" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Szukaj w danych" aria-label="Szukaj instytucji, firmy lub postępowania" />
              {query && <button aria-label="Wyczyść wyszukiwanie" onClick={() => setQuery("")}><Symbol name="close" /></button>}
              {!query && <kbd>⌘ K</kbd>}
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
                <div className="panel-kicker">MAPA RELACJI <span>·</span> SCENARIUSZ DEMO</div>
                <h2>{activeStory?.title ?? "Przepływ zamówień"}</h2>
              </div>
              <div className="toolbar-actions">
                <button className="icon-button" onClick={() => void shareView()} aria-label="Kopiuj link do widoku" title="Kopiuj link"><Symbol name="share" /></button>
                <button className="icon-button" onClick={exportGraph} aria-label="Eksportuj widoczne dane" title="Eksportuj JSON"><Symbol name="download" /></button>
              </div>
            </div>
            {copied && <div className="copy-toast" role="status">Link skopiowany</div>}
            <div className="graph-summary"><span><i className="live-dot" /> DANE DEMONSTRACYJNE</span><span>OSTATNIA AKTUALIZACJA —</span></div>
            {loading && <div className="loading-line"><i /> Ładowanie grafu…</div>}
            {error && <div className="api-error" role="alert"><strong>Nie mogę połączyć się z API.</strong><span>{error}</span><button onClick={() => void loadGraph()}>Spróbuj ponownie</button></div>}
            {data && <GraphCanvas data={data} selectedId={selectedId} activeStory={activeStory} onSelect={selectNode} />}
            <div className="graph-legend">
              <div>{kinds.map((kind) => <span key={kind.id}><i style={{ "--dot-color": kind.color } as CSSProperties} />{kind.label}</span>)}</div>
              <span className="legend-hint">KLIKNIJ WĘZEŁ, ABY ZOBACZYĆ SZCZEGÓŁY</span>
            </div>
            <div className="panel-foot"><span>RELACJA WYNIKA Z REKORDU POSTĘPOWANIA</span><span>ŹRÓDŁO · DATA · KONTEKST</span></div>
          </section>

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
              </div>

              {selectedNode.kind === "procurement" && <div className="contract-card">
                <span>WARTOŚĆ UMOWY</span><strong>{formatMoney(selectedNode.details.amount_pln)}</strong>
                <div className="contract-meta"><span>Status</span><b>{String(selectedNode.details.status ?? "Brak danych")}</b></div>
                <div className="contract-meta"><span>Liczba ofert</span><b>{String(selectedNode.details.offers ?? "Nie podano")}</b></div>
              </div>}

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

        <footer className="site-footer">
          <a className="footer-brand" href="#top">JAWNY ŚLAD</a>
          <span>Otwieramy dane. Pokazujemy dowody.</span>
          <span>PROJEKT PORTFOLIO <i>·</i> 2026</span>
        </footer>
      </main>
    </div>
  );
}

export default App;
