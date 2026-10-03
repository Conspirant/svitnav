import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { MapObject } from "@/lib/map/types";

export interface View { x: number; y: number; k: number }

export function useViewport(ref: RefObject<SVGSVGElement | null>) {
  const [view, setView] = useState<View>({ x: 40, y: 40, k: 8 });
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    const el = ref.current; if (!el) return;

    // Prevent Chrome / browser from zooming the entire webpage on Ctrl+scroll or pinch
    const preventBrowserZoom = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
      }
    };
    window.addEventListener("wheel", preventBrowserZoom, { passive: false, capture: true });

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      if (e.shiftKey && !e.ctrlKey) { const d = e.deltaY || e.deltaX; setView((v) => ({ ...v, x: v.x - d })); return; }
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
      setView((v) => {
        const k = Math.min(200, Math.max(0.5, v.k * Math.exp(-dy * 0.0018)));
        const f = k / v.k;
        return { k, x: px - (px - v.x) * f, y: py - (py - v.y) * f };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("wheel", preventBrowserZoom, { capture: true });
      el.removeEventListener("wheel", onWheel);
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
