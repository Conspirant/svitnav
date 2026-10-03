
## Architecture rules
- Map data is one JSON document (`MapDoc` in src/lib/map/types.ts) stored in `map_documents` rows (kind draft|published); students read the latest published row — keeps editor and navigation decoupled.
- Navigation is a client-side grid A* (src/lib/map/pathfind.ts) built from walkable areas; stairs/elevators sharing a `connector` link floors — no separate graph to maintain.
- Map rendering is SVG in meter units with a shared viewport hook (src/components/map) — used by both editor and student view.
- tsconfig has noUncheckedIndexedAccess and exactOptionalPropertyTypes off — the geometry/pathfinding code is dense typed-array indexing.
