import type { MapObject, ObjType } from "@/lib/map/types";

export const FILL: Record<ObjType, string> = {
  outline: "var(--map-outline)",
  room: "var(--map-room)",
  lab: "var(--map-lab)",
  corridor: "var(--map-corridor)",
  lobby: "var(--map-lobby)",
  restroom: "var(--map-restroom)",
  stairs: "var(--map-stairs)",
  elevator: "var(--map-elevator)",
  escalator: "var(--map-escalator)",
  ramp: "var(--map-ramp)",
  entrance: "var(--map-entrance)",
  wall: "none",
  door: "var(--map-door)",
  obstacle: "var(--map-obstacle)",
  poi: "var(--map-poi)",
  label: "none",
};

const ORDER: Record<ObjType, number> = { outline: 0, lobby: 1, corridor: 1, room: 2, lab: 2, restroom: 2, stairs: 3, elevator: 3, escalator: 3, ramp: 3, entrance: 3, obstacle: 4, door: 5, wall: 6, poi: 7, label: 8 };
export const sortForRender = (objs: MapObject[]) => [...objs].sort((a, b) => ORDER[a.type] - ORDER[b.type]);

export function GridPattern() {
  return (
    <defs>
      <pattern id="grid-minor" width="1" height="1" patternUnits="userSpaceOnUse">
        <path d="M 1 0 L 0 0 0 1" fill="none" stroke="var(--map-grid)" strokeWidth="0.03" />
      </pattern>
      <pattern id="grid-major" width="5" height="5" patternUnits="userSpaceOnUse">
        <rect width="5" height="5" fill="url(#grid-minor)" />
        <path d="M 5 0 L 0 0 0 5" fill="none" stroke="var(--map-grid-major)" strokeWidth="0.06" />
      </pattern>
      <pattern id="stairs-hatch" width="0.8" height="0.8" patternUnits="userSpaceOnUse">
        <rect width="0.8" height="0.8" fill="var(--map-stairs)" />
        <path d="M0 0.4 H0.8" stroke="var(--map-stairs-line)" strokeWidth="0.12" />
      </pattern>
      <pattern id="obstacle-hatch" width="1" height="1" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="1" height="1" fill="var(--map-obstacle)" />
        <path d="M0 0 V1" stroke="var(--map-wall)" strokeWidth="0.15" opacity="0.5" />
      </pattern>
    </defs>
  );
}

export function ObjectShape({ o, k, selected, highlight, dim, locked }: { o: MapObject; k: number; selected?: boolean; highlight?: boolean; dim?: boolean; locked?: boolean }) {
  const stroke = selected ? "var(--map-selected)" : highlight ? "var(--map-route)" : "var(--map-stroke)";
  const sw = selected || highlight ? 2.5 : 1;
  const opacity = dim ? 0.35 : 1;

  // Determine restroom gender designation for automatic subtle tinting and badges
  const isBoys = o.type === "restroom" && (o.gender === "boys" || /boy|men|gents/i.test(o.name) || /boy|men|gents/i.test(o.category ?? ""));
  const isGirls = o.type === "restroom" && (o.gender === "girls" || /girl|women|ladies/i.test(o.name) || /girl|women|ladies/i.test(o.category ?? ""));
  const isAccessible = o.type === "restroom" && (o.gender === "accessible" || /accessible|handicap|disabled/i.test(o.name) || /accessible|handicap|disabled/i.test(o.category ?? ""));
  const isUnisex = o.type === "restroom" && (o.gender === "unisex" || /unisex|all.?gender/i.test(o.name) || /unisex|all.?gender/i.test(o.category ?? ""));

  let defaultFill = o.type === "stairs" || o.type === "escalator"
    ? "url(#stairs-hatch)"
    : o.type === "obstacle"
    ? "url(#obstacle-hatch)"
    : FILL[o.type];

  if (!o.color && o.type === "restroom") {
    if (isBoys) defaultFill = "oklch(0.34 0.08 245)";
    else if (isGirls) defaultFill = "oklch(0.36 0.09 320)";
    else if (isAccessible) defaultFill = "oklch(0.36 0.08 175)";
  }

  const fill = o.color || defaultFill;
  let shape;

  if (o.type === "label") {
    return (
      <g data-id={locked ? undefined : o.id} opacity={opacity} style={{ cursor: locked ? "default" : "pointer", pointerEvents: locked ? "none" : undefined }}>
        <rect x={o.x} y={o.y} width={o.w} height={o.h} fill="transparent" stroke={selected ? "var(--map-selected)" : "none"} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        <text x={o.x + o.w / 2} y={o.y + o.h / 2} fontSize={Math.max(0.8, o.h * 0.6)} textAnchor="middle" dominantBaseline="middle" fill="var(--map-label)" opacity={0.75} style={{ pointerEvents: "none", fontWeight: 600, letterSpacing: "0.05em" }}>{o.name || "Label"}</text>
      </g>
    );
  }

  if (o.type === "wall" && o.points) {
    shape = <polyline points={o.points.map((p) => p.join(",")).join(" ")} fill="none" stroke={selected ? "var(--map-selected)" : (o.color || "var(--map-wall)")} strokeWidth={0.3} strokeLinecap="square" />;
  } else if (o.type === "door") {
    // High-visibility architectural preset door
    const isHoriz = o.w >= o.h;
    const doorStroke = selected ? "var(--map-selected)" : "oklch(0.88 0.18 140)";
    shape = (
      <g>
        <rect
          x={o.x}
          y={o.y}
          width={o.w}
          height={o.h}
          fill={fill}
          stroke={doorStroke}
          strokeWidth={selected ? 2.5 : 1.2}
          vectorEffect="non-scaling-stroke"
          rx={0.08}
        />
        {/* Doorway threshold line & frame jamb accents */}
        {isHoriz ? (
          <>
            <line x1={o.x} y1={o.y + o.h / 2} x2={o.x + o.w} y2={o.y + o.h / 2} stroke="rgba(255,255,255,0.75)" strokeWidth={0.08} strokeDasharray="0.25 0.15" />
            <rect x={o.x} y={o.y} width={0.12} height={o.h} fill={doorStroke} />
            <rect x={o.x + o.w - 0.12} y={o.y} width={0.12} height={o.h} fill={doorStroke} />
          </>
        ) : (
          <>
            <line x1={o.x + o.w / 2} y1={o.y} x2={o.x + o.w / 2} y2={o.y + o.h} stroke="rgba(255,255,255,0.75)" strokeWidth={0.08} strokeDasharray="0.25 0.15" />
            <rect x={o.x} y={o.y} width={o.w} height={0.12} fill={doorStroke} />
            <rect x={o.x} y={o.y + o.h - 0.12} width={o.w} height={0.12} fill={doorStroke} />
          </>
        )}
      </g>
    );
  } else if (o.type === "poi") {
    shape = <circle cx={o.x + o.w / 2} cy={o.y + o.h / 2} r={Math.max(0.6, 7 / k)} fill={o.color || FILL.poi} stroke={stroke} strokeWidth={sw} vectorEffect="non-scaling-stroke" />;
  } else if (o.points && o.points.length >= 3) {
    const pts = o.points.map((p) => p.join(",")).join(" ");
    shape = <>
      <polygon points={pts} fill={fill} stroke={o.type === "outline" && !selected ? "var(--map-outline-stroke)" : stroke} strokeWidth={o.type === "outline" ? 2 : sw} vectorEffect="non-scaling-stroke" pointerEvents={o.type === "outline" ? "none" : undefined} />
      {o.type === "outline" && !locked && <polygon points={pts} fill="none" stroke="transparent" strokeWidth={14} vectorEffect="non-scaling-stroke" pointerEvents="stroke" style={{ cursor: "pointer" }} />}
    </>;
  } else {
    shape = <rect x={o.x} y={o.y} width={o.w} height={o.h} fill={fill} stroke={stroke} strokeWidth={sw} vectorEffect="non-scaling-stroke" rx={o.type === "elevator" ? 0.3 : 0} />;
  }

  const showLabel = o.name && o.type !== "wall" && o.type !== "outline" && o.type !== "door" && (o.type === "poi" ? k > 4 : o.w * k > Math.min(o.name.length * 6.5, 120) && o.h * k > 14);
  const fs = 11 / k;

  // Restroom icon badge
  const showRestroomBadge = o.type === "restroom" && o.w * k > 18 && o.h * k > 18;
  const badgeGlyph = isBoys ? "🚹" : isGirls ? "🚺" : isAccessible ? "♿" : isUnisex ? "🚻" : "🚻";
  const badgeLabel = isBoys ? "BOYS" : isGirls ? "GIRLS" : isAccessible ? "ACCESSIBLE" : null;

  return (
    <g data-id={locked ? undefined : o.id} opacity={opacity} style={{ cursor: locked ? "default" : "pointer", pointerEvents: locked ? "none" : undefined }}>
      {shape}
      {showRestroomBadge && (
        <g pointerEvents="none">
          <text
            x={o.x + o.w / 2}
            y={showLabel ? o.y + o.h / 2 - Math.max(0.6, 9 / k) : o.y + o.h / 2}
            fontSize={Math.max(1, 14 / k)}
            textAnchor="middle"
            dominantBaseline="middle"
            style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.8))" }}
          >
            {badgeGlyph}
          </text>
          {badgeLabel && o.w * k > 38 && (
            <text
              x={o.x + o.w / 2}
              y={o.y + o.h / 2 + Math.max(0.7, 10 / k)}
              fontSize={Math.max(0.6, 8 / k)}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="rgba(255, 255, 255, 0.9)"
              fontWeight={700}
              letterSpacing="0.08em"
            >
              {badgeLabel}
            </text>
          )}
        </g>
      )}
      {showLabel && (
        <text
          x={o.x + o.w / 2}
          y={o.type === "poi" ? o.y - 0.6 : (showRestroomBadge && badgeLabel ? o.y + o.h / 2 + Math.max(1.3, 18 / k) : o.y + o.h / 2)}
          fontSize={fs}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="var(--map-label)"
          style={{ pointerEvents: "none", fontWeight: 500 }}
        >
          {o.type === "lab" && !o.name.includes("🧪") ? `🧪 ${o.name}` : o.name}
        </text>
      )}
    </g>
  );
}
