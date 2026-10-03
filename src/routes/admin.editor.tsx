import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MousePointer2, Square, Rows3, Footprints, ArrowUpDown, Minus, Pentagon, DoorOpen, MapPin,
  LayoutGrid, Bath, ChevronsUp, TrendingUp, LogIn, Ban, Type, Info, RotateCw, RotateCcw, Expand, Shrink,
  Save, Upload, Download, Rocket, Undo2, Redo2, Copy, Trash2, Plus, Maximize, ZoomIn, ZoomOut, Eye, Layers,
  Lock, Unlock, Magnet, Grid3X3, CheckCircle2, Clock, Loader2, AlertTriangle, FlaskConical, Palette,
} from "lucide-react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { GridPattern, ObjectShape, sortForRender } from "@/components/map/shapes";
import { useViewport } from "@/components/map/viewport";
import { bboxOf, CONNECTORS, emptyDoc, TYPE_LABEL, uid, type Floor, type MapDoc, type MapObject, type ObjType } from "@/lib/map/types";
import { sampleDoc } from "@/lib/map/sample";
import { loadDraft, publishDoc, saveDraft } from "@/lib/map/store";
import { importCSV, importGeoJSON } from "@/lib/map/importers";

export const Route = createFileRoute("/admin/editor")({
  head: () => ({
    meta: [
      { title: "Map Editor — SVIT NAV" },
      { name: "description", content: "Draw floors, rooms, corridors, stairs and lifts for the SVIT indoor map." },
      { property: "og:title", content: "Map Editor — SVIT NAV" },
      { property: "og:description", content: "Build and publish the SVIT indoor campus map." },
    ],
  }),
  ssr: false,
  component: Editor,
});

type Tool = "select" | ObjType;
type ToolDef = { id: Tool; icon: typeof Square; key: string; label: string; how: string; nav: string };
const TOOLS: ToolDef[] = [
  { id: "select", icon: MousePointer2, key: "v", label: "Select / pan", how: "Click a shape to select it. Shift+click or drag empty space to multi-select. Drag to move selected together. Drag corner handles to resize. Drag empty space, hold Space, or hold Ctrl to pan. Ctrl+C/V to copy/paste, Ctrl+D duplicates, Delete removes.", nav: "Doesn't change the map by itself." },
  { id: "outline", icon: Pentagon, key: "o", label: "Building outline", how: "Click each corner of the building, then double-click or press Enter to close it. Lock the outline from the top bar so it doesn't move accidentally.", nav: "Visual only — people can't walk on it. Draw corridors and rooms inside it." },
  { id: "corridor", icon: Rows3, key: "c", label: "Corridor", how: "Drag a rectangle along a hallway. Live width & height show in meters.", nav: "Walkable. The backbone of every route — rooms must touch a corridor (or a door) to be reachable." },
  { id: "room", icon: Square, key: "r", label: "Room", how: "Drag a rectangle. Give it a name and category (Classroom, Office, Dept…) in the right panel.", nav: "Walkable and searchable — students can pick it as a destination." },
  { id: "lab", icon: FlaskConical, key: "k", label: "Laboratory / Lab", how: "Drag a rectangle or click. Dedicated science lab styling with beaker icon.", nav: "Walkable and searchable — students can search for labs specifically." },
  { id: "lobby", icon: LayoutGrid, key: "l", label: "Lobby / open area", how: "Drag over foyers, atriums, courtyards or any open space.", nav: "Walkable and searchable. Routes cut straight across it." },
  { id: "restroom", icon: Bath, key: "t", label: "Restroom", how: "Drag a rectangle. Mark as Boys (🚹), Girls (🚺), Unisex or Accessible in the panel.", nav: "Walkable and searchable — shows up with gender badges when students search \"restroom\"." },
  { id: "entrance", icon: LogIn, key: "n", label: "Entrance / exit", how: "Drag a small rectangle where a doorway to outside is, touching a corridor or lobby.", nav: "Walkable and searchable — a good starting point for visitors." },
  { id: "door", icon: DoorOpen, key: "d", label: "Door", how: "Click near any room to auto-connect a visible preset door, or drag across a wall.", nav: "Opens a gap in walls so routes can pass. High-visibility preset." },
  { id: "wall", icon: Minus, key: "w", label: "Wall", how: "Click points along the wall, double-click or Enter to finish. Live meter length shows while drawing.", nav: "Blocks walking. Add a Door where people can cross it." },
  { id: "obstacle", icon: Ban, key: "b", label: "Obstacle", how: "Drag over pillars, construction, locked zones or anything people can't walk through.", nav: "Blocks walking — routes go around it, even over corridors." },
  { id: "stairs", icon: Footprints, key: "s", label: "Stairs", how: "Drag a rectangle on each floor at the same spot. Give each copy the same Link ID (e.g. S1).", nav: "Connects floors with the same Link ID. Skipped when \"Step-free\" is on." },
  { id: "elevator", icon: ArrowUpDown, key: "e", label: "Elevator", how: "Drag on each floor; use the same Link ID (e.g. E1) on all of them.", nav: "Connects floors. Step-free." },
  { id: "escalator", icon: ChevronsUp, key: "x", label: "Escalator", how: "Drag on both floors; same Link ID on both.", nav: "Connects floors. Skipped when \"Step-free\" is on." },
  { id: "ramp", icon: TrendingUp, key: "m", label: "Ramp", how: "Drag on both levels it connects; same Link ID on both. For a ramp on one floor, just leave it unlinked.", nav: "Walkable, step-free floor connection." },
  { id: "poi", icon: MapPin, key: "p", label: "Point of interest", how: "Click/drag to drop a pin: ATM, water cooler, notice board, help desk… Place it on a walkable area.", nav: "Searchable. Routes lead to the nearest walkable spot." },
  { id: "label", icon: Type, key: "a", label: "Text label", how: "Drag a box, then type the text in Name (e.g. \"BLOCK A\", \"Parking\"). Text size follows box height.", nav: "Visual only — not walkable, not searchable." },
];
const RECT_TOOLS: Tool[] = ["room", "lab", "corridor", "lobby", "restroom", "entrance", "door", "obstacle", "stairs", "elevator", "escalator", "ramp", "label"];
const DEFAULT_NAME: Partial<Record<ObjType, string>> = { room: "Room", lab: "Lab", corridor: "Corridor", lobby: "Lobby", restroom: "Restroom", entrance: "Entrance", stairs: "Stairs", elevator: "Lift", escalator: "Escalator", ramp: "Ramp", label: "Label" };
const CONN_PREFIX: Partial<Record<ObjType, string>> = { stairs: "S", elevator: "E", escalator: "X", ramp: "R" };

const COLOR_PRESETS = [
  { label: "Default Theme", value: "" },
  { label: "Ocean Blue", value: "#1d4ed8" },
  { label: "Sky Blue", value: "#0284c7" },
  { label: "Teal Cyan", value: "#0d9488" },
  { label: "Emerald Green", value: "#15803d" },
  { label: "Lime", value: "#4d7c0f" },
  { label: "Amber Warm", value: "#b45309" },
  { label: "Orange", value: "#c2410c" },
  { label: "Coral Rose", value: "#be123c" },
  { label: "Purple", value: "#6d28d9" },
  { label: "Indigo", value: "#4338ca" },
  { label: "Dark Slate", value: "#334155" },
];

type Drag =
  | { mode: "pan"; sx: number; sy: number; vx: number; vy: number }
  | { mode: "move"; wx: number; wy: number; origs: MapObject[] }
  | { mode: "resize"; anchor: [number, number]; orig: MapObject; handle?: string }
  | { mode: "rotate"; c: [number, number]; a0: number; orig: MapObject }
  | { mode: "vertex"; i: number; orig: MapObject }
  | { mode: "draw"; start: [number, number]; cur: [number, number] }
  | { mode: "box-select"; start: [number, number]; cur: [number, number]; shift: boolean; initialSel: string[] };

function transformObj(o: MapObject, nx: number, ny: number, nw: number, nh: number): MapObject {
  const points = o.points?.map(([px, py]) => [
    +(nx + (o.w ? ((px - o.x) / o.w) * nw : 0)).toFixed(2),
    +(ny + (o.h ? ((py - o.y) / o.h) * nh : 0)).toFixed(2),
  ] as [number, number]);
  return { ...o, x: nx, y: ny, w: nw, h: nh, points };
}

const POINTLIKE: ObjType[] = ["poi", "label"];
const r2 = (v: number) => +v.toFixed(2);
function cornersOf(o: MapObject): [number, number][] {
  return o.points?.length ? o.points : [[o.x, o.y], [o.x + o.w, o.y], [o.x + o.w, o.y + o.h], [o.x, o.y + o.h]];
}
/** Rotate around (cx, cy) by deg. Rectangles become polygons so the exact shape is kept. */
function rotateObj(o: MapObject, deg: number, cx: number, cy: number): MapObject {
  const a = (deg * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
  const rot = ([x, y]: [number, number]): [number, number] => [r2(cx + (x - cx) * cos - (y - cy) * sin), r2(cy + (x - cx) * sin + (y - cy) * cos)];
  if (POINTLIKE.includes(o.type)) { const [nx, ny] = rot([o.x + o.w / 2, o.y + o.h / 2]); return { ...o, x: r2(nx - o.w / 2), y: r2(ny - o.h / 2) }; }
  const pts = cornersOf(o).map(rot);
  return { ...o, points: pts, ...bboxOf(pts) };
}
function scaleObj(o: MapObject, f: number, cx: number, cy: number): MapObject {
  const sc = ([x, y]: [number, number]): [number, number] => [r2(cx + (x - cx) * f), r2(cy + (y - cy) * f)];
  const [nx, ny] = sc([o.x, o.y]);
  return { ...o, x: nx, y: ny, w: r2(o.w * f), h: r2(o.h * f), points: o.points?.map(sc) };
}
function centerOfAll(objs: MapObject[]): [number, number] {
  const minX = Math.min(...objs.map((o) => o.x)), minY = Math.min(...objs.map((o) => o.y));
  const maxX = Math.max(...objs.map((o) => o.x + o.w)), maxY = Math.max(...objs.map((o) => o.y + o.h));
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

function TransformControls({ onRotate, onScale }: { onRotate: (deg: number) => void; onScale: (f: number) => void }) {
  const [deg, setDeg] = useState("45");
  const [pct, setPct] = useState("150");
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        <span className="w-12 text-xs text-muted-foreground">Rotate</span>
        <button className="btn px-2" onClick={() => onRotate(-15)} title="Rotate 15° left ([)"><RotateCcw size={13} /> 15°</button>
        <button className="btn px-2" onClick={() => onRotate(15)} title="Rotate 15° right (])"><RotateCw size={13} /> 15°</button>
        <button className="btn px-2" onClick={() => onRotate(90)} title="Rotate 90°">90°</button>
        <input className="field w-14 px-1 font-mono" type="number" value={deg} onChange={(e) => setDeg(e.target.value)} />
        <button className="btn px-2" onClick={() => { const v = Number(deg); if (v) onRotate(v); }}>Apply</button>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="w-12 text-xs text-muted-foreground">Size</span>
        <button className="btn px-2" onClick={() => onScale(1 / 1.1)} title="Shrink 10% (-)"><Shrink size={13} /></button>
        <button className="btn px-2" onClick={() => onScale(1.1)} title="Enlarge 10% (=)"><Expand size={13} /></button>
        <button className="btn px-2" onClick={() => onScale(2)}>×2</button>
        <input className="field w-14 px-1 font-mono" type="number" value={pct} onChange={(e) => setPct(e.target.value)} />
        <span className="text-xs text-muted-foreground">%</span>
        <button className="btn px-2" onClick={() => { const v = Number(pct); if (v > 0) onScale(v / 100); }}>Apply</button>
      </div>
    </div>
  );
}

function Editor() {
  const [doc, setDocRaw] = useState<MapDoc | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [floorId, setFloorId] = useState("");
  const [tool, setTool] = useState<Tool>("select");

  // Multi-select state
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const sel = selectedIds.length === 1 ? selectedIds[0] : null;
  const setSel = useCallback((id: string | null) => {
    setSelectedIds(id ? [id] : []);
  }, []);

  // Lock and snap toggles
  const [outlineLocked, setOutlineLocked] = useState(true);
  const [snapping, setSnapping] = useState(true);
  const [showGrid, setShowGrid] = useState(true);

  // Autosave status
  const [autoSaveStatus, setAutoSaveStatus] = useState<"saved" | "saving" | "unsaved" | "error">("saved");
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  const [drag, setDrag] = useState<Drag | null>(null);
  const [poly, setPoly] = useState<[number, number][]>([]);
  const [cursor, setCursor] = useState<[number, number]>([0, 0]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const [showHelp, setShowHelp] = useState(true);
  const [shape, setShape] = useState<"rect" | "poly" | "circle">("rect");
  const [resizeMode, setResizeMode] = useState<"box" | "polygon">("box");
  const polyMode = tool === "wall" || tool === "outline" || (RECT_TOOLS.includes(tool) && shape === "poly");
  const past = useRef<MapDoc[]>([]);
  const future = useRef<MapDoc[]>([]);
  const svgRef = useRef<SVGSVGElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const space = useRef(false);
  const clipboard = useRef<MapObject[]>([]);
  const { view, setView, toWorld, fit, zoomBy } = useViewport(svgRef);

  const snapVal = useCallback((v: number) => {
    return snapping ? Math.round(v * 2) / 2 : +v.toFixed(2);
  }, [snapping]);

  useEffect(() => {
    loadDraft()
      .then(({ id, doc }) => {
        const d = doc ?? sampleDoc();
        setDraftId(id); setDocRaw(d); setFloorId(d.floors[0]?.id ?? "");
        if (!doc) setDirty(true);
        setTimeout(() => fit(d.objects.filter((o) => o.floorId === d.floors[0]?.id)), 30);
      })
      .catch((e) => { toast.error("Could not load the map: " + e.message); const d = sampleDoc(); setDocRaw(d); setFloorId(d.floors[0].id); });
  }, [fit]);

  const commit = useCallback((fn: (d: MapDoc) => MapDoc, record = true) => {
    setDocRaw((d) => {
      if (!d) return d;
      if (record) { past.current.push(d); if (past.current.length > 100) past.current.shift(); future.current = []; }
      return fn(d);
    });
    setDirty(true);
  }, []);

  // Autosave effect (saves draft every few seconds when dirty)
  useEffect(() => {
    if (!dirty || !doc || busy) return;
    setAutoSaveStatus("unsaved");
    const timer = setTimeout(async () => {
      try {
        setAutoSaveStatus("saving");
        const id = await saveDraft(draftId, doc);
        setDraftId(id);
        setDirty(false);
        setAutoSaveStatus("saved");
        setLastSaved(new Date());
      } catch (e: any) {
        setAutoSaveStatus("error");
        console.error("Autosave error:", e);
      }
    }, 2500);
    return () => clearTimeout(timer);
  }, [dirty, doc, draftId, busy]);

  const snapshot = () => { if (doc) { past.current.push(doc); future.current = []; } };
  const undo = () => { const p = past.current.pop(); if (p && doc) { future.current.push(doc); setDocRaw(p); setDirty(true); } };
  const redo = () => { const n = future.current.pop(); if (n && doc) { past.current.push(doc); setDocRaw(n); setDirty(true); } };

  const updateObj = (id: string, patch: Partial<MapObject>, record = true) =>
    commit((d) => ({ ...d, objects: d.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)) }), record);
  const addObj = (o: MapObject) => { commit((d) => ({ ...d, objects: [...d.objects, o] })); setSelectedIds([o.id]); };

  const deleteSel = useCallback(() => {
    if (!selectedIds.length) return;
    const count = selectedIds.length;
    commit((d) => ({ ...d, objects: d.objects.filter((o) => !selectedIds.includes(o.id)) }));
    setSelectedIds([]);
    toast.success(`Deleted ${count} object${count > 1 ? "s" : ""}`);
  }, [commit, selectedIds]);

  const duplicateSel = useCallback(() => {
    if (!selectedIds.length || !doc) return;
    const targets = doc.objects.filter((x) => selectedIds.includes(x.id));
    if (!targets.length) return;
    const copies = targets.map((o) =>
      transformObj({ ...o, id: uid(), name: o.name ? o.name + " copy" : "" }, snapVal(o.x + 1), snapVal(o.y + 1), o.w, o.h)
    );
    commit((d) => ({ ...d, objects: [...d.objects, ...copies] }));
    setSelectedIds(copies.map((c) => c.id));
    toast.success(`Duplicated ${copies.length} object${copies.length > 1 ? "s" : ""}`);
  }, [commit, doc, selectedIds, snapVal]);

  const copySel = useCallback(() => {
    if (!doc || !selectedIds.length) return;
    const targets = doc.objects.filter((o) => selectedIds.includes(o.id));
    if (!targets.length) return;
    clipboard.current = targets.map((o) => ({ ...o }));
    toast.success(`Copied ${targets.length} object${targets.length > 1 ? "s" : ""}`);
  }, [doc, selectedIds]);

  const pasteSel = useCallback(() => {
    if (!clipboard.current.length || !doc) return;
    const pasted = clipboard.current.map((o) =>
      transformObj(
        { ...o, id: uid(), floorId, name: o.name ? `${o.name} copy` : "" },
        snapVal(o.x + 1),
        snapVal(o.y + 1),
        o.w,
        o.h
      )
    );
    commit((d) => ({ ...d, objects: [...d.objects, ...pasted] }));
    setSelectedIds(pasted.map((p) => p.id));
    // Offset for next paste
    clipboard.current = pasted.map((o) => ({ ...o }));
    toast.success(`Pasted ${pasted.length} object${pasted.length > 1 ? "s" : ""}`);
  }, [commit, floorId, snapVal, doc]);

  const rotateSel = (deg: number) => {
    if (!selected) return;
    const [cx, cy] = [selected.x + selected.w / 2, selected.y + selected.h / 2];
    commit((d) => ({ ...d, objects: d.objects.map((o) => (o.id === sel ? rotateObj(o, deg, cx, cy) : o)) }));
  };
  const scaleSel = (f: number) => {
    if (!selected) return;
    const [cx, cy] = [selected.x + selected.w / 2, selected.y + selected.h / 2];
    commit((d) => ({ ...d, objects: d.objects.map((o) => (o.id === sel ? scaleObj(o, f, cx, cy) : o)) }));
  };

  const floorTransform = (fn: (o: MapObject, cx: number, cy: number) => MapObject) => {
    const objs = doc?.objects.filter((o) => o.floorId === floorId) ?? []; if (!objs.length) return;
    const [cx, cy] = centerOfAll(objs);
    commit((d) => ({ ...d, objects: d.objects.map((o) => (o.floorId === floorId ? fn(o, cx, cy) : o)) }));
  };
  const allTransform = (fn: (o: MapObject, cx: number, cy: number) => MapObject) => {
    if (!doc?.objects.length) return; const [cx, cy] = centerOfAll(doc.objects);
    commit((d) => ({ ...d, objects: d.objects.map((o) => fn(o, cx, cy)) }));
  };

  const floorObjs = useMemo(() => sortForRender(doc?.objects.filter((o) => o.floorId === floorId) ?? []), [doc, floorId]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedObjs = useMemo(() => doc?.objects.filter((o) => selectedIdSet.has(o.id)) ?? [], [doc, selectedIdSet]);
  const selected = selectedObjs.length === 1 ? selectedObjs[0] : null;

  const save = async () => {
    if (!doc) return; setBusy(true); setAutoSaveStatus("saving");
    try {
      const id = await saveDraft(draftId, doc);
      setDraftId(id); setDirty(false); setAutoSaveStatus("saved"); setLastSaved(new Date());
      toast.success("Draft saved");
    }
    catch (e: any) { setAutoSaveStatus("error"); toast.error("Save failed: " + e.message); } finally { setBusy(false); }
  };

  const publish = async () => {
    if (!doc) return; setBusy(true);
    try {
      const id = await saveDraft(draftId, doc); setDraftId(id); setDirty(false); setAutoSaveStatus("saved"); setLastSaved(new Date());
      await publishDoc(doc); toast.success("Published — students now see this map");
    } catch (e: any) { toast.error("Publish failed: " + e.message); } finally { setBusy(false); }
  };

  const newObj = (type: ObjType, geo: Pick<MapObject, "x" | "y" | "w" | "h"> & { points?: [number, number][] }): MapObject => {
    const n = (doc?.objects.filter((o) => o.type === type).length ?? 0) + 1;
    const name = DEFAULT_NAME[type] ? `${DEFAULT_NAME[type]} ${n}` : "";
    return { id: uid(), floorId, type, name, ...geo, connector: CONN_PREFIX[type] ? `${CONN_PREFIX[type]}${n}` : undefined };
  };

  const createPresetDoor = useCallback((targetRoom?: MapObject, atPoint?: [number, number], side?: "auto" | "left" | "right" | "top" | "bottom"): MapObject | null => {
    if (!doc) return null;
    const currentFloorObjs = doc.objects.filter((o) => o.floorId === floorId);

    // If no targetRoom is provided, try to find the closest room/lab/restroom/lobby near atPoint
    let room = targetRoom;
    if (!room && atPoint) {
      const candidateRooms = currentFloorObjs.filter((o) => o.type === "room" || o.type === "lab" || o.type === "restroom" || o.type === "lobby");
      let bestDist = Infinity;
      for (const r of candidateRooms) {
        const cx = Math.max(r.x, Math.min(atPoint[0], r.x + r.w));
        const cy = Math.max(r.y, Math.min(atPoint[1], r.y + r.h));
        const dist = Math.hypot(atPoint[0] - cx, atPoint[1] - cy);
        if (dist < 4.0 && dist < bestDist) {
          bestDist = dist;
          room = r;
        }
      }
    }

    const doorId = uid();
    const n = (doc.objects.filter((o) => o.type === "door").length ?? 0) + 1;

    if (room) {
      let chosenSide = side ?? "auto";
      if (chosenSide === "auto") {
        if (atPoint) {
          const dLeft = Math.abs(atPoint[0] - room.x);
          const dRight = Math.abs(atPoint[0] - (room.x + room.w));
          const dTop = Math.abs(atPoint[1] - room.y);
          const dBottom = Math.abs(atPoint[1] - (room.y + room.h));
          const minD = Math.min(dLeft, dRight, dTop, dBottom);
          if (minD === dLeft) chosenSide = "left";
          else if (minD === dRight) chosenSide = "right";
          else if (minD === dTop) chosenSide = "top";
          else chosenSide = "bottom";
        } else {
          // Detect adjacent corridor or lobby
          const corridors = currentFloorObjs.filter((o) => o.type === "corridor" || o.type === "lobby");
          let bestEdge: "left" | "right" | "top" | "bottom" = "left";
          let bestOverlap = -Infinity;
          for (const c of corridors) {
            if (Math.abs(c.x + c.w - room.x) < 1.2) {
              const overlap = Math.max(0, Math.min(c.y + c.h, room.y + room.h) - Math.max(c.y, room.y));
              if (overlap > bestOverlap) { bestOverlap = overlap; bestEdge = "left"; }
            }
            if (Math.abs(room.x + room.w - c.x) < 1.2) {
              const overlap = Math.max(0, Math.min(c.y + c.h, room.y + room.h) - Math.max(c.y, room.y));
              if (overlap > bestOverlap) { bestOverlap = overlap; bestEdge = "right"; }
            }
            if (Math.abs(c.y + c.h - room.y) < 1.2) {
              const overlap = Math.max(0, Math.min(c.x + c.w, room.x + room.w) - Math.max(c.x, room.x));
              if (overlap > bestOverlap) { bestOverlap = overlap; bestEdge = "top"; }
            }
            if (Math.abs(room.y + room.h - c.y) < 1.2) {
              const overlap = Math.max(0, Math.min(c.x + c.w, room.x + room.w) - Math.max(c.x, room.x));
              if (overlap > bestOverlap) { bestOverlap = overlap; bestEdge = "bottom"; }
            }
          }
          chosenSide = bestEdge;
        }
      }

      let dx = 0, dy = 0, dw = 0, dh = 0;
      const doorThickness = 0.5; // spans across the wall to ensure pathfinding connectivity
      const doorWidth = 0.9;     // clear door passage width

      if (chosenSide === "left") {
        dx = snapVal(room.x - doorThickness / 2);
        const targetY = atPoint ? atPoint[1] : (room.y + room.h / 2);
        dy = snapVal(Math.min(Math.max(targetY - doorWidth / 2, room.y + 0.2), room.y + room.h - doorWidth - 0.2));
        dw = doorThickness;
        dh = doorWidth;
      } else if (chosenSide === "right") {
        dx = snapVal(room.x + room.w - doorThickness / 2);
        const targetY = atPoint ? atPoint[1] : (room.y + room.h / 2);
        dy = snapVal(Math.min(Math.max(targetY - doorWidth / 2, room.y + 0.2), room.y + room.h - doorWidth - 0.2));
        dw = doorThickness;
        dh = doorWidth;
      } else if (chosenSide === "top") {
        dy = snapVal(room.y - doorThickness / 2);
        const targetX = atPoint ? atPoint[0] : (room.x + room.w / 2);
        dx = snapVal(Math.min(Math.max(targetX - doorWidth / 2, room.x + 0.2), room.x + room.w - doorWidth - 0.2));
        dw = doorWidth;
        dh = doorThickness;
      } else {
        dy = snapVal(room.y + room.h - doorThickness / 2);
        const targetX = atPoint ? atPoint[0] : (room.x + room.w / 2);
        dx = snapVal(Math.min(Math.max(targetX - doorWidth / 2, room.x + 0.2), room.x + room.w - doorWidth - 0.2));
        dw = doorWidth;
        dh = doorThickness;
      }

      const doorObj: MapObject = {
        id: doorId,
        floorId,
        type: "door",
        name: `Door ${n} (${room.name || "Room"})`,
        x: dx,
        y: dy,
        w: dw,
        h: dh,
      };
      commit((d) => ({ ...d, objects: [...d.objects, doorObj] }));
      setSelectedIds([doorObj.id]);
      toast.success(`Connected door to ${room.name || "room"}`);
      return doorObj;
    } else {
      const pt = atPoint ?? [0, 0];
      const doorObj: MapObject = {
        id: doorId,
        floorId,
        type: "door",
        name: `Door ${n}`,
        x: snapVal(pt[0] - 0.45),
        y: snapVal(pt[1] - 0.25),
        w: 0.9,
        h: 0.5,
      };
      commit((d) => ({ ...d, objects: [...d.objects, doorObj] }));
      setSelectedIds([doorObj.id]);
      toast.success("Placed preset door");
      return doorObj;
    }
  }, [doc, floorId, snapVal, commit]);

  const finishPoly = useCallback(() => {
    if (tool === "wall" && poly.length >= 2) addObj({ id: uid(), floorId, type: "wall", name: "", points: poly, ...bboxOf(poly) });
    if (tool === "outline" && poly.length >= 3) addObj({ id: uid(), floorId, type: "outline", name: "Building", points: poly, ...bboxOf(poly) });
    if (RECT_TOOLS.includes(tool) && poly.length >= 3) addObj(newObj(tool as ObjType, { points: poly, ...bboxOf(poly) }));
    setPoly([]);
  }, [tool, poly, floorId, doc]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard shortcuts
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT") return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.code === "Space") { space.current = true; return; }
    if (poly.length && ((mod && e.key.toLowerCase() === "z" && !e.shiftKey) || e.key === "Backspace")) { e.preventDefault(); setPoly((p) => p.slice(0, -1)); return; }
    if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
    if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); save(); return; }
    if (mod && e.key.toLowerCase() === "c") { e.preventDefault(); copySel(); return; }
    if (mod && e.key.toLowerCase() === "v") { e.preventDefault(); pasteSel(); return; }
    if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); duplicateSel(); return; }
    if (e.key === "Delete" || e.key === "Backspace") { deleteSel(); return; }
    if (e.key === "Escape") { setPoly([]); setSelectedIds([]); setTool("select"); return; }
    if (e.key === "Enter") { finishPoly(); return; }
    if (selectedIds.length > 0 && e.key.startsWith("Arrow")) {
      e.preventDefault();
      const st = e.shiftKey ? 1 : (snapping ? 0.5 : 0.1);
      const dx = e.key === "ArrowLeft" ? -st : e.key === "ArrowRight" ? st : 0;
      const dy = e.key === "ArrowUp" ? -st : e.key === "ArrowDown" ? st : 0;
      commit((d) => ({
        ...d,
        objects: d.objects.map((o) =>
          selectedIds.includes(o.id) && !(o.type === "outline" && outlineLocked)
            ? transformObj(o, snapVal(o.x + dx), snapVal(o.y + dy), o.w, o.h)
            : o
        ),
      }));
      return;
    }
    if (mod && (e.key === "=" || e.key === "+" || e.key === "-")) {
      e.preventDefault();
      zoomBy(e.key === "-" ? 1 / 1.25 : 1.25);
      return;
    }
    if (mod && e.key === "0") {
      e.preventDefault();
      fit(floorObjs);
      return;
    }
    if (selected && !mod && (e.key === "[" || e.key === "]")) { rotateSel((e.key === "]" ? 1 : -1) * (e.shiftKey ? 1 : 15)); return; }
    if (selected && !mod && (e.key === "=" || e.key === "+" || e.key === "-")) { scaleSel(e.key === "-" ? 1 / 1.1 : 1.1); return; }
    if (!mod) { const tl = TOOLS.find((x) => x.key === e.key.toLowerCase()); if (tl) { setTool(tl.id); setPoly([]); } }
  };

  useEffect(() => {
    const down = (e: KeyboardEvent) => keyRef.current(e);
    const up = (e: KeyboardEvent) => { if (e.code === "Space") space.current = false; };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener("beforeunload", h); return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!doc) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const [wx, wy] = toWorld(e.clientX, e.clientY);
    if (e.button === 1 || e.button === 2 || space.current || e.ctrlKey || e.metaKey) {
      setDrag({ mode: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y });
      return;
    }
    const target = e.target as Element;
    if (tool === "select") {
      const handle = target.closest("[data-handle]")?.getAttribute("data-handle");
      if (handle === "rot" && selected) {
        const c: [number, number] = [selected.x + selected.w / 2, selected.y + selected.h / 2];
        snapshot(); setDrag({ mode: "rotate", c, a0: Math.atan2(wy - c[1], wx - c[0]), orig: selected }); return;
      }
      if (handle && selected && (handle[0] === "v" || handle[0] === "m")) {
        const i = +handle.slice(1); const pts = cornersOf(selected).map((p) => [...p] as [number, number]);
        snapshot();
        if (handle[0] === "v" && e.altKey) {
          if (pts.length > (selected.type === "wall" ? 2 : 3)) { pts.splice(i, 1); commit((d) => ({ ...d, objects: d.objects.map((x) => (x.id === selected.id ? { ...x, points: pts, ...bboxOf(pts) } : x)) }), false); }
          return;
        }
        let vi = i;
        if (handle[0] === "m") { const a = pts[i], b = pts[(i + 1) % pts.length]; pts.splice(i + 1, 0, [r2((a[0] + b[0]) / 2), r2((a[1] + b[1]) / 2)]); vi = i + 1; }
        const orig = { ...selected, points: pts, ...bboxOf(pts) };
        commit((d) => ({ ...d, objects: d.objects.map((x) => (x.id === selected.id ? orig : x)) }), false);
        setDrag({ mode: "vertex", i: vi, orig }); return;
      }
      if (handle && selected) {
        let ax = selected.x;
        let ay = selected.y;
        if (handle.includes("w")) ax = selected.x + selected.w;
        else if (handle.includes("e")) ax = selected.x;
        else ax = selected.x;

        if (handle.includes("n")) ay = selected.y + selected.h;
        else if (handle.includes("s")) ay = selected.y;
        else ay = selected.y;

        snapshot(); setDrag({ mode: "resize", anchor: [ax, ay], orig: selected, handle }); return;
      }

      const id = target.closest("[data-id]")?.getAttribute("data-id");
      const o = id ? doc.objects.find((x) => x.id === id) : null;

      // Handle clicking an object
      if (o && !(o.type === "outline" && outlineLocked)) {
        if (e.shiftKey) {
          // Toggle this object in multi-selection
          const next = selectedIds.includes(o.id)
            ? selectedIds.filter((x) => x !== o.id)
            : [...selectedIds, o.id];
          setSelectedIds(next);
          if (next.includes(o.id)) {
            const targets = doc.objects.filter((x) => next.includes(x.id) && !(x.type === "outline" && outlineLocked));
            snapshot();
            setDrag({ mode: "move", wx, wy, origs: targets.map((x) => ({ ...x })) });
          }
          return;
        }

        // Without shift:
        if (selectedIds.includes(o.id) && selectedIds.length > 1) {
          // Clicked inside already multi-selected items -> start moving all of them together
          const targets = doc.objects.filter((x) => selectedIds.includes(x.id) && !(x.type === "outline" && outlineLocked));
          snapshot();
          setDrag({ mode: "move", wx, wy, origs: targets.map((x) => ({ ...x })) });
          return;
        }

        // Single select this object
        setSelectedIds([o.id]);
        snapshot();
        setDrag({ mode: "move", wx, wy, origs: [{ ...o }] });
        return;
      }

      // Clicked on empty space: start drag box marquee select
      setDrag({
        mode: "box-select",
        start: [wx, wy],
        cur: [wx, wy],
        shift: e.shiftKey,
        initialSel: selectedIds,
      });
      return;
    }

    if (tool === "poi") {
      addObj({ id: uid(), floorId, type: "poi", name: "New place", x: snapVal(wx) - 0.5, y: snapVal(wy) - 0.5, w: 1, h: 1 });
      setTool("select");
      return;
    }
    if (polyMode) {
      setPoly((p) => [...p, [snapVal(wx), snapVal(wy)]]);
      return;
    }
    if (RECT_TOOLS.includes(tool)) {
      setDrag({ mode: "draw", start: [snapVal(wx), snapVal(wy)], cur: [snapVal(wx), snapVal(wy)] });
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const [wx, wy] = toWorld(e.clientX, e.clientY);
    setCursor([wx, wy]);
    if (!drag) return;
    if (drag.mode === "pan") {
      setView((v) => ({ ...v, x: drag.vx + e.clientX - drag.sx, y: drag.vy + e.clientY - drag.sy }));
    } else if (drag.mode === "move") {
      const dx = snapVal(wx - drag.wx);
      const dy = snapVal(wy - drag.wy);
      commit((d) => ({
        ...d,
        objects: d.objects.map((x) => {
          const orig = drag.origs.find((o) => o.id === x.id);
          if (orig) return transformObj(orig, snapVal(orig.x + dx), snapVal(orig.y + dy), orig.w, orig.h);
          return x;
        }),
      }), false);
    } else if (drag.mode === "box-select") {
      setDrag({ ...drag, cur: [wx, wy] });
    } else if (drag.mode === "resize") {
      const [ax, ay] = drag.anchor; const px = snapVal(wx), py = snapVal(wy);
      const hType = drag.handle || "";
      let nx = Math.min(ax, px), ny = Math.min(ay, py);
      let nw = Math.max(0.5, Math.abs(px - ax)), nh = Math.max(0.5, Math.abs(py - ay));
      if (hType === "e" || hType === "w") {
        ny = drag.orig.y;
        nh = drag.orig.h;
      }
      if (hType === "n" || hType === "s") {
        nx = drag.orig.x;
        nw = drag.orig.w;
      }
      commit((d) => ({ ...d, objects: d.objects.map((x) => (x.id === drag.orig.id ? transformObj(drag.orig, nx, ny, nw, nh) : x)) }), false);
    } else if (drag.mode === "vertex") {
      const pts = drag.orig.points!.map((p, j) => (j === drag.i ? [snapVal(wx), snapVal(wy)] : p) as [number, number]);
      commit((d) => ({ ...d, objects: d.objects.map((x) => (x.id === drag.orig.id ? { ...x, points: pts, ...bboxOf(pts) } : x)) }), false);
    } else if (drag.mode === "rotate") {
      let deg = ((Math.atan2(wy - drag.c[1], wx - drag.c[0]) - drag.a0) * 180) / Math.PI;
      deg = e.shiftKey ? Math.round(deg / 15) * 15 : Math.round(deg);
      commit((d) => ({ ...d, objects: d.objects.map((x) => (x.id === drag.orig.id ? rotateObj(drag.orig, deg, drag.c[0], drag.c[1]) : x)) }), false);
    } else if (drag.mode === "draw") {
      setDrag({ ...drag, cur: [snapVal(wx), snapVal(wy)] });
    }
  };

  const onPointerUp = () => {
    if (drag?.mode === "box-select") {
      const [x0, y0] = drag.start;
      const [x1, y1] = drag.cur;
      const x = Math.min(x0, x1), y = Math.min(y0, y1);
      const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
      if (w >= 0.3 || h >= 0.3) {
        // Select all objects intersecting or enclosed in box
        const hits = floorObjs
          .filter((o) => !(o.type === "outline" && outlineLocked) && (o.x < x + w && o.x + o.w > x && o.y < y + h && o.y + o.h > y))
          .map((o) => o.id);
        if (drag.shift) {
          setSelectedIds(Array.from(new Set([...drag.initialSel, ...hits])));
        } else {
          setSelectedIds(hits);
        }
      } else {
        if (!drag.shift) {
          setSelectedIds([]);
        }
      }
    } else if (drag?.mode === "draw") {
      const [x0, y0] = drag.start, [x1, y1] = drag.cur;
      const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
      if (tool === "door" && (w < 0.4 || h < 0.4)) {
        createPresetDoor(undefined, [x0, y0]);
      } else if (w >= 0.5 && h >= 0.5) {
        const x = Math.min(x0, x1), y = Math.min(y0, y1);
        if (shape === "circle" && tool !== "label") {
          const pts = Array.from({ length: 32 }, (_, i) => [r2(x + w / 2 + (w / 2) * Math.cos((i / 32) * 2 * Math.PI)), r2(y + h / 2 + (h / 2) * Math.sin((i / 32) * 2 * Math.PI))] as [number, number]);
          addObj(newObj(tool as ObjType, { points: pts, x, y, w, h }));
        } else addObj(newObj(tool as ObjType, { x, y, w, h }));
      }
    }
    setDrag(null);
  };

  const onImport = async (file: File) => {
    if (!doc) return;
    const text = await file.text();
    try {
      let objs: MapObject[] = [];
      if (file.name.toLowerCase().endsWith(".csv")) objs = importCSV(doc, text, floorId);
      else {
        const json = JSON.parse(text);
        if (json.floors && json.objects) {
          if (!confirm("This file is a full SVIT NAV map. Replace the current map with it?")) return;
          commit(() => json as MapDoc); setFloorId(json.floors[0]?.id); setTimeout(() => fit(json.objects), 30);
          toast.success("Map replaced"); return;
        }
        objs = importGeoJSON(doc, json, floorId);
      }
      if (!objs.length) { toast.error("No shapes found in that file"); return; }
      commit((d) => ({ ...d, objects: [...d.objects, ...objs] }));
      setTimeout(() => fit(objs.filter((o) => o.floorId === floorId).length ? objs.filter((o) => o.floorId === floorId) : objs), 30);
      toast.success(`Imported ${objs.length} shapes`);
    } catch (e: any) { toast.error("Could not read file: " + e.message); }
  };

  const exportJSON = () => {
    if (!doc) return;
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "svit-map.json"; a.click();
  };

  const addFloor = () => {
    if (!doc) return;
    const level = Math.max(...doc.floors.map((f) => f.level), -1) + 1;
    const f = { id: uid(), name: `Floor ${level}`, level };
    const copies = doc.objects.filter((o) => o.floorId === floorId && (o.type === "outline" || CONNECTORS.includes(o.type)))
      .map((o) => ({ ...o, id: uid(), floorId: f.id }));
    commit((d) => ({ ...d, floors: [...d.floors, f], objects: [...d.objects, ...copies] }));
    setFloorId(f.id); setSelectedIds([]);
    toast.success("Floor added — outline, stairs and lifts were copied");
  };

  // Duplicate current floor (copies outline, corridors, stairs, rooms, etc.)
  const duplicateFloor = () => {
    if (!doc || !floor) return;
    const nextLevel = Math.max(...doc.floors.map((f) => f.level), -1) + 1;
    const newFloorId = uid();
    const newFloor: Floor = {
      id: newFloorId,
      name: `Floor ${nextLevel}`,
      level: nextLevel,
    };
    const currentFloorObjs = doc.objects.filter((o) => o.floorId === floorId);
    const copies: MapObject[] = currentFloorObjs.map((o) => ({
      ...o,
      id: uid(),
      floorId: newFloorId,
    }));
    commit((d) => ({
      ...d,
      floors: [...d.floors, newFloor],
      objects: [...d.objects, ...copies],
    }));
    setFloorId(newFloorId);
    setSelectedIds([]);
    setPoly([]);
    toast.success(`Duplicated "${floor.name}" to "${newFloor.name}" (${copies.length} shapes copied)`);
  };

  const deleteFloor = () => {
    if (!doc || doc.floors.length < 2) return;
    if (!confirm("Delete this floor and everything on it?")) return;
    const rest = doc.floors.filter((f) => f.id !== floorId);
    commit((d) => ({ ...d, floors: rest, objects: d.objects.filter((o) => o.floorId !== floorId) }));
    setFloorId(rest[0].id);
    setSelectedIds([]);
  };

  const floor = doc?.floors.find((f) => f.id === floorId);

  // Simple validation summary
  const issues = useMemo(() => {
    if (!doc) return [];
    const out: string[] = [];
    const unnamed = doc.objects.filter((o) => o.type === "room" && !o.name.trim()).length;
    if (unnamed) out.push(`${unnamed} room(s) without a name`);
    const conns = new Map<string, Set<string>>();
    doc.objects.forEach((o) => { if (CONNECTORS.includes(o.type) && o.connector) { const s = conns.get(o.connector) ?? new Set(); s.add(o.floorId); conns.set(o.connector, s); } });
    if (doc.floors.length > 1) conns.forEach((s, k) => { if (s.size < 2) out.push(`"${k}" only exists on one floor`); });
    return out;
  }, [doc]);

  if (!doc) return <div className="flex h-screen items-center justify-center text-muted-foreground">Loading map…</div>;

  const list = floorObjs.filter((o) => o.type !== "wall" && (o.name || TYPE_LABEL[o.type]).toLowerCase().includes(filter.toLowerCase())).reverse();
  const drawRect = drag?.mode === "draw" ? {
    x: Math.min(drag.start[0], drag.cur[0]),
    y: Math.min(drag.start[1], drag.cur[1]),
    w: Math.abs(drag.cur[0] - drag.start[0]),
    h: Math.abs(drag.cur[1] - drag.start[1]),
  } : null;
  const hs = 8 / view.k;

  // Active segment distance calculation for polygon/wall
  const activePolySeg = poly.length > 0 ? {
    lastP: poly[poly.length - 1],
    curP: [snapVal(cursor[0]), snapVal(cursor[1])] as [number, number],
    dist: Math.hypot(snapVal(cursor[0]) - poly[poly.length - 1][0], snapVal(cursor[1]) - poly[poly.length - 1][1]),
  } : null;

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <Toaster />
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="flex h-7 w-7 items-center justify-center rounded bg-primary text-primary-foreground"><Layers size={15} /></span>
          SVIT NAV <span className="label">editor</span>
        </Link>
        <div className="mx-2 h-6 w-px bg-border" />

        {/* Floor Switcher & Floor Duplication */}
        <div className="flex items-center gap-1 overflow-x-auto">
          {[...doc.floors].sort((a, b) => b.level - a.level).map((f) => (
            <button key={f.id} className="btn" data-active={f.id === floorId} style={f.id === floorId ? { borderColor: "var(--primary)", color: "var(--primary)" } : undefined}
              onClick={() => { setFloorId(f.id); setSelectedIds([]); setPoly([]); }}>{f.name}</button>
          ))}
          <button className="btn btn-ghost" onClick={addFloor} title="Add floor"><Plus size={14} /></button>
          <button className="btn btn-ghost text-xs" onClick={duplicateFloor} title="Duplicate current floor (copies outline, corridors, stairs to start the next floor)">
            <Copy size={13} /> <span className="hidden md:inline">Duplicate floor</span>
          </button>
        </div>

        <div className="mx-2 h-6 w-px bg-border hidden sm:block" />

        {/* Lock Outline Toggle & Snap Toggle */}
        <div className="flex items-center gap-1.5">
          <button
            className={`btn ${outlineLocked ? "border-amber-500/60 bg-amber-500/10 text-amber-400" : ""}`}
            onClick={() => {
              setOutlineLocked((l) => {
                const next = !l;
                toast.info(next ? "Outline locked (cannot move by accident)" : "Outline unlocked");
                return next;
              });
            }}
            title={outlineLocked ? "Outline is locked so it can't move by accident. Click to unlock." : "Outline is unlocked. Click to lock."}
          >
            {outlineLocked ? <Lock size={13} /> : <Unlock size={13} />}
            <span className="text-xs">{outlineLocked ? "Outline locked" : "Outline unlocked"}</span>
          </button>

          <button
            className={`btn ${snapping ? "border-primary text-primary" : "text-muted-foreground"}`}
            onClick={() => {
              setSnapping((s) => {
                const next = !s;
                toast.info(next ? "Snap ON (0.5m grid)" : "Snap OFF");
                return next;
              });
            }}
            title="Toggle grid snapping on/off (0.5m grid)"
          >
            <Magnet size={13} />
            <span className="text-xs">Snap: {snapping ? "ON" : "OFF"}</span>
          </button>

          <button
            className={`btn btn-ghost px-2 ${showGrid ? "text-foreground" : "text-muted-foreground opacity-50"}`}
            onClick={() => setShowGrid((g) => !g)}
            title={showGrid ? "Hide grid" : "Show grid"}
          >
            <Grid3X3 size={14} />
          </button>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* Autosave Status Indicator */}
          <div className="flex items-center gap-1.5 font-mono text-xs">
            {autoSaveStatus === "saving" && (
              <span className="flex items-center gap-1 text-primary">
                <Loader2 size={12} className="animate-spin" /> <span className="hidden sm:inline">Autosaving…</span>
              </span>
            )}
            {autoSaveStatus === "saved" && (
              <span className="flex items-center gap-1 text-emerald-400" title={lastSaved ? `Last saved at ${lastSaved.toLocaleTimeString()}` : "All changes saved"}>
                <CheckCircle2 size={12} /> <span className="hidden sm:inline">{lastSaved ? `Saved ${lastSaved.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "Draft saved"}</span>
              </span>
            )}
            {autoSaveStatus === "unsaved" && (
              <span className="flex items-center gap-1 text-amber-400" title="Changes will auto-save in a few seconds">
                <Clock size={12} /> <span className="hidden sm:inline">Autosaving soon…</span>
              </span>
            )}
            {autoSaveStatus === "error" && (
              <span className="flex items-center gap-1 text-destructive" title="Autosave error">
                <AlertTriangle size={12} /> <span className="hidden sm:inline">Save error</span>
              </span>
            )}
          </div>

          <button className="btn btn-ghost" onClick={undo} title="Undo (Ctrl+Z)"><Undo2 size={15} /></button>
          <button className="btn btn-ghost" onClick={redo} title="Redo (Ctrl+Shift+Z)"><Redo2 size={15} /></button>
          <input ref={fileRef} type="file" accept=".geojson,.json,.csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = ""; }} />
          <button className="btn hidden lg:inline-flex" title="Clear everything and start with a blank Ground Floor" onClick={() => {
            if (!confirm("Clear the whole map (all floors and shapes)? You can undo with Ctrl+Z until you leave the page.")) return;
            const d = emptyDoc(); commit(() => d); setFloorId(d.floors[0].id); setSelectedIds([]); setPoly([]);
            setView({ x: 40, y: 40, k: 8 }); toast.success("Map cleared — import your outline or start drawing");
          }}><Trash2 size={14} /> New map</button>
          <button className="btn" onClick={() => fileRef.current?.click()}><Upload size={14} /> Import</button>
          <button className="btn" onClick={exportJSON}><Download size={14} /> Export</button>
          <button className="btn" onClick={save} disabled={busy}><Save size={14} /> Save</button>
          <button className="btn btn-primary" onClick={publish} disabled={busy}><Rocket size={14} /> Publish</button>
          <Link to="/" className="btn btn-ghost" title="Open student view"><Eye size={15} /></Link>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex flex-col gap-1 overflow-y-auto border-r border-border p-2">
          {TOOLS.map((t) => (
            <button key={t.id} className="tool" data-active={tool === t.id} title={`${t.label} (${t.key.toUpperCase()})`} onClick={() => { setTool(t.id); setPoly([]); }}>
              <t.icon size={18} />
            </button>
          ))}
        </aside>

        <main className="relative min-w-0 flex-1 bg-map-bg">
          <svg ref={svgRef} className="h-full w-full touch-none select-none" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
            onDoubleClick={() => polyMode && finishPoly()} onContextMenu={(e) => e.preventDefault()}
            style={{ cursor: drag?.mode === "pan" ? "grabbing" : tool === "select" ? "default" : "crosshair" }}>
            <GridPattern />
            <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
              {showGrid && <rect x={-500} y={-500} width={2000} height={2000} fill="url(#grid-major)" />}

              {/* Render objects with lock support */}
              {floorObjs.map((o) => (
                <ObjectShape
                  key={o.id}
                  o={o}
                  k={view.k}
                  selected={selectedIdSet.has(o.id)}
                  locked={o.type === "outline" && outlineLocked}
                />
              ))}

              {/* Box marquee selection */}
              {drag?.mode === "box-select" && (() => {
                const bx = Math.min(drag.start[0], drag.cur[0]);
                const by = Math.min(drag.start[1], drag.cur[1]);
                const bw = Math.abs(drag.cur[0] - drag.start[0]);
                const bh = Math.abs(drag.cur[1] - drag.start[1]);
                return (
                  <rect
                    x={bx} y={by} width={bw} height={bh}
                    fill="oklch(0.82 0.16 75 / 0.12)"
                    stroke="var(--map-selected)"
                    strokeDasharray="3 3"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                    pointerEvents="none"
                  />
                );
              })()}

              {/* Drawing Rectangle with LIVE MEASUREMENTS */}
              {drawRect && (
                <g pointerEvents="none">
                  <rect {...{ x: drawRect.x, y: drawRect.y, width: drawRect.w, height: drawRect.h }} fill="var(--map-draft)" stroke="var(--map-selected)" strokeDasharray="4 3" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />

                  {/* Top width dimension measurement */}
                  {drawRect.w > 0.3 && (
                    <g>
                      <line x1={drawRect.x} y1={drawRect.y - 0.4} x2={drawRect.x + drawRect.w} y2={drawRect.y - 0.4} stroke="var(--primary)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                      <line x1={drawRect.x} y1={drawRect.y - 0.7} x2={drawRect.x} y2={drawRect.y - 0.1} stroke="var(--primary)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                      <line x1={drawRect.x + drawRect.w} y1={drawRect.y - 0.7} x2={drawRect.x + drawRect.w} y2={drawRect.y - 0.1} stroke="var(--primary)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                      <text x={drawRect.x + drawRect.w / 2} y={drawRect.y - 0.6} fill="var(--primary)" fontSize={Math.max(0.6, 11 / view.k)} textAnchor="middle" dominantBaseline="auto" fontWeight={600} style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.85))" }}>
                        {drawRect.w.toFixed(1)} m
                      </text>
                    </g>
                  )}

                  {/* Right height dimension measurement */}
                  {drawRect.h > 0.3 && (
                    <g>
                      <line x1={drawRect.x + drawRect.w + 0.4} y1={drawRect.y} x2={drawRect.x + drawRect.w + 0.4} y2={drawRect.y + drawRect.h} stroke="var(--primary)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                      <line x1={drawRect.x + drawRect.w + 0.1} y1={drawRect.y} x2={drawRect.x + drawRect.w + 0.7} y2={drawRect.y} stroke="var(--primary)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                      <line x1={drawRect.x + drawRect.w + 0.1} y1={drawRect.y + drawRect.h} x2={drawRect.x + drawRect.w + 0.7} y2={drawRect.y + drawRect.h} stroke="var(--primary)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                      <text x={drawRect.x + drawRect.w + 0.6} y={drawRect.y + drawRect.h / 2} fill="var(--primary)" fontSize={Math.max(0.6, 11 / view.k)} dominantBaseline="middle" fontWeight={600} style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.85))" }}>
                        {drawRect.h.toFixed(1)} m
                      </text>
                    </g>
                  )}

                  {/* Floating live dimension badge */}
                  <g transform={`translate(${drawRect.x + drawRect.w / 2}, ${drawRect.y + drawRect.h / 2})`}>
                    <rect x={-45 / view.k} y={-11 / view.k} width={90 / view.k} height={22 / view.k} rx={4 / view.k} fill="rgba(15, 23, 42, 0.88)" stroke="var(--primary)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                    <text x={0} y={0} fill="var(--foreground)" fontSize={Math.max(0.5, 10 / view.k)} textAnchor="middle" dominantBaseline="middle" fontFamily="var(--font-mono)" fontWeight={600}>
                      {drawRect.w.toFixed(1)}m × {drawRect.h.toFixed(1)}m
                    </text>
                  </g>
                </g>
              )}

              {/* Polygon / Wall drawing with LIVE SEGMENT MEASUREMENT */}
              {poly.length > 0 && activePolySeg && (
                <g pointerEvents="none">
                  <polyline points={[...poly, activePolySeg.curP].map((p) => p.join(",")).join(" ")} fill={tool === "outline" ? "var(--map-draft)" : "none"}
                    stroke="var(--map-selected)" strokeWidth={tool === "wall" ? 0.3 : 2} vectorEffect={tool === "wall" ? undefined : "non-scaling-stroke"} strokeDasharray={tool === "outline" ? "5 3" : undefined} />
                  {activePolySeg.dist > 0.3 && (
                    <text
                      x={(activePolySeg.lastP[0] + activePolySeg.curP[0]) / 2}
                      y={(activePolySeg.lastP[1] + activePolySeg.curP[1]) / 2 - 0.4}
                      fill="var(--primary)"
                      fontSize={Math.max(0.6, 11 / view.k)}
                      textAnchor="middle"
                      fontWeight={600}
                      style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.9))" }}
                    >
                      {activePolySeg.dist.toFixed(1)} m
                    </text>
                  )}
                </g>
              )}

              {/* Multi-Selection Bounding Box */}
              {selectedObjs.length > 1 && tool === "select" && (() => {
                const xs = selectedObjs.map((o) => o.x);
                const ys = selectedObjs.map((o) => o.y);
                const x2s = selectedObjs.map((o) => o.x + o.w);
                const y2s = selectedObjs.map((o) => o.y + o.h);
                const minX = Math.min(...xs), minY = Math.min(...ys);
                const maxX = Math.max(...x2s), maxY = Math.max(...y2s);
                return (
                  <g pointerEvents="none">
                    <rect x={minX - 0.2} y={minY - 0.2} width={maxX - minX + 0.4} height={maxY - minY + 0.4} fill="none" stroke="var(--map-selected)" strokeDasharray="3 3" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                    <text x={minX - 0.2} y={minY - 0.5} fill="var(--map-selected)" fontSize={Math.max(0.6, 10 / view.k)} fontWeight={600} fontFamily="var(--font-mono)">
                      {selectedObjs.length} objects selected
                    </text>
                  </g>
                );
              })()}

              {/* Single selection transform handles */}
              {selected && selected.floorId === floorId && tool === "select" && !(selected.type === "outline" && outlineLocked) && (
                <g>
                  <rect x={selected.x} y={selected.y} width={selected.w} height={selected.h} fill="none" stroke="var(--map-selected)" strokeDasharray="3 3" strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none" />

                  {/* Live dimensions when resizing */}
                  {drag?.mode === "resize" && (
                    <g pointerEvents="none" transform={`translate(${selected.x + selected.w / 2}, ${selected.y - 1})`}>
                      <rect x={-40 / view.k} y={-9 / view.k} width={80 / view.k} height={18 / view.k} rx={3 / view.k} fill="rgba(15, 23, 42, 0.9)" stroke="var(--primary)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                      <text x={0} y={0} fill="var(--foreground)" fontSize={Math.max(0.5, 9 / view.k)} textAnchor="middle" dominantBaseline="middle" fontFamily="var(--font-mono)" fontWeight={600}>
                        {selected.w.toFixed(1)}m × {selected.h.toFixed(1)}m
                      </text>
                    </g>
                  )}

                  {(["nw", "ne", "sw", "se"] as const).map((hd) => (
                    <rect key={hd} data-handle={hd} x={(hd.includes("w") ? selected.x : selected.x + selected.w) - hs / 2} y={(hd.includes("n") ? selected.y : selected.y + selected.h) - hs / 2}
                      width={hs} height={hs} fill="var(--map-selected)" style={{ cursor: hd === "nw" || hd === "se" ? "nwse-resize" : "nesw-resize" }} />
                  ))}
                  {/* Normal 4 Edge resize handles */}
                  <rect data-handle="n" x={selected.x + selected.w / 2 - hs / 2} y={selected.y - hs / 2} width={hs} height={hs} fill="var(--map-selected)" style={{ cursor: "ns-resize" }}><title>Resize height (top)</title></rect>
                  <rect data-handle="s" x={selected.x + selected.w / 2 - hs / 2} y={selected.y + selected.h - hs / 2} width={hs} height={hs} fill="var(--map-selected)" style={{ cursor: "ns-resize" }}><title>Resize height (bottom)</title></rect>
                  <rect data-handle="w" x={selected.x - hs / 2} y={selected.y + selected.h / 2 - hs / 2} width={hs} height={hs} fill="var(--map-selected)" style={{ cursor: "ew-resize" }}><title>Resize width (left)</title></rect>
                  <rect data-handle="e" x={selected.x + selected.w - hs / 2} y={selected.y + selected.h / 2 - hs / 2} width={hs} height={hs} fill="var(--map-selected)" style={{ cursor: "ew-resize" }}><title>Resize width (right)</title></rect>

                  <line x1={selected.x + selected.w / 2} y1={selected.y} x2={selected.x + selected.w / 2} y2={selected.y - hs * 4} stroke="var(--map-selected)" strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none" />
                  <circle data-handle="rot" cx={selected.x + selected.w / 2} cy={selected.y - hs * 4} r={hs * 0.8} fill="var(--map-selected)" style={{ cursor: "grab" }}><title>Drag to rotate (Shift snaps to 15°)</title></circle>
                  
                  {/* Polygon vertex handles only shown when resizeMode === "polygon" */}
                  {resizeMode === "polygon" && !POINTLIKE.includes(selected.type) && (() => {
                    const pts = cornersOf(selected); const closed = selected.type !== "wall";
                    return <>
                      {pts.map((a, i) => {
                        if (!closed && i === pts.length - 1) return null;
                        const b = pts[(i + 1) % pts.length];
                        return <circle key={"m" + i} data-handle={"m" + i} cx={(a[0] + b[0]) / 2} cy={(a[1] + b[1]) / 2} r={hs * 0.4} fill="var(--background)" stroke="var(--map-selected)" strokeWidth={1} vectorEffect="non-scaling-stroke" style={{ cursor: "copy" }}><title>Drag to add a corner here</title></circle>;
                      })}
                      {pts.map((p, i) => <circle key={"v" + i} data-handle={"v" + i} cx={p[0]} cy={p[1]} r={hs * 0.6} fill="var(--background)" stroke="var(--map-selected)" strokeWidth={2} vectorEffect="non-scaling-stroke" style={{ cursor: "move" }}><title>Drag to move this corner · Alt+click to remove it</title></circle>)}
                    </>;
                  })()}
                </g>
              )}
            </g>
          </svg>

          {/* Bottom Coordinates & Live Measurements HUD */}
          <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap items-center gap-3 rounded bg-card/90 px-3 py-1.5 font-mono text-xs text-muted-foreground shadow">
            <span>x {cursor[0].toFixed(1)} m</span>
            <span>y {cursor[1].toFixed(1)} m</span>
            <span>{floorObjs.length} objects</span>
            <span className={snapping ? "text-primary" : "text-muted-foreground"}>Snap: {snapping ? "0.5m" : "OFF"}</span>
            {outlineLocked && <span className="text-amber-400">Outline: Locked</span>}
            {drawRect && (
              <span className="text-primary font-semibold">
                Live: W: {drawRect.w.toFixed(1)} m × H: {drawRect.h.toFixed(1)} m ({(drawRect.w * drawRect.h).toFixed(1)} m²)
              </span>
            )}
            {activePolySeg && (
              <span className="text-primary font-semibold">
                Segment: {activePolySeg.dist.toFixed(1)} m
              </span>
            )}
            {selectedObjs.length > 1 && (
              <span className="text-primary font-semibold">
                {selectedObjs.length} items selected (drag to move together, Ctrl+C to copy)
              </span>
            )}
            {polyMode && <span className="text-primary">click to add points · double-click / Enter to finish · Ctrl+Z / Backspace removes last point</span>}
          </div>

          {showHelp && (() => { const t = TOOLS.find((x) => x.id === tool)!; return (
            <div className="absolute left-3 top-3 max-w-sm rounded border border-border bg-card/95 p-3 text-xs leading-relaxed shadow-lg">
              <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-primary"><t.icon size={14} /> {t.label} <span className="font-mono text-[10px] text-muted-foreground">key {t.key.toUpperCase()}</span>
                <button className="ml-auto text-muted-foreground hover:text-foreground" onClick={() => setShowHelp(false)} title="Hide tips">✕</button></div>
              <div className="text-foreground"><span className="label mr-1">How</span>{t.how}</div>
              <div className="mt-1 text-muted-foreground"><span className="label mr-1">Navigation</span>{t.nav}</div>
            </div>); })()}
          {selected && tool === "select" && !(selected.type === "outline" && outlineLocked) && !POINTLIKE.includes(selected.type) && selected.type !== "wall" ? (
            <div className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-1.5 rounded border border-border bg-card/95 p-1 text-xs shadow-lg">
              <span className="label px-1">Resize:</span>
              <button
                className={`btn px-2 py-0.5 text-xs ${resizeMode === "box" ? "border-primary bg-primary/20 text-primary font-medium" : "text-muted-foreground"}`}
                onClick={() => setResizeMode("box")}
                title="Normal 8-handle box resize (clean, no polygon vertex dots)"
              >
                <Square size={12} /> Normal Box
              </button>
              <button
                className={`btn px-2 py-0.5 text-xs ${resizeMode === "polygon" ? "border-primary bg-primary/20 text-primary font-medium" : "text-muted-foreground"}`}
                onClick={() => {
                  setResizeMode("polygon");
                  if (!selected.points) {
                    const pts = cornersOf(selected).map((p) => [...p] as [number, number]);
                    updateObj(selected.id, { points: pts });
                  }
                }}
                title="Edit individual polygon vertices and add points"
              >
                <Pentagon size={12} /> Polygon Points
              </button>
              {selected.points && selected.points.length > 0 && selected.type !== "outline" && (
                <button
                  className="btn btn-ghost px-2 py-0.5 text-xs text-amber-400 hover:text-amber-300"
                  onClick={() => {
                    snapshot();
                    const bbox = bboxOf(selected.points!);
                    updateObj(selected.id, {
                      points: undefined,
                      x: snapVal(bbox.x),
                      y: snapVal(bbox.y),
                      w: Math.max(0.5, snapVal(bbox.w)),
                      h: Math.max(0.5, snapVal(bbox.h)),
                    });
                    setResizeMode("box");
                    toast.success("Converted to clean normal rectangle");
                  }}
                  title="Remove polygon slant/points and convert to a regular rectangle"
                >
                  Convert to Box
                </button>
              )}
            </div>
          ) : tool === "door" ? (
            <div className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-2 rounded border border-border bg-card/95 px-3 py-1.5 text-xs shadow-lg">
              <DoorOpen size={14} className="text-primary" />
              <span className="text-foreground font-medium">Door Tool:</span>
              <span className="text-muted-foreground">Click canvas or room edge to place 1m preset door</span>
              <button
                className="btn btn-primary text-xs py-0.5 px-2 ml-1"
                onClick={() => {
                  const [cx, cy] = toWorld(window.innerWidth / 2, window.innerHeight / 2);
                  createPresetDoor(undefined, [cx, cy]);
                }}
              >
                <Plus size={12} /> Add Preset Door
              </button>
            </div>
          ) : RECT_TOOLS.includes(tool) && tool !== "label" && (
            <div className="absolute left-1/2 top-3 flex -translate-x-1/2 gap-1 rounded border border-border bg-card/95 p-1 text-xs shadow-lg">
              <span className="label self-center px-1">Shape</span>
              {([["rect", "Rectangle"], ["poly", "Polygon"], ["circle", "Circle / oval"]] as const).map(([id, l]) => (
                <button key={id} className={`btn ${shape === id ? "border-primary text-primary" : ""}`} onClick={() => { setShape(id); setPoly([]); }}>{l}</button>
              ))}
            </div>
          )}
          {!showHelp && <button className="btn absolute left-3 top-3" onClick={() => setShowHelp(true)} title="Show tool tips"><Info size={14} /> Tips</button>}
          <div className="absolute bottom-3 right-3 flex flex-col gap-1">
            <button className="btn" onClick={() => zoomBy(1.3)}><ZoomIn size={14} /></button>
            <button className="btn" onClick={() => zoomBy(1 / 1.3)}><ZoomOut size={14} /></button>
            <button className="btn" onClick={() => fit(floorObjs)} title="Fit floor"><Maximize size={14} /></button>
          </div>
        </main>

        <aside className="flex w-72 flex-col border-l border-border">
          {/* Floor Panel with Duplicate Floor Button */}
          <div className="space-y-3 border-b border-border p-4">
            <div className="flex items-center justify-between">
              <div className="label">Floor</div>
              <button className="btn btn-ghost text-xs px-2" onClick={duplicateFloor} title="Duplicate this floor (copy outline, corridors, stairs to start the next floor)">
                <Copy size={12} /> Duplicate floor
              </button>
            </div>
            {floor && (
              <div className="grid grid-cols-[1fr_4rem] gap-2">
                <input className="field" value={floor.name} onChange={(e) => commit((d) => ({ ...d, floors: d.floors.map((f) => (f.id === floorId ? { ...f, name: e.target.value } : f)) }), false)} />
                <input className="field" type="number" title="Level" value={floor.level} onChange={(e) => commit((d) => ({ ...d, floors: d.floors.map((f) => (f.id === floorId ? { ...f, level: Number(e.target.value) } : f)) }), false)} />
              </div>
            )}
            <button className="btn w-full justify-center text-xs" onClick={duplicateFloor} title="Duplicate this floor and its layout">
              <Copy size={13} /> Duplicate this floor
            </button>
            <details className="rounded border border-border p-2">
              <summary className="cursor-pointer text-xs text-muted-foreground">Rotate / resize whole layout</summary>
              <div className="mt-2 space-y-3">
                <div><div className="mb-1 text-xs">This floor only</div>
                  <TransformControls onRotate={(deg) => floorTransform((o, cx, cy) => rotateObj(o, deg, cx, cy))} onScale={(f) => floorTransform((o, cx, cy) => scaleObj(o, f, cx, cy))} /></div>
                {doc.floors.length > 1 && <div><div className="mb-1 text-xs">All floors together (keeps stairs and lifts lined up)</div>
                  <TransformControls onRotate={(deg) => allTransform((o, cx, cy) => rotateObj(o, deg, cx, cy))} onScale={(f) => allTransform((o, cx, cy) => scaleObj(o, f, cx, cy))} /></div>}
              </div>
            </details>
            {doc.floors.length > 1 && <button className="text-xs text-destructive hover:underline" onClick={deleteFloor}>Delete this floor</button>}
          </div>

          {/* Multi-Selection Panel */}
          {selectedObjs.length > 1 ? (
            <div className="space-y-3 border-b border-border p-4">
              <div className="flex items-center justify-between">
                <div className="label text-primary">{selectedObjs.length} objects selected</div>
                <div className="flex gap-1">
                  <button className="btn btn-ghost px-2" onClick={duplicateSel} title="Duplicate (Ctrl+D)"><Copy size={14} /></button>
                  <button className="btn btn-ghost px-2 text-destructive" onClick={deleteSel} title="Delete (Del)"><Trash2 size={14} /></button>
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                Selected: {Array.from(new Set(selectedObjs.map((o) => TYPE_LABEL[o.type]))).join(", ")}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button className="btn text-xs justify-center" onClick={copySel} title="Copy selected (Ctrl+C)">
                  <Copy size={13} /> Copy (Ctrl+C)
                </button>
                <button className="btn text-xs justify-center" onClick={duplicateSel} title="Duplicate selected (Ctrl+D)">
                  <Copy size={13} /> Duplicate (Ctrl+D)
                </button>
              </div>
              <div className="space-y-2 pt-2 border-t border-border">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
                    <Palette size={13} /> Color selected items
                  </span>
                  <button
                    className="text-[11px] text-muted-foreground hover:text-foreground underline"
                    onClick={() => {
                      commit((d) => ({
                        ...d,
                        objects: d.objects.map((o) => (selectedIds.includes(o.id) ? { ...o, color: undefined } : o)),
                      }));
                      toast.success(`Reset color for ${selectedIds.length} objects`);
                    }}
                  >
                    Reset
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {COLOR_PRESETS.map((p) => (
                    <button
                      key={p.label}
                      className="h-5 w-5 rounded border border-border transition-transform hover:scale-110"
                      style={{ background: p.value || "var(--secondary)" }}
                      title={p.label}
                      onClick={() => {
                        commit((d) => ({
                          ...d,
                          objects: d.objects.map((o) => (selectedIds.includes(o.id) ? { ...o, color: p.value || undefined } : o)),
                        }));
                        toast.success(`Applied ${p.label} to ${selectedIds.length} objects`);
                      }}
                    >
                      {!p.value && <span className="text-[10px] text-muted-foreground">∅</span>}
                    </button>
                  ))}
                  <label className="flex h-5 w-5 cursor-pointer items-center justify-center rounded border border-dashed border-border bg-secondary hover:border-primary" title="Pick custom color">
                    <input
                      type="color"
                      className="sr-only"
                      onChange={(e) => {
                        const val = e.target.value;
                        commit((d) => ({
                          ...d,
                          objects: d.objects.map((o) => (selectedIds.includes(o.id) ? { ...o, color: val } : o)),
                        }));
                      }}
                    />
                    <Plus size={11} className="text-muted-foreground" />
                  </label>
                </div>
              </div>
              <div className="flex gap-2">
                <button className="btn text-xs flex-1 justify-center text-destructive" onClick={deleteSel}>
                  <Trash2 size={13} /> Delete all ({selectedObjs.length})
                </button>
                <button className="btn text-xs px-2" onClick={() => setSelectedIds([])}>
                  Deselect
                </button>
              </div>
            </div>
          ) : selected ? (
            /* Single Selected Object Panel */
            <div className="space-y-3 border-b border-border p-4">
              <div className="flex items-center justify-between">
                <div className="label">{TYPE_LABEL[selected.type]}</div>
                <div className="flex gap-1">
                  <button className="btn btn-ghost px-2" onClick={copySel} title="Copy (Ctrl+C)"><Copy size={14} /></button>
                  <button className="btn btn-ghost px-2" onClick={duplicateSel} title="Duplicate (Ctrl+D)"><Copy size={14} /></button>
                  <button className="btn btn-ghost px-2 text-destructive" onClick={deleteSel} title="Delete"><Trash2 size={14} /></button>
                </div>
              </div>
              {selected.type === "outline" && (
                <div className="flex items-center justify-between rounded border border-border p-2 text-xs">
                  <span className="text-muted-foreground">{outlineLocked ? "Outline is locked" : "Outline is unlocked"}</span>
                  <button className="btn px-2 py-0.5 text-xs" onClick={() => setOutlineLocked(!outlineLocked)}>
                    {outlineLocked ? <Unlock size={12} /> : <Lock size={12} />}
                    {outlineLocked ? "Unlock" : "Lock"}
                  </button>
                </div>
              )}
              <label className="block space-y-1"><span className="text-xs text-muted-foreground">Name</span>
                <input className="field" autoFocus value={selected.name} onFocus={snapshot} onChange={(e) => updateObj(selected.id, { name: e.target.value }, false)} /></label>
              <label className="block space-y-1"><span className="text-xs text-muted-foreground">Type</span>
                <select className="field" value={selected.type} onChange={(e) => updateObj(selected.id, { type: e.target.value as ObjType })}>
                  {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select></label>
              <label className="block space-y-1"><span className="text-xs text-muted-foreground">Category</span>
                <input className="field" placeholder="e.g. Classroom, Lab, Office" value={selected.category ?? ""} onFocus={snapshot} onChange={(e) => updateObj(selected.id, { category: e.target.value }, false)} /></label>

              {/* Restroom Gender / Designation buttons */}
              {selected.type === "restroom" && (
                <div className="space-y-1.5 rounded border border-border bg-secondary/30 p-2.5">
                  <div className="text-xs font-semibold text-primary flex items-center gap-1.5">
                    <Bath size={13} /> Restroom Designation
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      className={`btn text-xs justify-start gap-1.5 py-1 ${
                        selected.gender === "boys" || /boy|men/i.test(selected.category ?? "") ? "border-blue-500 bg-blue-500/20 text-blue-300 font-medium" : ""
                      }`}
                      onClick={() => {
                        snapshot();
                        updateObj(selected.id, {
                          gender: "boys",
                          category: "Boys Restroom",
                          name: selected.name.startsWith("Restroom") ? "Boys Restroom" : selected.name,
                          color: selected.color || "#1e3a8a",
                        });
                        toast.success("Marked as Boys Restroom (🚹)");
                      }}
                    >
                      <span>🚹</span> Boys
                    </button>
                    <button
                      className={`btn text-xs justify-start gap-1.5 py-1 ${
                        selected.gender === "girls" || /girl|women/i.test(selected.category ?? "") ? "border-pink-500 bg-pink-500/20 text-pink-300 font-medium" : ""
                      }`}
                      onClick={() => {
                        snapshot();
                        updateObj(selected.id, {
                          gender: "girls",
                          category: "Girls Restroom",
                          name: selected.name.startsWith("Restroom") ? "Girls Restroom" : selected.name,
                          color: selected.color || "#831843",
                        });
                        toast.success("Marked as Girls Restroom (🚺)");
                      }}
                    >
                      <span>🚺</span> Girls
                    </button>
                    <button
                      className={`btn text-xs justify-start gap-1.5 py-1 ${
                        selected.gender === "unisex" || /unisex/i.test(selected.category ?? "") ? "border-purple-500 bg-purple-500/20 text-purple-300 font-medium" : ""
                      }`}
                      onClick={() => {
                        snapshot();
                        updateObj(selected.id, {
                          gender: "unisex",
                          category: "Unisex Restroom",
                          name: selected.name.startsWith("Restroom") ? "Unisex Restroom" : selected.name,
                        });
                        toast.success("Marked as Unisex Restroom (🚻)");
                      }}
                    >
                      <span>🚻</span> Unisex
                    </button>
                    <button
                      className={`btn text-xs justify-start gap-1.5 py-1 ${
                        selected.gender === "accessible" || /accessible/i.test(selected.category ?? "") ? "border-emerald-500 bg-emerald-500/20 text-emerald-300 font-medium" : ""
                      }`}
                      onClick={() => {
                        snapshot();
                        updateObj(selected.id, {
                          gender: "accessible",
                          category: "Accessible Restroom",
                          name: selected.name.startsWith("Restroom") ? "Accessible Restroom" : selected.name,
                        });
                        toast.success("Marked as Accessible Restroom (♿)");
                      }}
                    >
                      <span>♿</span> Accessible
                    </button>
                  </div>
                </div>
              )}

              {/* Quick Door Connection for Rooms, Labs, Restrooms */}
              {["room", "lab", "restroom", "lobby"].includes(selected.type) && (
                <div className="space-y-1.5 rounded border border-border bg-secondary/30 p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-primary flex items-center gap-1.5">
                      <DoorOpen size={13} /> Add Preset Door (1m)
                    </span>
                    <button
                      className="btn btn-ghost px-2 py-0.5 text-xs text-primary"
                      onClick={() => createPresetDoor(selected, undefined, "auto")}
                      title="Auto-detects the adjacent corridor wall and places a standard visible door"
                    >
                      <Plus size={12} /> Auto
                    </button>
                  </div>
                  <div className="grid grid-cols-4 gap-1 text-[11px]">
                    {(["left", "right", "top", "bottom"] as const).map((side) => (
                      <button
                        key={side}
                        className="btn px-1 py-1 justify-center capitalize text-[10px]"
                        onClick={() => createPresetDoor(selected, undefined, side)}
                        title={`Place door on ${side} edge`}
                      >
                        {side}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Color Customization */}
              <div className="space-y-2 rounded border border-border p-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                    <Palette size={13} /> Color & Tint
                  </span>
                  {selected.color && (
                    <button
                      className="text-[11px] text-muted-foreground hover:text-foreground underline"
                      onClick={() => updateObj(selected.id, { color: undefined })}
                    >
                      Reset default
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {COLOR_PRESETS.map((p) => (
                    <button
                      key={p.label}
                      className={`h-5 w-5 rounded border transition-transform hover:scale-110 ${
                        (selected.color ?? "") === p.value ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : "border-border"
                      }`}
                      style={{ background: p.value || "var(--secondary)" }}
                      title={p.label}
                      onClick={() => updateObj(selected.id, { color: p.value || undefined })}
                    >
                      {!p.value && <span className="text-[10px] text-muted-foreground">∅</span>}
                    </button>
                  ))}
                  <label className="flex h-5 w-5 cursor-pointer items-center justify-center rounded border border-dashed border-border bg-secondary hover:border-primary" title="Pick custom color">
                    <input
                      type="color"
                      className="sr-only"
                      value={selected.color?.startsWith("#") ? selected.color : "#3b82f6"}
                      onChange={(e) => updateObj(selected.id, { color: e.target.value })}
                    />
                    <Plus size={11} className="text-muted-foreground" />
                  </label>
                </div>
                {selected.color && (
                  <div className="flex items-center gap-2 pt-0.5">
                    <div className="h-3.5 w-3.5 rounded border border-border" style={{ background: selected.color }} />
                    <span className="font-mono text-[11px] text-muted-foreground">{selected.color}</span>
                  </div>
                )}
              </div>

              {CONNECTORS.includes(selected.type) && (
                <label className="block space-y-1"><span className="text-xs text-muted-foreground">Link ID — same ID on each floor connects them</span>
                  <input className="field font-mono" value={selected.connector ?? ""} onFocus={snapshot} onChange={(e) => updateObj(selected.id, { connector: e.target.value }, false)} /></label>
              )}
              {/* Resize Mode: Normal 8-handle box vs Polygon points */}
              {!POINTLIKE.includes(selected.type) && selected.type !== "wall" && (
                <div className="space-y-2 rounded border border-border bg-secondary/30 p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-primary flex items-center gap-1.5">
                      <Square size={13} /> Resize Mode
                    </span>
                    {selected.points && selected.points.length > 0 && selected.type !== "outline" && (
                      <button
                        className="text-[11px] text-amber-400 hover:text-amber-300 hover:underline"
                        onClick={() => {
                          snapshot();
                          const bbox = bboxOf(selected.points!);
                          updateObj(selected.id, {
                            points: undefined,
                            x: snapVal(bbox.x),
                            y: snapVal(bbox.y),
                            w: Math.max(0.5, snapVal(bbox.w)),
                            h: Math.max(0.5, snapVal(bbox.h)),
                          });
                          setResizeMode("box");
                          toast.success("Converted to clean normal rectangle");
                        }}
                        title="Remove polygon slant/points and flatten to normal rectangle"
                      >
                        Reset to rectangle
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      className={`btn text-xs justify-center py-1 gap-1.5 ${
                        resizeMode === "box" ? "border-primary bg-primary/20 text-primary font-medium" : "text-muted-foreground"
                      }`}
                      onClick={() => setResizeMode("box")}
                      title="Normal 8-handle box resize (clean, no polygon vertex dots)"
                    >
                      <Square size={12} /> Normal Box
                    </button>
                    <button
                      className={`btn text-xs justify-center py-1 gap-1.5 ${
                        resizeMode === "polygon" ? "border-primary bg-primary/20 text-primary font-medium" : "text-muted-foreground"
                      }`}
                      onClick={() => {
                        setResizeMode("polygon");
                        if (!selected.points) {
                          const pts = cornersOf(selected).map((p) => [...p] as [number, number]);
                          updateObj(selected.id, { points: pts });
                        }
                      }}
                      title="Edit individual polygon corner points"
                    >
                      <Pentagon size={12} /> Polygon Points
                    </button>
                  </div>
                  <div className="text-[11px] text-muted-foreground leading-tight">
                    {resizeMode === "box"
                      ? "Normal mode: drag the 8 box handles to stretch width/height cleanly."
                      : "Polygon mode: drag corner dots or midpoints to shape custom angles."}
                  </div>
                </div>
              )}

              <TransformControls onRotate={rotateSel} onScale={scaleSel} />
              <div className="grid grid-cols-4 gap-2">
                {(["x", "y", "w", "h"] as const).map((k) => (
                  <label key={k} className="space-y-1"><span className="font-mono text-xs text-muted-foreground">{k}</span>
                    <input className="field font-mono" type="number" step={0.5} value={selected[k]} onFocus={snapshot} onChange={(e) => {
                      const v = Number(e.target.value); const n = { x: selected.x, y: selected.y, w: selected.w, h: selected.h, [k]: k === "w" || k === "h" ? Math.max(0.5, v) : v };
                      commit((d) => ({ ...d, objects: d.objects.map((o) => (o.id === selected.id ? transformObj(selected, n.x, n.y, n.w, n.h) : o)) }), false);
                    }} /></label>
                ))}
              </div>
            </div>
          ) : (
            <div className="border-b border-border p-4 text-xs leading-relaxed text-muted-foreground">
              Pick a tool on the left and drag on the grid to draw. Drag empty space to box-select, Shift+click for multi-select, Ctrl+C/V to copy/paste.
            </div>
          )}

          {/* Objects List on this Floor */}
          <div className="flex min-h-0 flex-1 flex-col p-4">
            <div className="label mb-2">Objects on this floor</div>
            <input className="field mb-2" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
              {list.map((o) => {
                const isItemSel = selectedIdSet.has(o.id);
                return (
                  <button
                    key={o.id}
                    onClick={(e) => {
                      if (e.shiftKey) {
                        setSelectedIds((prev) =>
                          prev.includes(o.id) ? prev.filter((id) => id !== o.id) : [...prev, o.id]
                        );
                      } else {
                        setSelectedIds([o.id]);
                      }
                    }}
                    className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm hover:bg-accent"
                    style={isItemSel ? { background: "var(--accent)", color: "var(--primary)" } : undefined}
                  >
                    <span className="truncate flex items-center gap-1.5">
                      {isItemSel && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                      {o.name || <em className="text-muted-foreground">unnamed</em>}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground flex items-center gap-1">
                      {o.type === "outline" && outlineLocked && <Lock size={10} className="text-amber-400" />}
                      {o.type}
                    </span>
                  </button>
                );
              })}
            </div>
            {issues.length > 0 && (
              <div className="mt-3 rounded border border-border p-2 text-xs text-muted-foreground">
                <div className="label mb-1 text-primary">Checks</div>
                {issues.map((i) => <div key={i}>• {i}</div>)}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
