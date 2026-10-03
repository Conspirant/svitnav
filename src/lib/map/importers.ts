import { bboxOf, uid, type MapDoc, type MapObject, type ObjType } from "./types";

const TYPES: ObjType[] = ["outline", "room", "lab", "corridor", "lobby", "restroom", "stairs", "elevator", "escalator", "ramp", "entrance", "wall", "door", "obstacle", "poi", "label"];

function normType(t: unknown, fallback: ObjType): ObjType {
  const s = String(t ?? "").toLowerCase().trim();
  if (TYPES.includes(s as ObjType)) return s as ObjType;
  if (["laboratory", "lab", "research_lab", "computer_lab"].includes(s)) return "lab";
  if (["building", "college", "university", "school"].includes(s)) return "outline";
  if (["stair", "staircase"].includes(s)) return "stairs";
  if (["lift"].includes(s)) return "elevator";
  if (["hallway", "hall_way", "passage"].includes(s)) return "corridor";
  if (["toilet", "washroom", "wc"].includes(s)) return "restroom";
  if (["exit", "gate"].includes(s)) return "entrance";
  if (["amenity"].includes(s)) return "poi";
  return fallback;
}

function floorFor(doc: MapDoc, value: unknown, fallback: string) {
  if (value === undefined || value === null || value === "") return fallback;
  const v = String(value).trim().toLowerCase();
  const f = doc.floors.find((fl) => String(fl.level) === v || fl.name.toLowerCase() === v || fl.id === v);
  return f?.id ?? fallback;
}

/** GeoJSON (lon/lat) → local meters, origin at top-left with 5 m margin. */
export function importGeoJSON(doc: MapDoc, json: any, currentFloorId: string): MapObject[] {
  const features: any[] = json.type === "FeatureCollection" ? json.features : json.type === "Feature" ? [json] : [];
  const rings: { props: any; kind: "poly" | "line" | "point"; coords: number[][] }[] = [];
  for (const f of features) {
    const g = f.geometry; if (!g) continue;
    const props = f.properties ?? {};
    if (g.type === "Polygon") rings.push({ props, kind: "poly", coords: g.coordinates[0] });
    else if (g.type === "MultiPolygon") g.coordinates.forEach((p: any) => rings.push({ props, kind: "poly", coords: p[0] }));
    else if (g.type === "LineString") rings.push({ props, kind: "line", coords: g.coordinates });
    else if (g.type === "Point") rings.push({ props, kind: "point", coords: [g.coordinates] });
  }
  const all = rings.flatMap((r) => r.coords);
  if (!all.length) return [];
  const lat0 = all.reduce((s, c) => s + c[1], 0) / all.length;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540;
  const minLon = Math.min(...all.map((c) => c[0])), maxLat = Math.max(...all.map((c) => c[1]));
  const proj = (c: number[]): [number, number] => [
    +((c[0] - minLon) * kx + 5).toFixed(2), +((maxLat - c[1]) * ky + 5).toFixed(2),
  ];
  return rings.map(({ props, kind, coords }) => {
    const pts = coords.map(proj);
    const floorId = floorFor(doc, props.level ?? props.floor, currentFloorId);
    const name = String(props.name ?? props.ref ?? "");
    if (kind === "point") {
      return { id: uid(), floorId, type: normType(props.type ?? props.indoor, "poi"), name, category: props.category ?? props.amenity, x: pts[0][0] - 0.5, y: pts[0][1] - 0.5, w: 1, h: 1 };
    }
    if (kind === "line") {
      return { id: uid(), floorId, type: "wall" as const, name, points: pts, ...bboxOf(pts) };
    }
    if (pts.length > 1 && pts[0][0] === pts.at(-1)![0] && pts[0][1] === pts.at(-1)![1]) pts.pop();
    const type = normType(props.type ?? props.indoor ?? props.building, "outline");
    return { id: uid(), floorId, type, name, category: props.category, connector: props.connector, points: pts, ...bboxOf(pts) };
  });
}

function parseCSV(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

/** CSV columns: type,name,floor,x,y,w,h,category,connector,color,gender (x/y/w/h in meters). */
export function importCSV(doc: MapDoc, text: string, currentFloorId: string): MapObject[] {
  const rows = parseCSV(text); if (rows.length < 2) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (r: string[], k: string) => { const i = head.indexOf(k); return i >= 0 ? r[i]?.trim() : undefined; };
  const out: MapObject[] = [];
  for (const r of rows.slice(1)) {
    const x = Number(col(r, "x")), y = Number(col(r, "y"));
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const type = normType(col(r, "type"), "room");
    out.push({
      id: uid(), type, name: col(r, "name") ?? "",
      floorId: floorFor(doc, col(r, "floor") ?? col(r, "level"), currentFloorId),
      x, y, w: Number(col(r, "w") ?? col(r, "width")) || 1, h: Number(col(r, "h") ?? col(r, "height")) || 1,
      category: col(r, "category") || undefined, connector: col(r, "connector") || undefined,
      color: col(r, "color") || undefined, gender: (col(r, "gender") as any) || undefined,
    });
  }
  return out;
}
