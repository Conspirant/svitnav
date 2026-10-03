import { center, CONNECTORS, HAS_STEPS, WALKABLE, type MapDoc, type MapObject, type ObjType } from "./types";

const RES = 0.5; // meters per grid cell
const COST: Record<string, number> = { stairs: 12, escalator: 10, ramp: 14, elevator: 18 };
const AREA = new Set<string>(WALKABLE);

export function pointInPoly(x: number, y: number, pts: [number, number][]) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function containsPoint(o: MapObject, x: number, y: number) {
  if (o.points && o.points.length >= 3 && o.type !== "wall") return pointInPoly(x, y, o.points);
  return x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h;
}

function distSeg(px: number, py: number, a: [number, number], b: [number, number]) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l = dx * dx + dy * dy;
  let t = l ? ((px - a[0]) * dx + (py - a[1]) * dy) / l : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy);
}

export const TRANSIT_TYPES: ObjType[] = ["corridor", "lobby", "entrance", "stairs", "elevator", "escalator", "ramp", "door"];
export const PRIVATE_ROOM_TYPES: ObjType[] = ["room", "lab", "restroom"];

export interface Graph {
  minX: number; minY: number; cols: number; rows: number;
  floorIds: string[]; levels: number[];
  grids: Uint8Array[]; conn: Int32Array[];
  transit: Uint8Array[];
  roomOwner: Int32Array[];
  clearance: Float32Array[];
  corridorDist: Float32Array[];
}

function computeClearance(grid: Uint8Array, cols: number, rows: number): Float32Array {
  const N = cols * rows;
  const dist = new Float32Array(N).fill(99);
  const q: number[] = [];
  for (let i = 0; i < N; i++) {
    if (!grid[i]) {
      dist[i] = 0;
      q.push(i);
    }
  }
  let head = 0;
  while (head < q.length) {
    const curr = q[head++];
    const d = dist[curr];
    if (d >= 2.5) continue;
    const r = Math.floor(curr / cols), c = curr % cols;
    if (r > 0) {
      const nb = (r - 1) * cols + c;
      if (dist[nb] > d + RES) { dist[nb] = d + RES; q.push(nb); }
    }
    if (r < rows - 1) {
      const nb = (r + 1) * cols + c;
      if (dist[nb] > d + RES) { dist[nb] = d + RES; q.push(nb); }
    }
    if (c > 0) {
      const nb = r * cols + (c - 1);
      if (dist[nb] > d + RES) { dist[nb] = d + RES; q.push(nb); }
    }
    if (c < cols - 1) {
      const nb = r * cols + (c + 1);
      if (dist[nb] > d + RES) { dist[nb] = d + RES; q.push(nb); }
    }
  }
  return dist;
}

export function buildGraph(doc: MapDoc): Graph | null {
  if (!doc.objects.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const o of doc.objects) {
    minX = Math.min(minX, o.x); minY = Math.min(minY, o.y);
    maxX = Math.max(maxX, o.x + o.w); maxY = Math.max(maxY, o.y + o.h);
  }
  minX -= 1; minY -= 1; maxX += 1; maxY += 1;
  const cols = Math.ceil((maxX - minX) / RES), rows = Math.ceil((maxY - minY) / RES);
  const N = cols * rows;
  const floorIds = doc.floors.map((f) => f.id);
  const grids: Uint8Array[] = [], conn: Int32Array[] = [];
  const transitArr: Uint8Array[] = [], roomOwnerArr: Int32Array[] = [];
  const clearanceArr: Float32Array[] = [];
  const corridorDistArr: Float32Array[] = [];
  const cellRange = (o: { x: number; y: number; w: number; h: number }, pad = 0) => ({
    c0: Math.max(0, Math.floor((o.x - pad - minX) / RES)),
    c1: Math.min(cols - 1, Math.ceil((o.x + o.w + pad - minX) / RES)),
    r0: Math.max(0, Math.floor((o.y - pad - minY) / RES)),
    r1: Math.min(rows - 1, Math.ceil((o.y + o.h + pad - minY) / RES)),
  });
  for (const fid of floorIds) {
    const grid = new Uint8Array(N), cn = new Int32Array(N);
    const transit = new Uint8Array(N), roomOwner = new Int32Array(N);
    const idxs = doc.objects.map((o, i) => [o, i] as const).filter(([o]) => o.floorId === fid);
    for (const [o, i] of idxs) {
      if (!AREA.has(o.type)) continue;
      const isTransit = TRANSIT_TYPES.includes(o.type);
      const isRoom = PRIVATE_ROOM_TYPES.includes(o.type);
      const { c0, c1, r0, r1 } = cellRange(o);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const x = minX + (c + 0.5) * RES, y = minY + (r + 0.5) * RES;
        if (containsPoint(o, x, y)) {
          const idx = r * cols + c;
          grid[idx] = 1;
          if (isTransit) transit[idx] = 1;
          if (isRoom) roomOwner[idx] = i + 1;
          if (CONNECTORS.includes(o.type) && o.connector) cn[idx] = i + 1;
        }
      }
    }

    // Perimeter walls for rooms that have doors placed on their boundary:
    const floorDoors = idxs.filter(([x]) => x.type === "door").map(([x]) => x);
    for (const [o] of idxs) {
      if (!PRIVATE_ROOM_TYPES.includes(o.type)) continue;
      const segs: [[number, number], [number, number]][] = [];
      if (o.points && o.points.length >= 3) {
        for (let k = 0; k < o.points.length; k++) {
          segs.push([o.points[k], o.points[(k + 1) % o.points.length]]);
        }
      } else {
        segs.push([[o.x, o.y], [o.x + o.w, o.y]]);
        segs.push([[o.x + o.w, o.y], [o.x + o.w, o.y + o.h]]);
        segs.push([[o.x + o.w, o.y + o.h], [o.x, o.y + o.h]]);
        segs.push([[o.x, o.y + o.h], [o.x, o.y]]);
      }

      const hasDoor = floorDoors.some((d) => {
        const dcx = d.x + d.w / 2, dcy = d.y + d.h / 2;
        return segs.some(([a, b]) => distSeg(dcx, dcy, a, b) < Math.max(d.w, d.h) + 0.4);
      });

      if (hasDoor) {
        for (const [a, b] of segs) {
          const sc0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - 0.5 - minX) / RES));
          const sc1 = Math.min(cols - 1, Math.ceil((Math.max(a[0], b[0]) + 0.5 - minX) / RES));
          const sr0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - 0.5 - minY) / RES));
          const sr1 = Math.min(rows - 1, Math.ceil((Math.max(a[1], b[1]) + 0.5 - minY) / RES));
          for (let r = sr0; r <= sr1; r++) for (let c = sc0; c <= sc1; c++) {
            const x = minX + (c + 0.5) * RES, y = minY + (r + 0.5) * RES;
            if (distSeg(x, y, a, b) < RES * 0.75) {
              grid[r * cols + c] = 0;
            }
          }
        }
      }
    }

    for (const [o] of idxs) {
      if (o.type !== "wall" || !o.points || o.points.length < 2) continue;
      const { c0, c1, r0, r1 } = cellRange(o, 0.5);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const x = minX + (c + 0.5) * RES, y = minY + (r + 0.5) * RES;
        for (let k = 0; k < o.points.length - 1; k++)
          if (distSeg(x, y, o.points[k], o.points[k + 1]) < RES * 0.75) { grid[r * cols + c] = 0; break; }
      }
    }
    for (const [o] of idxs) {
      if (o.type !== "obstacle") continue;
      const { c0, c1, r0, r1 } = cellRange(o);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const x = minX + (c + 0.5) * RES, y = minY + (r + 0.5) * RES;
        if (containsPoint(o, x, y)) grid[r * cols + c] = 0;
      }
    }
    for (const [o] of idxs) {
      if (o.type !== "door") continue;
      const { c0, c1, r0, r1 } = cellRange(o, 0.2);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const x = minX + (c + 0.5) * RES, y = minY + (r + 0.5) * RES;
        if (containsPoint(o, x, y) || distSeg(x, y, [o.x, o.y], [o.x + o.w, o.y + o.h]) < RES) {
          const idx = r * cols + c;
          grid[idx] = 1;
          transit[idx] = 1;
        }
      }
    }

    // Corridor centerline distance map for indoor structured wayfinding:
    const cDist = new Float32Array(N).fill(-1);
    const floorCorridors = idxs
      .filter(([o]) => o.type === "corridor")
      .map(([o]) => o);

    for (const o of floorCorridors) {
      const isHoriz = o.w >= o.h;
      const cy = o.y + o.h / 2;
      const cx = o.x + o.w / 2;
      const { c0, c1, r0, r1 } = cellRange(o, 0.2);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const x = minX + (c + 0.5) * RES;
          const y = minY + (r + 0.5) * RES;
          if (x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h) {
            const idx = r * cols + c;
            const d = isHoriz ? Math.abs(y - cy) : Math.abs(x - cx);
            if (cDist[idx] < 0 || d < cDist[idx]) {
              cDist[idx] = d;
            }
          }
        }
      }
    }

    const clr = computeClearance(grid, cols, rows);
    grids.push(grid); conn.push(cn); transitArr.push(transit); roomOwnerArr.push(roomOwner); clearanceArr.push(clr);
    corridorDistArr.push(cDist);
  }
  return { minX, minY, cols, rows, floorIds, levels: doc.floors.map((f) => f.level), grids, conn, transit: transitArr, roomOwner: roomOwnerArr, clearance: clearanceArr, corridorDist: corridorDistArr };
}

function nearestWalkable(g: Graph, fi: number, x: number, y: number, isWalkableCell?: (cell: number) => boolean) {
  const c0 = Math.floor((x - g.minX) / RES), r0 = Math.floor((y - g.minY) / RES);
  const grid = g.grids[fi];
  for (let rad = 0; rad < 40; rad++) {
    let best = -1, bd = Infinity;
    for (let r = r0 - rad; r <= r0 + rad; r++) for (let c = c0 - rad; c <= c0 + rad; c++) {
      if (Math.max(Math.abs(r - r0), Math.abs(c - c0)) !== rad) continue;
      if (r < 0 || c < 0 || r >= g.rows || c >= g.cols) continue;
      const idx = r * g.cols + c;
      if (isWalkableCell ? !isWalkableCell(idx) : !grid[idx]) continue;
      const d = (r - r0) ** 2 + (c - c0) ** 2;
      if (d < bd) { bd = d; best = idx; }
    }
    if (best >= 0) return best;
  }
  return -1;
}

class Heap {
  k: number[] = []; v: number[] = [];
  push(key: number, val: number) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]]; [v[p], v[i]] = [v[i], v[p]]; i = p; }
  }
  pop() {
    const k = this.k, v = this.v; const top = v[0];
    const lk = k.pop()!, lv = v.pop()!;
    if (k.length) { k[0] = lk; v[0] = lv; let i = 0;
      for (;;) { const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < k.length && k[l] < k[m]) m = l; if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break; [k[m], k[i]] = [k[i], k[m]]; [v[m], v[i]] = [v[i], v[m]]; i = m; } }
    return top;
  }
  get size() { return this.k.length; }
}

export interface RouteLeg { floorId: string; points: [number, number][]; length: number }
export interface RouteTransition { via: MapObject; fromFloorId: string; toFloorId: string }
export interface Route { legs: RouteLeg[]; transitions: RouteTransition[]; total: number }

export function findRoute(doc: MapDoc, g: Graph, from: MapObject, to: MapObject, opts: { avoidStairs?: boolean } = {}): Route | null {
  const { cols, rows } = g; const N = cols * rows; const F = g.floorIds.length;
  const sf = g.floorIds.indexOf(from.floorId), tf = g.floorIds.indexOf(to.floorId);
  if (sf < 0 || tf < 0) return null;

  const allowedObjIndices = new Set<number>();
  const fromIdx = doc.objects.indexOf(from);
  const toIdx = doc.objects.indexOf(to);
  if (fromIdx >= 0) allowedObjIndices.add(fromIdx + 1);
  if (toIdx >= 0) allowedObjIndices.add(toIdx + 1);

  // If from or to is POI, Label, or Entrance, also allow any room that contains it
  for (const ptObj of [from, to]) {
    if (ptObj.type === "poi" || ptObj.type === "label" || ptObj.type === "entrance") {
      const [cx, cy] = center(ptObj);
      doc.objects.forEach((o, i) => {
        if (o.floorId === ptObj.floorId && PRIVATE_ROOM_TYPES.includes(o.type) && containsPoint(o, cx, cy)) {
          allowedObjIndices.add(i + 1);
        }
      });
    }
  }

  const isWalkable = (fi: number, cell: number, strict: boolean): boolean => {
    if (!g.grids[fi][cell]) return false;
    if (!strict) return true;
    if (g.transit && g.transit[fi] && g.transit[fi][cell]) return true;
    const owner = g.roomOwner && g.roomOwner[fi] ? g.roomOwner[fi][cell] : 0;
    if (owner && allowedObjIndices.has(owner)) return true;
    if (!owner) return true;
    return false; // intermediate rooms (Room 25, etc.) are NOT transit shortcuts!
  };

  let sc = nearestWalkable(g, sf, ...center(from), (cell) => isWalkable(sf, cell, true));
  if (sc < 0) sc = nearestWalkable(g, sf, ...center(from));
  let tc = nearestWalkable(g, tf, ...center(to), (cell) => isWalkable(tf, cell, true));
  if (tc < 0) tc = nearestWalkable(g, tf, ...center(to));
  if (sc < 0 || tc < 0) return null;

  // Connector groups: connector -> floor transition endpoints
  const groups = new Map<string, { fi: number; cell: number }[]>();
  doc.objects.forEach((o) => {
    if (!CONNECTORS.includes(o.type) || !o.connector) return;
    const fi = g.floorIds.indexOf(o.floorId); if (fi < 0) return;
    const cell = nearestWalkable(g, fi, ...center(o)); if (cell < 0) return;
    const arr = groups.get(o.connector) ?? []; arr.push({ fi, cell }); groups.set(o.connector, arr);
  });

  const tr = Math.floor(tc / cols), tcc = tc % cols;
  const h = (cell: number) => Math.hypot(Math.floor(cell / cols) - tr, (cell % cols) - tcc) * RES;
  const start = sf * N + sc, goal = tf * N + tc;
  const D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 2.5], [-1, 1, 2.5], [1, -1, 2.5], [-1, -1, 2.5]];

  const runAStar = (strict: boolean) => {
    const gs = new Float64Array(F * N).fill(Infinity);
    const came = new Int32Array(F * N).fill(-1);
    const closed = new Uint8Array(F * N);
    gs[start] = 0;
    const heap = new Heap(); heap.push(h(sc), start);
    let found = false;
    while (heap.size) {
      const node = heap.pop();
      if (closed[node]) continue; closed[node] = 1;
      if (node === goal) { found = true; break; }
      const fi = Math.floor(node / N), cell = node % N;
      const r = Math.floor(cell / cols), c = cell % cols;
      const relax = (nn: number, cost: number, cellN: number) => {
        const ng = gs[node] + cost;
        if (ng < gs[nn]) { gs[nn] = ng; came[nn] = node; heap.push(ng + h(cellN), nn); }
      };
      for (const [dr, dc, w] of D) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
        const ncell = nr * cols + nc;
        if (!isWalkable(fi, ncell, strict)) continue;
        if (dr && dc && (!isWalkable(fi, r * cols + nc, strict) || !isWalkable(fi, nr * cols + c, strict))) continue;
        const clr = g.clearance && g.clearance[fi] ? g.clearance[fi][ncell] : 1.0;
        const clearancePenalty = clr < 1.0 ? (1.0 - clr) * 3.0 : 0;
        let corridorCenterPenalty = 0;
        if (g.corridorDist && g.corridorDist[fi]) {
          const cd = g.corridorDist[fi][ncell];
          if (cd >= 0) {
            corridorCenterPenalty = cd * 3.0;
          }
        }
        relax(fi * N + ncell, (w + clearancePenalty + corridorCenterPenalty) * RES, ncell);
      }
      const ci = g.conn[fi][cell];
      if (ci) {
        const o = doc.objects[ci - 1];
        if (!(opts.avoidStairs && HAS_STEPS.includes(o.type))) {
          for (const t of groups.get(o.connector!) ?? []) {
            if (t.fi === fi) continue;
            const dl = Math.abs(g.levels[t.fi] - g.levels[fi]) || 1;
            relax(t.fi * N + t.cell, (COST[o.type] ?? 18) * dl, t.cell);
          }
        }
      }
    }
    return { found, came };
  };

  let strictMode = true;
  let res = runAStar(true);
  if (!res.found) {
    strictMode = false;
    res = runAStar(false);
  }
  if (!res.found) return null;

  const nodes: number[] = [];
  for (let n = goal; n !== -1; n = res.came[n]) nodes.push(n);
  nodes.reverse();
  const legs: RouteLeg[] = []; const transitions: RouteTransition[] = [];
  let cur: { fi: number; cells: number[] } = { fi: Math.floor(nodes[0] / N), cells: [] };
  for (let i = 0; i < nodes.length; i++) {
    const fi = Math.floor(nodes[i] / N), cell = nodes[i] % N;
    if (fi !== cur.fi) {
      const prevCell = nodes[i - 1] % N; const ci = g.conn[cur.fi][prevCell];
      legs.push(makeLeg(g, cur.fi, cur.cells, (c) => isWalkable(cur.fi, c, strictMode), doc.objects));
      if (ci) transitions.push({ via: doc.objects[ci - 1], fromFloorId: g.floorIds[cur.fi], toFloorId: g.floorIds[fi] });
      cur = { fi, cells: [] };
    }
    cur.cells.push(cell);
  }
  legs.push(makeLeg(g, cur.fi, cur.cells, (c) => isWalkable(cur.fi, c, strictMode), doc.objects));
  return { legs, transitions, total: legs.reduce((s, l) => s + l.length, 0) };
}

function makeLeg(
  g: Graph,
  fi: number,
  cells: number[],
  isWalkableCell: (cell: number) => boolean,
  objects: MapObject[] = []
): RouteLeg {
  const pt = (cell: number): [number, number] => [
    g.minX + ((cell % g.cols) + 0.5) * RES,
    g.minY + (Math.floor(cell / g.cols) + 0.5) * RES,
  ];

  const floorId = g.floorIds[fi];
  const corridors = objects
    .filter((o) => o.floorId === floorId && o.type === "corridor")
    .sort((a, b) => (a.w * a.h) - (b.w * b.h));

  const doors = objects.filter((o) => o.floorId === floorId && o.type === "door");

  const isWalkableAt = (x: number, y: number): boolean => {
    const c = Math.floor((x - g.minX) / RES);
    const r = Math.floor((y - g.minY) / RES);
    if (r < 0 || c < 0 || r >= g.rows || c >= g.cols) return false;
    return isWalkableCell(r * g.cols + c);
  };

  const los = (a: [number, number], b: [number, number], minClearance = 0.35) => {
    const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (RES / 3));
    for (let s = 0; s <= steps; s++) {
      const x = a[0] + ((b[0] - a[0]) * s) / steps, y = a[1] + ((b[1] - a[1]) * s) / steps;
      const c = Math.floor((x - g.minX) / RES), r = Math.floor((y - g.minY) / RES);
      if (r < 0 || c < 0 || r >= g.rows || c >= g.cols) return false;
      const cell = r * g.cols + c;
      if (!isWalkableCell(cell)) return false;
      if (minClearance > 0 && s > 2 && s < steps - 2) {
        if (g.clearance && g.clearance[fi] && g.clearance[fi][cell] < minClearance) return false;
      }
    }
    return true;
  };

  const snapToFeatures = (px: number, py: number): [number, number] => {
    let newX = px;
    let newY = py;
    let matchedH = false;
    let matchedV = false;

    // 1. Doorway threshold alignment (strict perpendicular approach/exit through doors):
    for (const d of doors) {
      const dcx = +(d.x + d.w / 2).toFixed(2);
      const dcy = +(d.y + d.h / 2).toFixed(2);
      const isHorizDoor = d.w >= d.h;
      if (isHorizDoor) {
        if (Math.abs(px - dcx) <= Math.max(d.w / 2 + 0.35, 1.0) && Math.abs(py - dcy) <= 1.6) {
          newX = dcx;
          matchedV = true;
          break;
        }
      } else {
        if (Math.abs(py - dcy) <= Math.max(d.h / 2 + 0.35, 1.0) && Math.abs(px - dcx) <= 1.6) {
          newY = dcy;
          matchedH = true;
          break;
        }
      }
    }

    // 2. Corridor centerline snapping:
    for (const c of corridors) {
      if (px >= c.x - 0.25 && px <= c.x + c.w + 0.25 && py >= c.y - 0.25 && py <= c.y + c.h + 0.25) {
        if (!matchedH && c.w >= c.h * 1.15) {
          newY = +(c.y + c.h / 2).toFixed(2);
          matchedH = true;
        }
        if (!matchedV && c.h >= c.w * 1.15) {
          newX = +(c.x + c.w / 2).toFixed(2);
          matchedV = true;
        }
        if (matchedH && matchedV) break;
      }
    }
    return [newX, newY];
  };

  const raw = cells.map(pt);
  if (raw.length === 0) return { floorId, points: [], length: 0 };

  // Step 1: Snap all points to corridor centerlines & door perpendicular axes
  const snapped = raw.map(([x, y]) => snapToFeatures(x, y));

  // Step 2: Collinear reduction along corridor centerlines & door approaches
  const reduced: [number, number][] = [snapped[0]];
  for (let k = 1; k < snapped.length - 1; k++) {
    const prev = reduced[reduced.length - 1];
    const curr = snapped[k];
    const next = snapped[k + 1];
    const isCollinearX = Math.abs(prev[0] - curr[0]) < 0.05 && Math.abs(curr[0] - next[0]) < 0.05;
    const isCollinearY = Math.abs(prev[1] - curr[1]) < 0.05 && Math.abs(curr[1] - next[1]) < 0.05;
    if (!isCollinearX && !isCollinearY) {
      reduced.push(curr);
    }
  }
  if (snapped.length > 1) {
    reduced.push(snapped[snapped.length - 1]);
  }

  // Step 3: LOS compression that preserves doorway thresholds and axial lines
  const isDoorPivot = (pt: [number, number]): boolean => {
    return doors.some((d) => {
      const dcx = d.x + d.w / 2, dcy = d.y + d.h / 2;
      return Math.hypot(pt[0] - dcx, pt[1] - dcy) <= Math.max(d.w, d.h) * 0.75 + 0.2;
    });
  };

  const out: [number, number][] = [reduced[0]];
  let idx = 0;
  while (idx < reduced.length - 1) {
    let j = reduced.length - 1;
    while (j > idx + 1) {
      // Never skip across a doorway threshold (prevents grazing diagonal wall cuts)
      let skipsDoor = false;
      for (let k = idx + 1; k < j; k++) {
        if (isDoorPivot(reduced[k])) {
          skipsDoor = true;
          break;
        }
      }
      if (!skipsDoor) {
        const pA = reduced[idx], pB = reduced[j];
        const isAxial = Math.abs(pA[0] - pB[0]) < 0.08 || Math.abs(pA[1] - pB[1]) < 0.08;
        if (isAxial && los(pA, pB, 0.35)) {
          break;
        }
        // In open room interiors, allow LOS simplification ONLY if a clean L-turn corner is completely walkable
        if (!isAxial && los(pA, pB, 0.35)) {
          const cornerA: [number, number] = [pB[0], pA[1]];
          const cornerB: [number, number] = [pA[0], pB[1]];
          const okA = isWalkableAt(cornerA[0], cornerA[1]) && los(pA, cornerA, 0.2) && los(cornerA, pB, 0.2);
          const okB = isWalkableAt(cornerB[0], cornerB[1]) && los(pA, cornerB, 0.2) && los(cornerB, pB, 0.2);
          if (okA || okB) {
            break;
          }
        }
      }
      j--;
    }
    out.push(reduced[j]);
    idx = j;
  }

  // Step 4: Orthogonalize non-axial segments (replace slants with clean 90° L-turns)
  const ortho: [number, number][] = [out[0]];
  for (let k = 1; k < out.length; k++) {
    const p0 = ortho[ortho.length - 1];
    const p1 = out[k];
    const dx = Math.abs(p1[0] - p0[0]);
    const dy = Math.abs(p1[1] - p0[1]);

    if (dy < 0.15) {
      ortho.push([p1[0], p0[1]]);
      continue;
    }
    if (dx < 0.15) {
      ortho.push([p0[0], p1[1]]);
      continue;
    }

    const cornerA: [number, number] = [p1[0], p0[1]]; // Horizontal first, then Vertical
    const cornerB: [number, number] = [p0[0], p1[1]]; // Vertical first, then Horizontal

    const walkableA = isWalkableAt(cornerA[0], cornerA[1]) && los(p0, cornerA, 0.15) && los(cornerA, p1, 0.15);
    const walkableB = isWalkableAt(cornerB[0], cornerB[1]) && los(p0, cornerB, 0.15) && los(cornerB, p1, 0.15);

    if (walkableA && !walkableB) {
      ortho.push(cornerA, p1);
    } else if (walkableB && !walkableA) {
      ortho.push(cornerB, p1);
    } else if (walkableA && walkableB) {
      // If exiting or entering a vertical doorway movement, prefer continuing along the doorway axis
      const nearHorizDoor = doors.some((d) => d.w >= d.h && Math.abs(p0[0] - (d.x + d.w / 2)) < 0.5);
      if (nearHorizDoor) {
        ortho.push(cornerB, p1); // Vertical first, then horizontal
      } else {
        const inCorridorA = corridors.some((c) => cornerA[0] >= c.x && cornerA[0] <= c.x + c.w && cornerA[1] >= c.y && cornerA[1] <= c.y + c.h);
        const inCorridorB = corridors.some((c) => cornerB[0] >= c.x && cornerB[0] <= c.x + c.w && cornerB[1] >= c.y && cornerB[1] <= c.y + c.h);
        if (inCorridorB && !inCorridorA) ortho.push(cornerB, p1);
        else ortho.push(cornerA, p1);
      }
    } else {
      ortho.push(p1);
    }
  }

  // Step 5: Final collinear cleanup
  const finalOut: [number, number][] = [ortho[0]];
  for (let k = 1; k < ortho.length - 1; k++) {
    const prev = finalOut[finalOut.length - 1];
    const curr = ortho[k];
    const next = ortho[k + 1];
    const isCollinearX = Math.abs(prev[0] - curr[0]) < 0.05 && Math.abs(curr[0] - next[0]) < 0.05;
    const isCollinearY = Math.abs(prev[1] - curr[1]) < 0.05 && Math.abs(curr[1] - next[1]) < 0.05;
    if (!isCollinearX && !isCollinearY) {
      finalOut.push(curr);
    }
  }
  finalOut.push(ortho[ortho.length - 1]);

  let length = 0;
  for (let k = 1; k < finalOut.length; k++) {
    length += Math.hypot(finalOut[k][0] - finalOut[k - 1][0], finalOut[k][1] - finalOut[k - 1][1]);
  }
  return { floorId, points: finalOut, length };
}

export function pointsToSmoothPath(points: [number, number][], radius = 0.9): string {
  if (points.length < 2) return "";
  if (points.length === 2) return `M ${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)} L ${points[1][0].toFixed(2)} ${points[1][1].toFixed(2)}`;

  let d = `M ${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p0 = points[i - 1], p1 = points[i], p2 = points[i + 1];
    const v0x = p0[0] - p1[0], v0y = p0[1] - p1[1];
    const v1x = p2[0] - p1[0], v1y = p2[1] - p1[1];
    const d0 = Math.hypot(v0x, v0y), d1 = Math.hypot(v1x, v1y);
    if (d0 < 0.05 || d1 < 0.05) continue;
    const r = Math.min(radius, d0 / 2, d1 / 2);
    const startX = p1[0] + (v0x / d0) * r;
    const startY = p1[1] + (v0y / d0) * r;
    const endX = p1[0] + (v1x / d1) * r;
    const endY = p1[1] + (v1y / d1) * r;
    d += ` L ${startX.toFixed(2)} ${startY.toFixed(2)} Q ${p1[0].toFixed(2)} ${p1[1].toFixed(2)} ${endX.toFixed(2)} ${endY.toFixed(2)}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last[0].toFixed(2)} ${last[1].toFixed(2)}`;
  return d;
}
