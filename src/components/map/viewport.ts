import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { MapObject } from "@/lib/map/types";

export interface View { x: number; y: number; k: number }

export function useViewport(ref: RefObject<SVGSVGElement | null>) {
  const [view, setView] = useState<View>({ x: 40, y: 40, k: 8 });
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Prevent browser zoom when Ctrl+wheel is triggered anywhere over the page
    const onGlobalWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
      }
    };

    const preventKeyZoom = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "+" || e.key === "-" || e.key === "=" || e.key === "0" || e.code === "NumpadAdd" || e.code === "NumpadSubtract" || e.code === "Digit0")) {
        e.preventDefault();
      }
    };

    // Wheel zooming directly on the SVG/workspace
    const onSvgWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;

      if (e.shiftKey && !e.ctrlKey && !e.metaKey) {
        const d = e.deltaY || e.deltaX;
        setView((v) => ({ ...v, x: v.x - d }));
        return;
      }

      // Delta calculation supporting trackpads and mouse wheels
      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 24;
      else if (e.deltaMode === 2) dy *= 100;

      // Handle pinch/ctrl-zoom vs standard wheel
      const isCtrl = e.ctrlKey || e.metaKey;
      const factor = isCtrl
        ? Math.pow(0.992, dy)
        : Math.exp(-dy * 0.0018);

      setView((v) => {
        const k = Math.min(200, Math.max(0.5, v.k * factor));
        const f = k / v.k;
        return { k, x: px - (px - v.x) * f, y: py - (py - v.y) * f };
      });
    };

    window.addEventListener("wheel", onGlobalWheel, { passive: false, capture: true });
    document.addEventListener("wheel", onGlobalWheel, { passive: false, capture: true });
    window.addEventListener("keydown", preventKeyZoom, { capture: true });
    document.addEventListener("keydown", preventKeyZoom, { capture: true });
    el.addEventListener("wheel", onSvgWheel, { passive: false });

    // Also attach to parent <main> container in case pointer is over empty padding
    const parent = el.parentElement;
    if (parent) {
      parent.addEventListener("wheel", onSvgWheel, { passive: false });
    }

    return () => {
      window.removeEventListener("wheel", onGlobalWheel, { capture: true });
      document.removeEventListener("wheel", onGlobalWheel, { capture: true });
      window.removeEventListener("keydown", preventKeyZoom, { capture: true });
      document.removeEventListener("keydown", preventKeyZoom, { capture: true });
      el.removeEventListener("wheel", onSvgWheel);
      if (parent) {
        parent.removeEventListener("wheel", onSvgWheel);
      }
    };
  }, [ref]);

  const toWorld = useCallback((clientX: number, clientY: number): [number, number] => {
    const rect = ref.current!.getBoundingClientRect();
    const v = viewRef.current;
    return [(clientX - rect.left - v.x) / v.k, (clientY - rect.top - v.y) / v.k];
  }, [ref]);

  const fit = useCallback((objs: MapObject[]) => {
    const el = ref.current; if (!el || !objs.length) return;
    const rect = el.getBoundingClientRect();
    const minX = Math.min(...objs.map((o) => o.x)), minY = Math.min(...objs.map((o) => o.y));
    const maxX = Math.max(...objs.map((o) => o.x + o.w)), maxY = Math.max(...objs.map((o) => o.y + o.h));
    const k = Math.min((rect.width - 80) / (maxX - minX || 1), (rect.height - 80) / (maxY - minY || 1));
    setView({ k, x: (rect.width - (maxX - minX) * k) / 2 - minX * k, y: (rect.height - (maxY - minY) * k) / 2 - minY * k });
  }, [ref]);

  const zoomBy = useCallback((f: number) => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect(); const px = r.width / 2, py = r.height / 2;
    setView((v) => { const k = Math.min(200, Math.max(0.5, v.k * f)); const g = k / v.k; return { k, x: px - (px - v.x) * g, y: py - (py - v.y) * g }; });
  }, [ref]);

  return { view, setView, toWorld, fit, zoomBy };
}
