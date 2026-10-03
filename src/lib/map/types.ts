export type ObjType =
  | "outline"
  | "room"
  | "lab"
  | "corridor"
  | "lobby"
  | "restroom"
  | "stairs"
  | "elevator"
  | "escalator"
  | "ramp"
  | "entrance"
  | "wall"
  | "door"
  | "obstacle"
  | "poi"
  | "label";

export interface MapObject {
  id: string;
  floorId: string;
  type: ObjType;
  name: string;
  category?: string;
  /** Custom fill color (hex, rgb, oklch, etc.) */
  color?: string;
  /** For restrooms: boys, girls, unisex, or accessible */
  gender?: "boys" | "girls" | "unisex" | "accessible";
  /** Stairs/elevators/escalators/ramps with the same connector link floors together. */
  connector?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Absolute polygon (outline/room) or polyline (wall) points, in meters. */
  points?: [number, number][];
}

export interface Floor {
  id: string;
  name: string;
  level: number;
}

export interface MapDoc {
  name: string;
  floors: Floor[];
  objects: MapObject[];
}

export const TYPE_LABEL: Record<ObjType, string> = {
  outline: "Building outline",
  room: "Room",
  lab: "Laboratory / Lab",
  corridor: "Corridor",
  lobby: "Lobby / open area",
  restroom: "Restroom",
  stairs: "Stairs",
  elevator: "Elevator",
  escalator: "Escalator",
  ramp: "Ramp",
  entrance: "Entrance / exit",
  wall: "Wall",
  door: "Door",
  obstacle: "Obstacle (blocked)",
  poi: "Point of interest",
  label: "Text label",
};

/** Types people can walk through. */
export const WALKABLE: ObjType[] = ["room", "lab", "corridor", "lobby", "restroom", "stairs", "elevator", "escalator", "ramp", "entrance"];
/** Types that connect floors via a shared connector ID. */
export const CONNECTORS: ObjType[] = ["stairs", "elevator", "escalator", "ramp"];
/** Connectors that are not step-free. */
export const HAS_STEPS: ObjType[] = ["stairs", "escalator"];
export const SEARCHABLE: ObjType[] = ["room", "lab", "lobby", "restroom", "entrance", "poi", "stairs", "elevator", "escalator", "ramp"];

export function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export function bboxOf(points: [number, number][]) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function center(o: MapObject): [number, number] {
  return [o.x + o.w / 2, o.y + o.h / 2];
}

export function emptyDoc(): MapDoc {
  return { name: "SVIT Campus", floors: [{ id: uid(), name: "Ground Floor", level: 0 }], objects: [] };
}
