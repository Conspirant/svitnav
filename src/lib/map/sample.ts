import { bboxOf, uid, type MapDoc, type MapObject } from "./types";

// Starter content only: a rough trace of the SVIT main block outline plus example
// rooms so navigation can be tried. Admins replace it in the editor.
const OUTLINE: [number, number][] = [
  [12, 0], [32, 4], [24, 56], [32, 66], [95, 78], [90, 110], [0, 92],
];

export function sampleDoc(): MapDoc {
  const g = { id: uid(), name: "Ground Floor", level: 0 };
  const f1 = { id: uid(), name: "First Floor", level: 1 };
  const objects: MapObject[] = [];
  const rect = (floorId: string, type: MapObject["type"], name: string, x: number, y: number, w: number, h: number, extra: Partial<MapObject> = {}) =>
    objects.push({ id: uid(), floorId, type, name, x, y, w, h, ...extra });

  const names = {
    [g.id]: ["Room 101", "Room 102", "Library", "Admin Office", "Physics Lab", "Chemistry Lab", "Seminar Hall", "Canteen", "Restrooms"],
    [f1.id]: ["Room 201", "Room 202", "CSE Department", "Staff Room", "Computer Lab 1", "Computer Lab 2", "Auditorium", "ECE Department", "Restrooms (F1)"],
  };
  for (const fl of [g, f1]) {
    objects.push({ id: uid(), floorId: fl.id, type: "outline", name: "Main Block", points: OUTLINE, ...bboxOf(OUTLINE) });
    rect(fl.id, "corridor", "Main Corridor", 14, 8, 4, 80);
    rect(fl.id, "corridor", "East Corridor", 14, 84, 71, 4);
    const n = names[fl.id];
    rect(fl.id, "room", n[0], 18, 10, 8, 10, { category: "Classroom" });
    rect(fl.id, "room", n[1], 18, 22, 7, 10, { category: "Classroom" });
    rect(fl.id, "room", n[2], 18, 34, 6, 10, { category: fl.level ? "Department" : "Library" });
    rect(fl.id, "room", n[3], 8.5, 30, 5.5, 10, { category: "Office" });
    rect(fl.id, "room", n[4], 36, 74, 14, 10, { category: "Lab" });
    rect(fl.id, "room", n[5], 52, 76, 14, 8, { category: "Lab" });
    rect(fl.id, "room", n[6], 30, 88, 20, 9, { category: "Hall" });
    rect(fl.id, "room", n[7], 52, 88, 18, 12, { category: fl.level ? "Department" : "Food" });
    rect(fl.id, "room", n[8], 72, 88, 14, 12, { category: "Restroom" });
    rect(fl.id, "stairs", "Stairs A", 18, 46, 5, 6, { connector: "S1" });
    rect(fl.id, "elevator", "Lift 1", 18, 53, 4, 4, { connector: "E1" });
  }
  rect(g.id, "poi", "Main Entrance", 15.5, 89, 1, 1, { category: "Entrance" });
  return { name: "SVIT Campus", floors: [g, f1], objects };
}
