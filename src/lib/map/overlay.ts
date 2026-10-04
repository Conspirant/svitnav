import type { FloorOverlay, MapObject } from "./types";

/**
 * Reads and optimizes an uploaded blueprint / floor plan image for overlay.
 * Downscales excessively large images (e.g. >2400px) via offscreen canvas
 * to conserve memory, ensure snappy rendering, and stay within storage quotas.
 */
export async function processOverlayImage(
  file: File
): Promise<{ url: string; naturalWidth: number; naturalHeight: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const img = new Image();
      img.onload = () => {
        const nw = img.naturalWidth || 800;
        const nh = img.naturalHeight || 600;
        const maxDim = 2400;

        // If within size limits, return as is
        if (nw <= maxDim && nh <= maxDim && dataUrl.length < 3 * 1024 * 1024) {
          resolve({ url: dataUrl, naturalWidth: nw, naturalHeight: nh });
          return;
        }

        // Downscale
        const scale = maxDim / Math.max(nw, nh);
        const cw = Math.round(nw * scale);
        const ch = Math.round(nh * scale);
        const canvas = document.createElement("canvas");
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0, cw, ch);
          const isPng = file.type === "image/png" || file.name.toLowerCase().endsWith(".png");
          const mime = isPng ? "image/png" : "image/jpeg";
          const compressed = canvas.toDataURL(mime, 0.88);
          resolve({ url: compressed, naturalWidth: nw, naturalHeight: nh });
          return;
        }

        resolve({ url: dataUrl, naturalWidth: nw, naturalHeight: nh });
      };
      img.onerror = () => reject(new Error("Failed to load image format"));
      img.src = dataUrl;
    };
    reader.onerror = () => reject(new Error("Failed to read image file"));
    reader.readAsDataURL(file);
  });
}

/**
 * Calculates initial bounding box (in meters) for an overlay image.
 * If building outlines or shapes already exist on the floor, fits around them nicely.
 * Otherwise centers on origin or view center.
 */
export function calculateInitialOverlayBounds(
  naturalWidth: number,
  naturalHeight: number,
  floorObjs: MapObject[],
  centerFallback: [number, number] = [0, 0]
): { x: number; y: number; w: number; h: number } {
  const aspect = naturalHeight > 0 ? naturalWidth / naturalHeight : 1.33;

  // Check if there are outlines or any objects on the floor
  const outlines = floorObjs.filter((o) => o.type === "outline");
  const targetObjs = outlines.length > 0 ? outlines : floorObjs;

  if (targetObjs.length > 0) {
    const minX = Math.min(...targetObjs.map((o) => o.x));
    const minY = Math.min(...targetObjs.map((o) => o.y));
    const maxX = Math.max(...targetObjs.map((o) => o.x + o.w));
    const maxY = Math.max(...targetObjs.map((o) => o.y + o.h));
    const bw = maxX - minX;
    const bh = maxY - minY;

    if (bw > 1 && bh > 1) {
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;

      // Fit with 10% padding preserving aspect ratio
      let w = bw * 1.1;
      let h = w / aspect;
      if (h < bh * 1.1) {
        h = bh * 1.1;
        w = h * aspect;
      }

      return {
        x: +(cx - w / 2).toFixed(2),
        y: +(cy - h / 2).toFixed(2),
        w: +w.toFixed(2),
        h: +h.toFixed(2),
      };
    }
  }

  // Default placement when blank floor
  const w = 40;
  const h = +(w / aspect).toFixed(2);
  return {
    x: +(centerFallback[0] - w / 2).toFixed(2),
    y: +(centerFallback[1] - h / 2).toFixed(2),
    w,
    h,
  };
}

/**
 * Fits the overlay image to the bounding box of the building outline or shapes.
 */
export function fitOverlayToBounds(
  bounds: { x: number; y: number; w: number; h: number },
  overlay: FloorOverlay,
  keepAspect = true
): FloorOverlay {
  if (!keepAspect) {
    return {
      ...overlay,
      x: bounds.x,
      y: bounds.y,
      w: bounds.w,
      h: bounds.h,
    };
  }

  const currentAspect = overlay.h > 0 ? overlay.w / overlay.h : bounds.w / bounds.h;
  let w = bounds.w;
  let h = w / currentAspect;
  if (h > bounds.h) {
    h = bounds.h;
    w = h * currentAspect;
  }

  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;

  return {
    ...overlay,
    x: +(cx - w / 2).toFixed(2),
    y: +(cy - h / 2).toFixed(2),
    w: +w.toFixed(2),
    h: +h.toFixed(2),
  };
}

/**
 * Calibrates overlay scale based on two measured points and a real-world distance in meters.
 */
export function calibrateOverlayScale(
  p1: [number, number],
  p2: [number, number],
  targetMeters: number,
  overlay: FloorOverlay
): FloorOverlay {
  const currentDist = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
  if (currentDist <= 0.001 || targetMeters <= 0) return overlay;

  const factor = targetMeters / currentDist;
  const cx = overlay.x + overlay.w / 2;
  const cy = overlay.y + overlay.h / 2;
  const nw = +(overlay.w * factor).toFixed(2);
  const nh = +(overlay.h * factor).toFixed(2);

  return {
    ...overlay,
    w: nw,
    h: nh,
    x: +(cx - nw / 2).toFixed(2),
    y: +(cy - nh / 2).toFixed(2),
  };
}
