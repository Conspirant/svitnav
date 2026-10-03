import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpDown, Footprints, Layers, LocateFixed, MapPin, Maximize, Navigation, Search, X, ZoomIn, ZoomOut, Accessibility, PencilRuler } from "lucide-react";
import { GridPattern, ObjectShape, sortForRender } from "@/components/map/shapes";
import { useViewport } from "@/components/map/viewport";
import { loadPublished } from "@/lib/map/store";
import { buildGraph, findRoute, pointsToSmoothPath, type Route as NavRoute } from "@/lib/map/pathfind";
import { SEARCHABLE, type MapObject } from "@/lib/map/types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SVIT NAV — Find any room on campus" },
      { name: "description", content: "Search rooms, labs and facilities at Sai Vidya Institute of Technology and get indoor walking directions across floors." },
      { property: "og:title", content: "SVIT NAV — Find any room on campus" },
      { property: "og:description", content: "Indoor walking directions for Sai Vidya Institute of Technology, Bengaluru." },
    ],
  }),
  component: MapPage,
});

function PlacePicker({ label, value, places, floorName, onPick, icon, currentFloorId }: {
  label: string; value: MapObject | null; places: MapObject[]; floorName: (id: string) => string;
  onPick: (o: MapObject | null) => void; icon: React.ReactNode; currentFloorId?: string;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const results = useMemo(() => {
    const s = q.toLowerCase().trim();
    let list = places;

    // Quick category filters
    if (typeFilter === "room") list = list.filter((p) => p.type === "room");
    else if (typeFilter === "lab") list = list.filter((p) => p.type === "lab");
    else if (typeFilter === "restroom") list = list.filter((p) => p.type === "restroom");
    else if (typeFilter === "entrance") list = list.filter((p) => p.type === "entrance" || p.type === "poi");

    if (s) {
      list = list.filter((p) => {
        const n = p.name.toLowerCase();
        const c = (p.category ?? "").toLowerCase();
        const t = p.type.toLowerCase();
        const g = (p.gender ?? "").toLowerCase();
        if (n.includes(s) || c.includes(s) || t.includes(s) || g.includes(s)) return true;
        if (s === "girls" || s === "girl" || s === "women" || s === "ladies") {
          return p.type === "restroom" && (g === "girls" || /girl|women|ladies/i.test(n) || /girl|women|ladies/i.test(c));
        }
        if (s === "boys" || s === "boy" || s === "men" || s === "gents") {
          return p.type === "restroom" && (g === "boys" || /boy|men|gents/i.test(n) || /boy|men|gents/i.test(c));
        }
        if (s === "washroom" || s === "toilet" || s === "restroom") {
          return p.type === "restroom" || /restroom|washroom|toilet/i.test(n);
        }
        if (s === "lab" || s === "laboratory") {
          return p.type === "lab" || /lab/i.test(n) || /lab/i.test(c);
        }
        return false;
      });
    }

    // Sort: places on current floor first, then natural alphanumeric sorting (Room 1, 2, 3... 10)
    return list.slice().sort((a, b) => {
      if (currentFloorId) {
        const aCur = a.floorId === currentFloorId ? 0 : 1;
        const bCur = b.floorId === currentFloorId ? 0 : 1;
        if (aCur !== bCur) return aCur - bCur;
      }
      return a.name.localeCompare(b.name, undefined, { numeric: true });
    }).slice(0, 80); // Show up to 80 scrollable items so all rooms are accessible
  }, [q, places, typeFilter, currentFloorId]);

  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-md border border-border bg-secondary px-3 py-2 focus-within:border-ring">
        {icon}
        <input className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" placeholder={label}
          value={open ? q : value?.name ?? ""} onFocus={() => { setOpen(true); setQ(""); }} onBlur={() => setTimeout(() => setOpen(false), 200)}
          onChange={(e) => setQ(e.target.value)} />
        {value && <button onClick={() => onPick(null)} className="text-muted-foreground hover:text-foreground"><X size={14} /></button>}
      </div>
      {open && (
        <div className="panel absolute z-20 mt-1 max-h-80 w-full overflow-y-auto p-1.5 shadow-2xl">
          {/* Quick Filter Pills */}
          <div className="flex items-center gap-1 overflow-x-auto border-b border-border/50 pb-1.5 pt-0.5 text-[11px]">
            {[
              { id: "all", label: "All" },
              { id: "room", label: "Rooms" },
              { id: "lab", label: "Labs" },
              { id: "restroom", label: "Restrooms" },
              { id: "entrance", label: "Entrances" },
            ].map((f) => (
              <button
                key={f.id}
                onMouseDown={(e) => { e.preventDefault(); setTypeFilter(f.id); }}
                className={`rounded px-2 py-0.5 text-xs transition-colors shrink-0 ${
                  typeFilter === f.id ? "bg-primary text-primary-foreground font-medium" : "bg-secondary text-muted-foreground hover:text-foreground"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="mt-1 space-y-0.5">
            {results.length ? results.map((p) => {
              let iconEmoji = "🚪";
              if (p.type === "lab") iconEmoji = "🧪";
              else if (p.type === "restroom") iconEmoji = p.gender === "girls" ? "🚺" : p.gender === "boys" ? "🚹" : "🚻";
              else if (p.type === "entrance") iconEmoji = "📍";
              else if (p.type === "stairs" || p.type === "elevator") iconEmoji = "🪜";

              // Disambiguate if multiple places have identical names on the same floor
              const hasDuplicateName = places.some((x) => x.id !== p.id && x.name.trim().toLowerCase() === p.name.trim().toLowerCase() && x.floorId === p.floorId);
              let disambiguation = "";
              if (hasDuplicateName) {
                const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
                let nearDist = Infinity, nearName = "";
                for (const o of places) {
                  if (o.id === p.id || o.name === p.name) continue;
                  const d = Math.hypot(o.x + o.w / 2 - cx, o.y + o.h / 2 - cy);
                  if (d < nearDist && d < 18) {
                    nearDist = d;
                    nearName = o.name;
                  }
                }
                if (nearName) disambiguation = `Near ${nearName}`;
              }

              return (
                <button
                  key={p.id}
                  onMouseDown={() => { onPick(p); setOpen(false); }}
                  className="flex w-full items-center justify-between rounded px-2.5 py-1.5 text-left text-sm hover:bg-accent"
                >
                  <div className="flex items-center gap-2 truncate">
                    <span className="text-xs">{iconEmoji}</span>
                    <span className="truncate font-medium">{p.name}</span>
                    {disambiguation && (
                      <span className="text-[11px] text-muted-foreground/80 font-normal">({disambiguation})</span>
                    )}
                  </div>
                  <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                    {p.category ? `${p.category} · ` : ""}{floorName(p.floorId)}
                  </span>
                </button>
              );
            }) : (
              <div className="px-3 py-4 text-center text-sm text-muted-foreground">No matching places found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MapPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ["published-map"], queryFn: loadPublished });
  const doc = data?.doc ?? null;
  const [floorId, setFloorId] = useState("");
  const [from, setFrom] = useState<MapObject | null>(null);
  const [to, setTo] = useState<MapObject | null>(null);
  const [avoidStairs, setAvoidStairs] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const { view, setView, fit, zoomBy } = useViewport(svgRef);
  const drag = useRef<{ sx: number; sy: number; vx: number; vy: number; moved: boolean } | null>(null);

  const places = useMemo(() => (doc?.objects ?? []).filter((o) => SEARCHABLE.includes(o.type) && o.name.trim()).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })), [doc]);
  const graph = useMemo(() => (doc ? buildGraph(doc) : null), [doc]);
  const floorName = (id: string) => doc?.floors.find((f) => f.id === id)?.name ?? "";

  useEffect(() => {
    if (!doc) return;
    const f = [...doc.floors].sort((a, b) => a.level - b.level)[0];
    setFloorId(f.id);
    const entrance = places.find((p) => /entrance/i.test(p.name) || /entrance/i.test(p.category ?? ""));
    if (entrance) setFrom(entrance);
    setTimeout(() => fit(doc.objects.filter((o) => o.floorId === f.id)), 30);
  }, [doc]); // eslint-disable-line react-hooks/exhaustive-deps

  const route: NavRoute | null | undefined = useMemo(() => {
    if (!doc || !graph || !from || !to || from.id === to.id) return undefined;
    return findRoute(doc, graph, from, to, { avoidStairs });
  }, [doc, graph, from, to, avoidStairs]);

  useEffect(() => { if (to) setFloorId(from && route ? from.floorId : to.floorId); }, [to, from, route]);

  const floorObjs = useMemo(() => sortForRender(doc?.objects.filter((o) => o.floorId === floorId) ?? []), [doc, floorId]);
  const leg = route?.legs.find((l) => l.floorId === floorId);
  const otherFloors = new Set(route?.legs.map((l) => l.floorId));

  const steps = useMemo(() => {
    if (!route || !from || !to) return [];
    const out: { text: string; floorId: string; icon: "walk" | "stairs" | "lift" | "pin" }[] = [];
    route.legs.forEach((l, i) => {
      const t = route.transitions[i];
      const where = i === 0 ? `from ${from.name}` : `on ${floorName(l.floorId)}`;
      out.push({ text: `Walk ${Math.round(l.length)} m ${where}${t ? ` to ${t.via.name}` : ` to ${to.name}`}`, floorId: l.floorId, icon: "walk" });
      if (t) out.push({ text: `Take ${t.via.name} to ${floorName(t.toFloorId)}`, floorId: t.toFloorId, icon: t.via.type === "stairs" || t.via.type === "escalator" ? "stairs" : "lift" });
    });
    out.push({ text: `Arrive at ${to.name}`, floorId: to.floorId, icon: "pin" });
    return out;
  }, [route, from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  const onDown = (e: React.PointerEvent) => { (e.target as Element).setPointerCapture?.(e.pointerId); drag.current = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false }; };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 4) d.moved = true;
    if (d.moved) setView((v) => ({ ...v, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy }));
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current; drag.current = null;
    if (d && !d.moved) {
      const el = document.elementsFromPoint(e.clientX, e.clientY).find((x) => x.closest("[data-id]"));
      const id = el?.closest("[data-id]")?.getAttribute("data-id");
      const o = places.find((p) => p.id === id);
      if (o) setTo(o);
    }
  };

  const minutes = route ? Math.max(1, Math.round(route.total / 1.3 / 60 + route.transitions.length * 0.5)) : 0;

  return (
    <div className="relative h-screen overflow-hidden bg-map-bg text-foreground">
      <svg ref={svgRef} className="absolute inset-0 h-full w-full touch-none select-none" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
        <GridPattern />
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          <rect x={-500} y={-500} width={2000} height={2000} fill="url(#grid-major)" opacity={0.5} />
          {floorObjs.map((o) => <ObjectShape key={o.id} o={o} k={view.k} highlight={o.id === to?.id || o.id === from?.id} />)}
          {leg && (() => {
            const pathD = pointsToSmoothPath(leg.points, 1.0);
            const startPt = leg.points[0];
            const endPt = leg.points[leg.points.length - 1];
            return (
              <g pointerEvents="none">
                {/* 1. Google Maps style outer casing / road halo */}
                <path d={pathD} fill="none" stroke="#1e3a8a" strokeOpacity={0.4} strokeWidth={14} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                
                {/* 2. Google Maps vibrant solid navigation line */}
                <path d={pathD} fill="none" stroke="#2563eb" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />

                {/* 3. Google Maps animated direction pulse / track */}
                <path d={pathD} fill="none" stroke="#93c5fd" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="5 9" vectorEffect="non-scaling-stroke" className="route-dash" />

                {/* 4. Google Maps Start Puck ("You are here" / start position) */}
                <g transform={`translate(${startPt[0]}, ${startPt[1]})`}>
                  {/* Radar pulse wave */}
                  <circle cx={0} cy={0} r={11 / view.k} fill="#3b82f6" opacity={0.25} />
                  {/* White ring */}
                  <circle cx={0} cy={0} r={6.5 / view.k} fill="#ffffff" />
                  {/* Blue core dot */}
                  <circle cx={0} cy={0} r={4.5 / view.k} fill="#2563eb" />
                </g>

                {/* 5. Google Maps Destination Teardrop Pin */}
                <g transform={`translate(${endPt[0]}, ${endPt[1]}) scale(${1 / view.k})`}>
                  {/* Pin drop shadow */}
                  <ellipse cx={0} cy={1.5} rx={5} ry={2.5} fill="rgba(0,0,0,0.45)" />
                  {/* Red pin body */}
                  <path d="M 0,-20 C -5.5,-20 -10,-15.5 -10,-10 C -10,-4 0,0 0,0 C 0,0 10,-4 10,-10 C 10,-15.5 5.5,-20 0,-20 Z" fill="#ef4444" stroke="#7f1d1d" strokeWidth={1} />
                  {/* White pin center */}
                  <circle cx={0} cy={-10.5} r={3.8} fill="#ffffff" />
                </g>
              </g>
            );
          })()}
        </g>
      </svg>

      {/* Search panel */}
      <div className="absolute left-4 top-4 z-10 w-[min(380px,calc(100vw-2rem))] space-y-3">
        <div className="panel p-4 shadow-2xl">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 font-semibold tracking-tight">
              <span className="flex h-7 w-7 items-center justify-center rounded bg-primary text-primary-foreground"><Navigation size={14} /></span>
              SVIT NAV
            </div>
            <Link to="/admin/editor" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"><PencilRuler size={12} /> Edit map</Link>
          </div>
          {isLoading && <p className="text-sm text-muted-foreground">Loading campus map…</p>}
          {error && <p className="text-sm text-destructive">Could not load the map. Please refresh.</p>}
          {!isLoading && !doc && !error && (
            <p className="text-sm text-muted-foreground">No map has been published yet. <Link to="/admin/editor" className="text-primary underline">Open the editor</Link> and press Publish.</p>
          )}
          {doc && (
            <div className="space-y-2">
              <PlacePicker label="Starting point" value={from} places={places} floorName={floorName} onPick={setFrom} currentFloorId={floorId} icon={<LocateFixed size={15} className="text-primary" />} />
              <PlacePicker label="Where to? Search rooms, labs…" value={to} places={places} floorName={floorName} onPick={setTo} currentFloorId={floorId} icon={<Search size={15} className="text-muted-foreground" />} />
              <div className="flex items-center justify-between pt-1">
                <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={avoidStairs} onChange={(e) => setAvoidStairs(e.target.checked)} className="accent-[var(--primary)]" />
                  <Accessibility size={13} /> Step-free (lifts & ramps)
                </label>
                <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => { const f = from; setFrom(to); setTo(f); }}>Swap</button>
              </div>
            </div>
          )}
        </div>

        {from && to && route === null && (
          <div className="panel p-4 text-sm text-muted-foreground">No walkable route found between these places{avoidStairs ? " without stairs" : ""}.</div>
        )}
        {route && (
          <div className="panel p-4 shadow-2xl">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold text-primary">{minutes} min</span>
              <span className="font-mono text-xs text-muted-foreground">{Math.round(route.total)} m · {route.transitions.length} floor change{route.transitions.length === 1 ? "" : "s"}</span>
            </div>
            <ol className="mt-3 space-y-1">
              {steps.map((s, i) => (
                <li key={i}>
                  <button onClick={() => setFloorId(s.floorId)} className="flex w-full items-start gap-3 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                    style={s.floorId === floorId ? { color: "var(--foreground)" } : { color: "var(--muted-foreground)" }}>
                    <span className="mt-0.5 text-primary">
                      {s.icon === "walk" ? <Footprints size={14} /> : s.icon === "pin" ? <MapPin size={14} /> : s.icon === "stairs" ? <Layers size={14} /> : <ArrowUpDown size={14} />}
                    </span>
                    {s.text}
                  </button>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {/* Floor switcher */}
      {doc && (
        <div className="panel absolute right-4 top-4 z-10 flex flex-col overflow-hidden">
          {[...doc.floors].sort((a, b) => b.level - a.level).map((f) => (
            <button key={f.id} onClick={() => setFloorId(f.id)} title={f.name}
              className="relative px-3 py-2 text-left text-sm hover:bg-accent"
              style={f.id === floorId ? { background: "var(--primary)", color: "var(--primary-foreground)" } : undefined}>
              {f.name}
              {otherFloors.has(f.id) && f.id !== floorId && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-primary" />}
            </button>
          ))}
        </div>
      )}
      <div className="absolute bottom-4 right-4 z-10 flex flex-col gap-1">
        <button className="btn" onClick={() => zoomBy(1.3)} aria-label="Zoom in"><ZoomIn size={14} /></button>
        <button className="btn" onClick={() => zoomBy(1 / 1.3)} aria-label="Zoom out"><ZoomOut size={14} /></button>
        <button className="btn" onClick={() => fit(floorObjs)} aria-label="Fit map"><Maximize size={14} /></button>
      </div>
      {doc && <div className="label absolute bottom-4 left-4 z-10">{floorName(floorId)} · tap a room to set it as destination</div>}
    </div>
  );
}
