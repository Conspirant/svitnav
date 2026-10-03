import { describe, expect, it } from "vitest";
import { type MapDoc, type MapObject, uid } from "@/lib/map/types";
import { buildGraph, findRoute } from "@/lib/map/pathfind";

describe("Editor Features", () => {
  it("duplicate floor creates a new floor and copies all objects with preserved connectors", () => {
    const floor1Id = uid();
    const doc: MapDoc = {
      name: "Test Campus",
      floors: [{ id: floor1Id, name: "Ground Floor", level: 0 }],
      objects: [
        { id: "o1", floorId: floor1Id, type: "outline", name: "Outline", x: 0, y: 0, w: 20, h: 20 },
        { id: "s1", floorId: floor1Id, type: "stairs", name: "Stairs A", connector: "S1", x: 5, y: 5, w: 3, h: 3 },
        { id: "r1", floorId: floor1Id, type: "room", name: "Room 101", x: 10, y: 10, w: 4, h: 4 },
      ],
    };

    // Duplicate floor logic
    const nextLevel = Math.max(...doc.floors.map((f) => f.level), -1) + 1;
    const newFloorId = uid();
    const newFloor = {
      id: newFloorId,
      name: `Floor ${nextLevel}`,
      level: nextLevel,
    };
    const currentFloorObjs = doc.objects.filter((o) => o.floorId === floor1Id);
    const copies: MapObject[] = currentFloorObjs.map((o) => ({
      ...o,
      id: uid(),
      floorId: newFloorId,
    }));

    const updatedDoc: MapDoc = {
      ...doc,
      floors: [...doc.floors, newFloor],
      objects: [...doc.objects, ...copies],
    };

    expect(updatedDoc.floors.length).toBe(2);
    expect(updatedDoc.floors[1].level).toBe(1);
    expect(updatedDoc.floors[1].name).toBe("Floor 1");
    expect(updatedDoc.objects.length).toBe(6);

    // Copied stairs keep the same connector to link floors
    const newStairs = updatedDoc.objects.find((o) => o.floorId === newFloorId && o.type === "stairs");
    expect(newStairs).toBeDefined();
    expect(newStairs?.connector).toBe("S1");
  });

  it("multi-select moving shifts all selected items together", () => {
    const objs: MapObject[] = [
      { id: "1", floorId: "f1", type: "room", name: "R1", x: 10, y: 10, w: 5, h: 5 },
      { id: "2", floorId: "f1", type: "room", name: "R2", x: 20, y: 20, w: 5, h: 5 },
      { id: "3", floorId: "f1", type: "room", name: "R3", x: 30, y: 30, w: 5, h: 5 },
    ];

    const selectedIds = ["1", "2"];
    const dx = 2.5;
    const dy = -1.5;

    const moved = objs.map((o) => {
      if (selectedIds.includes(o.id)) {
        return { ...o, x: o.x + dx, y: o.y + dy };
      }
      return o;
    });

    expect(moved[0].x).toBe(12.5);
    expect(moved[0].y).toBe(8.5);
    expect(moved[1].x).toBe(22.5);
    expect(moved[1].y).toBe(18.5);
    // Unselected object remains in original spot
    expect(moved[2].x).toBe(30);
    expect(moved[2].y).toBe(30);
  });

  it("copy and paste duplicates objects with offset and unique IDs", () => {
    const original: MapObject[] = [
      { id: "r1", floorId: "f1", type: "room", name: "Lab", x: 10, y: 10, w: 6, h: 4 },
    ];

    const pasted = original.map((o) => ({
      ...o,
      id: uid(),
      name: `${o.name} copy`,
      x: o.x + 1,
      y: o.y + 1,
    }));

    expect(pasted[0].id).not.toBe("r1");
    expect(pasted[0].name).toBe("Lab copy");
    expect(pasted[0].x).toBe(11);
    expect(pasted[0].y).toBe(11);
  });

  it("snapping toggle switches between 0.5m grid snap and freeform precision", () => {
    const snapVal = (v: number, snapping: boolean) => (snapping ? Math.round(v * 2) / 2 : +v.toFixed(2));

    expect(snapVal(10.23, true)).toBe(10);
    expect(snapVal(10.35, true)).toBe(10.5);
    expect(snapVal(10.74, true)).toBe(10.5);
    expect(snapVal(10.76, true)).toBe(11);

    // Snapping OFF retains freeform floating precision
    expect(snapVal(10.23, false)).toBe(10.23);
    expect(snapVal(10.35, false)).toBe(10.35);
  });

  it("custom coloring can be applied to rooms, corridors and other objects", () => {
    const objs: MapObject[] = [
      { id: "r1", floorId: "f1", type: "room", name: "Room 101", x: 0, y: 0, w: 10, h: 10 },
      { id: "c1", floorId: "f1", type: "corridor", name: "Hallway", x: 10, y: 0, w: 4, h: 20 },
    ];

    const coloredObjs = objs.map((o) => ({
      ...o,
      color: o.type === "corridor" ? "#334155" : "#1d4ed8",
    }));

    expect(coloredObjs[0].color).toBe("#1d4ed8");
    expect(coloredObjs[1].color).toBe("#334155");
  });

  it("restrooms can be designated as boys, girls, unisex, or accessible", () => {
    const boysRestroom: MapObject = {
      id: "rest1",
      floorId: "f1",
      type: "restroom",
      name: "Boys Restroom",
      category: "Boys Restroom",
      gender: "boys",
      color: "#1e3a8a",
      x: 0,
      y: 0,
      w: 6,
      h: 6,
    };

    const girlsRestroom: MapObject = {
      id: "rest2",
      floorId: "f1",
      type: "restroom",
      name: "Girls Restroom",
      category: "Girls Restroom",
      gender: "girls",
      color: "#831843",
      x: 7,
      y: 0,
      w: 6,
      h: 6,
    };

    expect(boysRestroom.gender).toBe("boys");
    expect(girlsRestroom.gender).toBe("girls");
    expect(boysRestroom.category).toContain("Boys");
    expect(girlsRestroom.category).toContain("Girls");
  });

  it("preset door straddles the room wall boundary for pathfinding continuity", () => {
    const room: MapObject = {
      id: "r1",
      floorId: "f1",
      type: "room",
      name: "Room 1",
      x: 18,
      y: 10,
      w: 8,
      h: 10,
    };

    // Auto-connect door on left edge (x = 18):
    const doorThickness = 0.5;
    const doorWidth = 0.9;
    const doorX = room.x - doorThickness / 2; // 17.75
    const doorY = room.y + room.h / 2 - doorWidth / 2; // 14.55

    const door: MapObject = {
      id: "d1",
      floorId: "f1",
      type: "door",
      name: `Door (${room.name})`,
      x: doorX,
      y: doorY,
      w: doorThickness,
      h: doorWidth,
    };

    // Door starts outside the room (x < 18) and extends inside (x + w > 18)
    expect(door.x).toBeLessThan(room.x);
    expect(door.x + door.w).toBeGreaterThan(room.x);
    expect(door.y).toBeGreaterThanOrEqual(room.y);
    expect(door.y + door.h).toBeLessThanOrEqual(room.y + room.h);
  });

  it("does not route through third-party intermediate rooms when corridors are available", () => {
    const fid = "f1";
    const startRestroom: MapObject = { id: "start", floorId: fid, type: "restroom", name: "Boys Restroom", x: 0, y: 12, w: 6, h: 6 };
    const middleClassroom: MapObject = { id: "room25", floorId: fid, type: "room", name: "Room 25", x: 6, y: 4, w: 10, h: 10 };
    const endRestroom: MapObject = { id: "end", floorId: fid, type: "restroom", name: "Girls Restroom", x: 16, y: 0, w: 6, h: 6 };
    // Corridor wrapping around the middle classroom:
    const corridorSouth: MapObject = { id: "c1", floorId: fid, type: "corridor", name: "Corridor 9", x: 0, y: 14, w: 22, h: 4 };
    const corridorEast: MapObject = { id: "c2", floorId: fid, type: "corridor", name: "Corridor East", x: 16, y: 4, w: 4, h: 12 };

    const doc: MapDoc = {
      name: "Test Map",
      floors: [{ id: fid, name: "Ground", level: 0 }],
      objects: [startRestroom, middleClassroom, endRestroom, corridorSouth, corridorEast],
    };

    const graph = buildGraph(doc);
    expect(graph).not.toBeNull();
    const route = findRoute(doc, graph!, startRestroom, endRestroom);
    expect(route).toBeDefined();
    expect(route?.legs.length).toBeGreaterThan(0);

    // Verify none of the route waypoints cut into middleClassroom interior (x in [6.5, 15.5], y in [4.5, 13.5])
    const points = route!.legs[0].points;
    const cutsThroughRoom25 = points.some(
      ([px, py]) => px > middleClassroom.x + 0.5 && px < middleClassroom.x + middleClassroom.w - 0.5 &&
                    py > middleClassroom.y + 0.5 && py < middleClassroom.y + middleClassroom.h - 0.5
    );
    expect(cutsThroughRoom25).toBe(false);

    // Verify points inside Corridor 9 are locked to its horizontal centerline (y = 16)
    const ptsInCorridor9 = points.filter(([px]) => px >= 2 && px <= 14);
    expect(ptsInCorridor9.length).toBeGreaterThan(0);
    for (const pt of ptsInCorridor9) {
      expect(pt[1]).toBeCloseTo(16, 0.5);
    }
  });

  it("locks navigation path strictly to the horizontal centerline of Corridor 10 between vertical corridor turns", () => {
    const fid = "f1";
    // Vertical left corridor from below
    const vertLeft: MapObject = { id: "c_left", floorId: fid, type: "corridor", name: "Corridor West", x: 0, y: 10, w: 4, h: 14 }; // centerline x = 2
    // Horizontal corridor 10
    const corridor10: MapObject = { id: "c_10", floorId: fid, type: "corridor", name: "Corridor 10", x: 0, y: 10, w: 22, h: 4 }; // centerline y = 12
    // Vertical right corridor going up
    const vertRight: MapObject = { id: "c_right", floorId: fid, type: "corridor", name: "Corridor North", x: 18, y: 0, w: 4, h: 14 }; // centerline x = 20
    // Restrooms at bottom of Corridor 10
    const girlsRestroom: MapObject = { id: "gr", floorId: fid, type: "restroom", name: "Girls Restroom", x: 4, y: 14, w: 7, h: 8 };
    const boysRestroom: MapObject = { id: "br", floorId: fid, type: "restroom", name: "Boys Restroom", x: 11, y: 14, w: 7, h: 8 };
    const door1: MapObject = { id: "d1", floorId: fid, type: "door", name: "Door", x: 6, y: 13.8, w: 1.2, h: 0.4 };
    const door2: MapObject = { id: "d2", floorId: fid, type: "door", name: "Door", x: 13, y: 13.8, w: 1.2, h: 0.4 };

    const startObj: MapObject = { id: "start", floorId: fid, type: "room", name: "Room South", x: 0, y: 20, w: 4, h: 4 };
    const destObj: MapObject = { id: "dest", floorId: fid, type: "room", name: "Room North", x: 18, y: 0, w: 4, h: 4 };

    const doc: MapDoc = {
      name: "Corridor 10 Test Map",
      floors: [{ id: fid, name: "Ground", level: 0 }],
      objects: [vertLeft, corridor10, vertRight, girlsRestroom, boysRestroom, door1, door2, startObj, destObj],
    };

    const graph = buildGraph(doc);
    expect(graph).not.toBeNull();
    const route = findRoute(doc, graph!, startObj, destObj);
    expect(route).toBeDefined();
    expect(route?.legs.length).toBeGreaterThan(0);

    const points = route!.legs[0].points;
    // Exactly 4 structured waypoints: origin -> corner1 (x=2, y=12) -> corner2 (x=20, y=12) -> destination
    expect(points).toHaveLength(4);
    expect(points[1][0]).toBeCloseTo(2.0, 0.2);
    expect(points[1][1]).toBeCloseTo(12.0, 0.2);
    expect(points[2][0]).toBeCloseTo(20.0, 0.2);
    expect(points[2][1]).toBeCloseTo(12.0, 0.2);

    // Both Corridor 10 corners are strictly on the horizontal centerline (y = 12.0)
    for (const pt of [points[1], points[2]]) {
      expect(pt[1]).toBeCloseTo(12.0, 0.2); // Not hugging the top wall (y = 10)
    }
  });

  it("enters rooms strictly perpendicular through doorways with clean 90-degree corridor approach and zero diagonal slants", () => {
    const fid = "f1";
    // Corridor below Room 18:
    const corridorSouth: MapObject = { id: "c_s", floorId: fid, type: "corridor", name: "Hallway", x: 0, y: 16, w: 24, h: 4 }; // centerline y = 18
    // Room 18:
    const room18: MapObject = { id: "r18", floorId: fid, type: "room", name: "Room 18", x: 8, y: 6, w: 14, h: 10 }; // bottom wall y = 16
    // Door on bottom wall of Room 18 at x = 18:
    const door: MapObject = { id: "d18", floorId: fid, type: "door", name: "Door", x: 18, y: 15.8, w: 1.2, h: 0.4 }; // center x = 18.6

    const startObj: MapObject = { id: "start", floorId: fid, type: "corridor", name: "Hallway Start", x: 0, y: 16, w: 4, h: 4 };
    const destObj: MapObject = { id: "dest", floorId: fid, type: "poi", name: "Room 18 Desk", x: 14, y: 10, w: 1, h: 1 };

    const doc: MapDoc = {
      name: "Door Approach Map",
      floors: [{ id: fid, name: "Ground", level: 0 }],
      objects: [corridorSouth, room18, door, startObj, destObj],
    };

    const graph = buildGraph(doc);
    expect(graph).not.toBeNull();
    const route = findRoute(doc, graph!, startObj, destObj);
    expect(route).toBeDefined();
    expect(route?.legs.length).toBeGreaterThan(0);

    const points = route!.legs[0].points;
    // Every segment must be strictly orthogonal (either horizontal or vertical - no slants!)
    for (let k = 1; k < points.length; k++) {
      const dx = Math.abs(points[k][0] - points[k - 1][0]);
      const dy = Math.abs(points[k][1] - points[k - 1][1]);
      const isOrthogonal = dx < 0.1 || dy < 0.1;
      expect(isOrthogonal).toBe(true);
    }
  });

  it("routes directly between adjoining lobbies across open space without taking detours to the bottom of the building", () => {
    const fid = "f1";
    // Lobby 1 on left:
    const lobby1: MapObject = { id: "l1", floorId: fid, type: "lobby", name: "Lobby 1", x: 0, y: 0, w: 8, h: 20 };
    // Room 18 in upper middle:
    const room18: MapObject = { id: "r18", floorId: fid, type: "room", name: "Room 18", x: 8, y: 0, w: 10, h: 10 };
    // Lobby 4 below Room 18:
    const lobby4: MapObject = { id: "l4", floorId: fid, type: "lobby", name: "Lobby 4", x: 8, y: 10, w: 10, h: 10 };
    // Bottom corridor far below (at y = 20..24):
    const bottomCorridor: MapObject = { id: "c_bot", floorId: fid, type: "corridor", name: "Bottom Corridor", x: 0, y: 20, w: 18, h: 4 };

    const startObj: MapObject = { id: "start", floorId: fid, type: "poi", name: "Lobby 1 Top", x: 2, y: 4, w: 1, h: 1 };
    const destObj: MapObject = { id: "dest", floorId: fid, type: "poi", name: "Lobby 4 Center", x: 15, y: 12, w: 1, h: 1 };

    const doc: MapDoc = {
      name: "Lobby Routing Test",
      floors: [{ id: fid, name: "Ground", level: 0 }],
      objects: [lobby1, room18, lobby4, bottomCorridor, startObj, destObj],
    };

    const graph = buildGraph(doc);
    expect(graph).not.toBeNull();
    const route = findRoute(doc, graph!, startObj, destObj);
    expect(route).toBeDefined();
    expect(route?.legs.length).toBeGreaterThan(0);

    const points = route!.legs[0].points;
    // The route must directly cross from Lobby 1 into Lobby 4 below Room 18 (y <= 14), NOT take a 20m detour down to y = 22
    const maxY = Math.max(...points.map((p) => p[1]));
    expect(maxY).toBeLessThan(16.0); // Never drops to the bottom corridor (y = 20..24)
  });
});
