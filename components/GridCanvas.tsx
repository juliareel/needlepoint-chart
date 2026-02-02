"use client";

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Color } from "../lib/grid";
import { idx } from "../lib/grid";
import { assetPath } from "../lib/assetPath";
import { symbolForColorId } from "../lib/symbols";

type Props = {
  width: number;
  height: number;
  grid: Uint16Array;
  paletteById: Map<number, Color>;
  symbolMap?: Map<number, string>;
  activeColorId: number;
  cellSize: number;
  containerWidth: number;
  containerHeight: number;
  zoom: number;
  minZoom: number;
  maxZoom: number;
  pinchEnabled: boolean;
  onZoomChange: (nextZoom: number) => void;
  centerCanvasToken?: number;
  focusCell?: { x: number; y: number } | null;
  focusCellToken?: number;
  threadView: boolean;
  darkCanvas: boolean;
  showSymbols: boolean;
  identifyColorId?: number | null;
  traceImage: HTMLImageElement | null;
  traceOpacity: number;
  traceScale: number;
  traceOffsetX: number;
  traceOffsetY: number;
  traceAdjustMode: boolean;
  onTraceOffsetChange: (x: number, y: number) => void;
  onTraceScaleChange: (scale: number) => void;
  panMode: boolean;
  showGridlines: boolean;
  tool: "paint" | "eraser" | "fill" | "eyedropper" | "lasso";
  brushSize: number;
  lassoPoints: { x: number; y: number }[];
  lassoClosed: boolean;
  onPickColor: (colorId: number) => void;
  onPickColorComplete?: () => void;
  onLassoReset: (point: { x: number; y: number }) => void;
  onLassoPoint: (point: { x: number; y: number }) => void;
  onLassoClose: () => void;
  onLassoFill: (points: { x: number; y: number }[]) => void;
  onStrokeStart: () => void;
  onStrokeEnd: () => void;
  onPaintCell: (x: number, y: number, colorId: number) => void;
  onFillCells?: (indices: number[], colorId: number) => void;
  onFillGrid?: (nextGrid: Uint16Array) => void;
  filterRect?: { x0: number; y0: number; x1: number; y1: number } | null;
  filterSelecting?: boolean;
  onFilterRectChange?: (rect: { x0: number; y0: number; x1: number; y1: number } | null) => void;
  onFilterSelectEnd?: () => void;
};

export default function GridCanvas(props: Props) {
  const {
    width,
    height,
    grid,
    paletteById,
    symbolMap,
    activeColorId,
    cellSize,
    containerWidth,
    containerHeight,
    zoom,
    minZoom,
    maxZoom,
    pinchEnabled,
    onZoomChange,
    centerCanvasToken,
    focusCell,
    focusCellToken,
    threadView,
    darkCanvas,
    showSymbols,
    identifyColorId,
    traceImage,
    traceOpacity,
    traceScale,
    traceOffsetX,
    traceOffsetY,
    traceAdjustMode,
    onTraceOffsetChange,
    onTraceScaleChange,
    panMode,
    showGridlines,
    tool,
    brushSize,
    lassoPoints,
    lassoClosed,
    onPickColor,
    onPickColorComplete,
    onLassoReset,
    onLassoPoint,
    onLassoClose,
    onLassoFill,
    onStrokeStart,
    onStrokeEnd,
    onPaintCell,
    onFillCells,
    onFillGrid,
    filterRect,
    filterSelecting = false,
    onFilterRectChange,
    onFilterSelectEnd,
  } = props;

  const canvasW = width * cellSize;
  const canvasH = height * cellSize;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gridRef = useRef(grid);
  gridRef.current = grid;
  const traceSamplerRef = useRef<HTMLCanvasElement | null>(null);
  const [isPainting, setIsPainting] = useState(false);
  const [isLassoing, setIsLassoing] = useState(false);
  const [hoverCell, setHoverCell] = useState<{ x: number; y: number } | null>(null);
  const [filterPreviewRect, setFilterPreviewRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(
    null
  );
  const filterDragStartRef = useRef<{ x: number; y: number } | null>(null);
  const focusCellRef = useRef<{ x: number; y: number } | null>(null);
  const lastFocusTokenRef = useRef<number | undefined>(undefined);
  const prevZoomRef = useRef(zoom);
  const prevCellSizeRef = useRef(cellSize);
  const prevBaseOffsetRef = useRef({ x: 0, y: 0 });
  const prevPanRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!filterSelecting && filterPreviewRect) {
      setFilterPreviewRect(null);
      filterDragStartRef.current = null;
    }
  }, [filterSelecting, filterPreviewRect]);
  useEffect(() => {
    focusCellRef.current = focusCell ?? null;
  }, [focusCell]);
  const lastLassoPointRef = useRef<{ x: number; y: number } | null>(null);
  const lastPaintCellRef = useRef<{ x: number; y: number } | null>(null);
  const isTracingDragRef = useRef(false);
  const traceDragStartRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const traceResizeRef = useRef<
    | {
        handle: "tl" | "tr" | "bl" | "br" | "tm" | "bm" | "ml" | "mr";
        startX: number;
        startY: number;
        startScale: number;
        imgW: number;
        imgH: number;
      }
    | null
  >(null);
  const isPanningRef = useRef(false);
  const pinchActiveRef = useRef(false);
  const fillTokenRef = useRef(0);
  const panDragStartRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const stitchCacheRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const stitchStyleVersion = 6;
  const activeFilterRect =
    filterSelecting && filterPreviewRect ? filterPreviewRect : filterRect ?? filterPreviewRect;

  const normalizeRect = (start: { x: number; y: number }, end: { x: number; y: number }) => ({
    x0: Math.min(start.x, end.x),
    y0: Math.min(start.y, end.y),
    x1: Math.max(start.x, end.x),
    y1: Math.max(start.y, end.y),
  });

  const isCellInFilter = (x: number, y: number) =>
    !activeFilterRect ||
    (x >= activeFilterRect.x0 &&
      x <= activeFilterRect.x1 &&
      y >= activeFilterRect.y0 &&
      y <= activeFilterRect.y1);

  const isPointInFilter = (point: { x: number; y: number }) => {
    if (!activeFilterRect) return true;
    const cellX = Math.floor(point.x / cellSize);
    const cellY = Math.floor(point.y / cellSize);
    return isCellInFilter(cellX, cellY);
  };

  const updateHoverCell = (next: { x: number; y: number } | null) => {
    setHoverCell((prev) => {
      if (!next && !prev) return prev;
      if (next && prev && next.x === prev.x && next.y === prev.y) return prev;
      return next;
    });
  };

  function hexToRgb(hex: string) {
    const clean = hex.replace("#", "");
    if (clean.length !== 6) return null;
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    if ([r, g, b].some((v) => Number.isNaN(v))) return null;
    return { r, g, b };
  }

  function rgbToHsl(r: number, g: number, b: number) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const delta = max - min;
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;
    if (delta !== 0) {
      s = delta / (1 - Math.abs(2 * l - 1));
      if (max === rn) h = ((gn - bn) / delta) % 6;
      else if (max === gn) h = (bn - rn) / delta + 2;
      else h = (rn - gn) / delta + 4;
      h /= 6;
      if (h < 0) h += 1;
    }
    return { h, s, l };
  }

  function hslToRgb(h: number, s: number, l: number) {
    if (s === 0) {
      const v = Math.round(l * 255);
      return { r: v, g: v, b: v };
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hueToRgb = (t: number) => {
      let tt = t;
      if (tt < 0) tt += 1;
      if (tt > 1) tt -= 1;
      if (tt < 1 / 6) return p + (q - p) * 6 * tt;
      if (tt < 1 / 2) return q;
      if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
      return p;
    };
    const r = Math.round(hueToRgb(h + 1 / 3) * 255);
    const g = Math.round(hueToRgb(h) * 255);
    const b = Math.round(hueToRgb(h - 1 / 3) * 255);
    return { r, g, b };
  }

  function adjustLightness(hex: string, amount: number) {
    const rgb = hexToRgb(hex);
    if (!rgb) return { r: 0, g: 0, b: 0 };
    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
    const nextL = Math.min(1, Math.max(0, hsl.l + amount));
    return hslToRgb(hsl.h, hsl.s, nextL);
  }

  function hashString(input: string) {
    let hash = 2166136261;
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function mulberry32(seed: number) {
    let t = seed;
    return () => {
      t += 0x6d2b79f5;
      let r = Math.imul(t ^ (t >>> 15), t | 1);
      r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  function getThreadRadii(size: number) {
    const s = Math.max(1, Math.round(size));
    const padding = -0.2;
    const half = Math.max(1, s / 2 - padding);
    const ratio = 1.28;
    const b = (Math.SQRT2 * half) / Math.sqrt(ratio * ratio + 1);
    const a = b * ratio;
    return { radiusX: Math.max(1, a), radiusY: Math.max(1, b) };
  }

  function getThreadStitchCanvas(hex: string, size: number) {
    const rounded = Math.max(1, Math.round(size));
    const key = `${stitchStyleVersion}|${hex}|${rounded}`;
    const cached = stitchCacheRef.current.get(key);
    if (cached) return cached;
    const canvas = document.createElement("canvas");
    canvas.width = rounded;
    canvas.height = rounded;
    const ctx = canvas.getContext("2d");
    if (!ctx) return canvas;
    ctx.clearRect(0, 0, rounded, rounded);

    const center = rounded / 2;
    const { radiusX, radiusY } = getThreadRadii(rounded);

    const light = adjustLightness(hex, 0.18);
    const dark = adjustLightness(hex, -0.18);
    const highlightColor = `rgba(${light.r}, ${light.g}, ${light.b}, 0.3)`;
    const shadowColor = `rgba(${dark.r}, ${dark.g}, ${dark.b}, 0.25)`;
    const ridgeColor = `rgba(${light.r}, ${light.g}, ${light.b}, 0.12)`;
    const glintColor = `rgba(${light.r}, ${light.g}, ${light.b}, 0.12)`;

    ctx.save();
    ctx.translate(center, center);
    ctx.rotate(-Math.PI / 4);

    ctx.fillStyle = hex;
    ctx.beginPath();
    ctx.ellipse(0, 0, radiusX, radiusY, 0, 0, Math.PI * 2);
    ctx.fill();

    const highlight = ctx.createLinearGradient(-radiusX, 0, radiusX, 0);
    highlight.addColorStop(0, highlightColor);
    highlight.addColorStop(0.45, "rgba(0,0,0,0)");
    highlight.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = highlight;
    ctx.beginPath();
    ctx.ellipse(0, 0, radiusX, radiusY, 0, 0, Math.PI * 2);
    ctx.fill();

    const shadow = ctx.createLinearGradient(-radiusX, 0, radiusX, 0);
    shadow.addColorStop(0, "rgba(0,0,0,0)");
    shadow.addColorStop(0.55, "rgba(0,0,0,0)");
    shadow.addColorStop(1, shadowColor);
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.ellipse(0, 0, radiusX, radiusY, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = ridgeColor;
    ctx.lineWidth = Math.max(0.6, rounded * 0.04);
    const ridgeCount = rounded >= 18 ? 4 : 3;
    const offsets =
      ridgeCount === 4
        ? [-0.35, -0.12, 0.12, 0.35]
        : [-0.25, 0, 0.25];
    offsets.forEach((t) => {
      const y = t * radiusY;
      ctx.beginPath();
      ctx.moveTo(-radiusX * 0.85, y);
      ctx.lineTo(radiusX * 0.85, y);
      ctx.stroke();
    });

    ctx.strokeStyle = glintColor;
    ctx.lineWidth = Math.max(0.5, rounded * 0.03);
    ctx.beginPath();
    ctx.moveTo(-radiusX * 0.2, -radiusY * 0.05);
    ctx.lineTo(radiusX * 0.2, -radiusY * 0.05);
    ctx.stroke();

    const rand = mulberry32(hashString(key));
    ctx.strokeStyle = `rgba(${light.r}, ${light.g}, ${light.b}, 0.1)`;
    ctx.lineWidth = Math.max(0.4, rounded * 0.02);
    const fuzzLines = rounded >= 18 ? 10 : 8;
    for (let i = 0; i < fuzzLines; i++) {
      const y = (rand() * 2 - 1) * radiusY * 0.65;
      const x0 = -radiusX * 0.75 + rand() * radiusX * 1.5;
      const len = radiusX * (0.08 + rand() * 0.22);
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x0 + len, y);
      ctx.stroke();
    }

    ctx.restore();
    stitchCacheRef.current.set(key, canvas);
    return canvas;
  }

  const baseOffsetX = Math.max(0, (containerWidth - canvasW) / 2);
  const baseOffsetY = Math.max(0, (containerHeight - canvasH) / 2);

  function clampPan(x: number, y: number) {
    const edgeMinX = containerWidth - baseOffsetX - canvasW;
    const edgeMaxX = -baseOffsetX;
    const edgeMinY = containerHeight - baseOffsetY - canvasH;
    const edgeMaxY = -baseOffsetY;
    const baseOverscroll = Math.min(containerWidth, containerHeight) * 0.25;
    const overscrollX = baseOverscroll + Math.max(0, baseOffsetY - baseOffsetX);
    const overscrollY = baseOverscroll + Math.max(0, baseOffsetX - baseOffsetY);
    const minX = Math.min(edgeMinX, edgeMaxX) - overscrollX;
    const maxX = Math.max(edgeMinX, edgeMaxX) + overscrollX;
    const minY = Math.min(edgeMinY, edgeMaxY) - overscrollY;
    const maxY = Math.max(edgeMinY, edgeMaxY) + overscrollY;
    return {
      x: Math.max(minX, Math.min(maxX, x)),
      y: Math.max(minY, Math.min(maxY, y)),
    };
  }

  useLayoutEffect(() => {
    prevPanRef.current = panOffset;
  }, [panOffset]);

  useLayoutEffect(() => {
    const prevZoom = prevZoomRef.current;
    const prevCellSize = prevCellSizeRef.current;
    const prevBase = prevBaseOffsetRef.current;
    if (prevZoom !== zoom && Number.isFinite(prevCellSize) && prevCellSize > 0) {
      const centerX = containerWidth / 2;
      const centerY = containerHeight / 2;
      const prevPan = prevPanRef.current;
      const gridCenterX = (centerX - prevBase.x - prevPan.x) / prevCellSize;
      const gridCenterY = (centerY - prevBase.y - prevPan.y) / prevCellSize;
      if (Number.isFinite(gridCenterX) && Number.isFinite(gridCenterY)) {
        const nextPanX = centerX - baseOffsetX - gridCenterX * cellSize;
        const nextPanY = centerY - baseOffsetY - gridCenterY * cellSize;
        setPanOffset(clampPan(nextPanX, nextPanY));
      }
    }
    prevZoomRef.current = zoom;
    prevCellSizeRef.current = cellSize;
    prevBaseOffsetRef.current = { x: baseOffsetX, y: baseOffsetY };
  }, [zoom, cellSize, containerWidth, containerHeight, baseOffsetX, baseOffsetY]);

  useLayoutEffect(() => {
    setPanOffset((prev) => clampPan(prev.x, prev.y));
  }, [canvasW, canvasH, containerWidth, containerHeight]);

  const lastCenterTokenRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (centerCanvasToken === undefined) return;
    if (centerCanvasToken === lastCenterTokenRef.current) return;
    lastCenterTokenRef.current = centerCanvasToken;
    setPanOffset(() => clampPan(0, 0));
  }, [centerCanvasToken]);

  useEffect(() => {
    if (focusCellToken === undefined || focusCellToken === lastFocusTokenRef.current) return;
    lastFocusTokenRef.current = focusCellToken;
    const cell = focusCellRef.current;
    if (!cell) return;
    const targetX = containerWidth / 2 - baseOffsetX - (cell.x + 0.5) * cellSize;
    const targetY = containerHeight / 2 - baseOffsetY - (cell.y + 0.5) * cellSize;
    setPanOffset(() => clampPan(targetX, targetY));
  }, [
    focusCellToken,
    cellSize,
    containerWidth,
    containerHeight,
    baseOffsetX,
    baseOffsetY,
    canvasW,
    canvasH,
  ]);

  const pinchPointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStartDistanceRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef<number | null>(null);
  const pinchLastCenterRef = useRef<{ x: number; y: number } | null>(null);

  const drawTranslateX = baseOffsetX + panOffset.x;
  const drawTranslateY = baseOffsetY + panOffset.y;

  const paletteRgb = useMemo(() => {
    const arr: Array<{ id: number; r: number; g: number; b: number }> = [];
    for (const color of paletteById.values()) {
      const hex = color.hex.replace("#", "");
      if (hex.length !== 6) continue;
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) continue;
      arr.push({ id: color.id, r, g, b });
    }
    return arr;
  }, [paletteById]);


  // Render
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Crisp lines on high DPI screens
    const dpr = window.devicePixelRatio || 1;
    const surfaceW = containerWidth || canvasW;
    const surfaceH = containerHeight || canvasH;
    canvas.width = Math.floor(surfaceW * dpr);
    canvas.height = Math.floor(surfaceH * dpr);
    canvas.style.width = `${surfaceW}px`;
    canvas.style.height = `${surfaceH}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Background
    ctx.clearRect(0, 0, surfaceW, surfaceH);
    // Keep canvas transparent so overscroll reveals the container background.

    // Trace image (below cells)
    if (traceImage && traceOpacity > 0) {
      ctx.save();
      ctx.translate(drawTranslateX, drawTranslateY);
      if (!traceAdjustMode) {
        ctx.beginPath();
        ctx.rect(0, 0, canvasW, canvasH);
        ctx.clip();
      }
      ctx.globalAlpha = Math.min(1, Math.max(0, traceOpacity));
      const drawW = traceImage.width * traceScale * zoom;
      const drawH = traceImage.height * traceScale * zoom;
      ctx.drawImage(traceImage, traceOffsetX * zoom, traceOffsetY * zoom, drawW, drawH);
      ctx.restore();
    }

    // Cells
    const gridAlpha = Math.min(1, Math.max(0, 1 - traceOpacity));
    ctx.save();
    ctx.translate(drawTranslateX, drawTranslateY);
    ctx.globalAlpha = gridAlpha;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const colorId = grid[idx(x, y, width)];
        if (colorId === 0) continue;
        const color = paletteById.get(colorId);
        if (!color) continue;
        ctx.fillStyle = color.hex;
        if (threadView) {
          const stitch = getThreadStitchCanvas(color.hex, cellSize);
          ctx.drawImage(stitch, x * cellSize, y * cellSize, cellSize, cellSize);
        } else {
          const x0 = Math.round(x * cellSize);
          const y0 = Math.round(y * cellSize);
          const x1 = Math.round((x + 1) * cellSize);
          const y1 = Math.round((y + 1) * cellSize);
          ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
        }

        if (showSymbols) {
          const symbol = symbolForColorId(color.id, symbolMap);
          if (symbol) {
            const centerX = x * cellSize + cellSize / 2;
            const centerY = y * cellSize + cellSize / 2;
            ctx.save();
            ctx.globalAlpha = 1;
            ctx.fillStyle = contrastForHex(color.hex);
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.font = `700 ${Math.max(6, Math.floor(cellSize * 0.7))}px ui-sans-serif, system-ui, sans-serif`;
            ctx.fillText(symbol, centerX, centerY + 0.5);
            ctx.restore();
          }
        }
      }
    }
    ctx.restore();

    // Gridlines
    if (showGridlines) {
      ctx.save();
      ctx.translate(drawTranslateX, drawTranslateY);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = darkCanvas ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.18)";
      ctx.lineWidth = 1;
      const maxX = Math.max(0, canvasW - 0.5);
      const maxY = Math.max(0, canvasH - 0.5);

      // Vertical lines
      for (let x = 0; x <= width; x++) {
        const px = Math.min(maxX, Math.round(x * cellSize) + 0.5);
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, canvasH);
        ctx.stroke();
      }
      // Horizontal lines
      for (let y = 0; y <= height; y++) {
        const py = Math.min(maxY, Math.round(y * cellSize) + 0.5);
        ctx.beginPath();
        ctx.moveTo(0, py);
        ctx.lineTo(canvasW, py);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (identifyColorId != null) {
      ctx.save();
      ctx.translate(drawTranslateX, drawTranslateY);
      ctx.fillStyle = "rgba(90,90,90,0.82)";
      ctx.fillRect(0, 0, canvasW, canvasH);

      const drawIdentifyCell = (x: number, y: number) => {
        if (threadView) {
          const centerX = x * cellSize + cellSize / 2;
          const centerY = y * cellSize + cellSize / 2;
          const { radiusX, radiusY } = getThreadRadii(cellSize);
          ctx.save();
          ctx.translate(centerX, centerY);
          ctx.rotate(-Math.PI / 4);
          ctx.beginPath();
          ctx.ellipse(0, 0, radiusX, radiusY, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        } else {
          const x0 = Math.round(x * cellSize);
          const y0 = Math.round(y * cellSize);
          const x1 = Math.round((x + 1) * cellSize);
          const y1 = Math.round((y + 1) * cellSize);
          ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
        }
      };

      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0,0,0,1)";
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (grid[idx(x, y, width)] !== identifyColorId) continue;
          drawIdentifyCell(x, y);
        }
      }
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(255,255,0,0.85)";
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (grid[idx(x, y, width)] !== identifyColorId) continue;
          drawIdentifyCell(x, y);
        }
      }
      if (showSymbols) {
        const symbol = symbolForColorId(identifyColorId, symbolMap);
        if (symbol) {
          ctx.fillStyle = "rgba(0,0,0,0.9)";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.font = `700 ${Math.max(6, Math.floor(cellSize * 0.7))}px ui-sans-serif, system-ui, sans-serif`;
          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              if (grid[idx(x, y, width)] !== identifyColorId) continue;
              ctx.fillText(symbol, x * cellSize + cellSize / 2, y * cellSize + cellSize / 2 + 0.5);
            }
          }
        }
      }
      ctx.restore();
    }

    if (traceAdjustMode && traceImage) {
      ctx.save();
      ctx.translate(drawTranslateX, drawTranslateY);
      const x = traceOffsetX * zoom;
      const y = traceOffsetY * zoom;
      const w = traceImage.width * traceScale * zoom;
      const h = traceImage.height * traceScale * zoom;
      const handleSize = 8;
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      const half = handleSize / 2;
      const handles = [
        [x, y],
        [x + w, y],
        [x, y + h],
        [x + w, y + h],
        [x + w / 2, y],
        [x + w / 2, y + h],
        [x, y + h / 2],
        [x + w, y + h / 2],
      ];
      handles.forEach(([cx, cy]) => {
        ctx.fillRect(cx - half, cy - half, handleSize, handleSize);
        ctx.strokeRect(cx - half, cy - half, handleSize, handleSize);
      });
      ctx.restore();
    }

    // Lasso overlay
    if (lassoPoints.length > 0) {
      ctx.save();
      ctx.translate(drawTranslateX, drawTranslateY);
      ctx.strokeStyle = darkCanvas ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.8)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(lassoPoints[0].x, lassoPoints[0].y);
      for (let i = 1; i < lassoPoints.length; i++) {
        ctx.lineTo(lassoPoints[i].x, lassoPoints[i].y);
      }
      if (lassoClosed) ctx.closePath();
      ctx.stroke();

      ctx.restore();
    }

    if (hoverCell && (tool === "paint" || tool === "eraser") && !panMode && !traceAdjustMode) {
      const size = Math.max(1, Math.floor(brushSize));
      const radius = Math.floor(size / 2);
      const startX = hoverCell.x - radius;
      const startY = hoverCell.y - radius;
      const endX = startX + size - 1;
      const endY = startY + size - 1;
      const clampedStartX = Math.max(0, startX);
      const clampedStartY = Math.max(0, startY);
      const clampedEndX = Math.min(width - 1, endX);
      const clampedEndY = Math.min(height - 1, endY);
      if (clampedStartX <= clampedEndX && clampedStartY <= clampedEndY) {
        const x0 = Math.round(clampedStartX * cellSize);
        const y0 = Math.round(clampedStartY * cellSize);
        const x1 = Math.round((clampedEndX + 1) * cellSize);
        const y1 = Math.round((clampedEndY + 1) * cellSize);
        const previewW = x1 - x0;
        const previewH = y1 - y0;
        const color = paletteById.get(activeColorId);
        let fill = "";
        if (tool === "paint" && color) {
          const rgb = hexToRgb(color.hex);
          if (rgb) fill = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.25)`;
        } else if (tool === "eraser") {
          fill = darkCanvas ? "rgba(0,0,0,0.35)" : "rgba(255,255,255,0.5)";
        }
        ctx.save();
        ctx.translate(drawTranslateX, drawTranslateY);
        if (fill) {
          ctx.fillStyle = fill;
          ctx.fillRect(x0, y0, previewW, previewH);
        }
        ctx.strokeStyle = darkCanvas ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0.7)";
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.strokeRect(
          x0 + 0.5,
          y0 + 0.5,
          Math.max(0, previewW - 1),
          Math.max(0, previewH - 1)
        );
        ctx.restore();
      }
    }

    if (filterSelecting && !activeFilterRect) {
      ctx.save();
      ctx.translate(drawTranslateX, drawTranslateY);
      ctx.fillStyle = "rgba(15, 23, 42, 0.35)";
      ctx.fillRect(0, 0, canvasW, canvasH);
      ctx.restore();
    }

    if (activeFilterRect) {
      const x0 = Math.round(activeFilterRect.x0 * cellSize);
      const y0 = Math.round(activeFilterRect.y0 * cellSize);
      const x1 = Math.round((activeFilterRect.x1 + 1) * cellSize);
      const y1 = Math.round((activeFilterRect.y1 + 1) * cellSize);
      const w = x1 - x0;
      const h = y1 - y0;
      if (w > 0 && h > 0) {
        ctx.save();
        ctx.translate(drawTranslateX, drawTranslateY);
        ctx.fillStyle = "rgba(15, 23, 42, 0.35)";
        ctx.beginPath();
        ctx.rect(0, 0, canvasW, canvasH);
        ctx.rect(x0, y0, w, h);
        ctx.fill("evenodd");
        ctx.strokeStyle = "rgba(191, 100, 217, 0.95)";
        ctx.lineWidth = 2;
        if (filterSelecting) {
          ctx.setLineDash([6, 4]);
        } else {
          ctx.setLineDash([]);
        }
        ctx.strokeRect(x0 + 1, y0 + 1, Math.max(0, w - 2), Math.max(0, h - 2));
        ctx.restore();
      }
    }
  }, [
    width,
    height,
    grid,
    paletteById,
    symbolMap,
    cellSize,
    showGridlines,
    canvasW,
    canvasH,
    containerWidth,
    containerHeight,
    lassoPoints,
    lassoClosed,
    threadView,
    traceImage,
    traceOpacity,
    traceScale,
    traceOffsetX,
    traceOffsetY,
    traceAdjustMode,
    darkCanvas,
    drawTranslateX,
    drawTranslateY,
    panOffset,
    showSymbols,
    identifyColorId,
    hoverCell,
    tool,
    brushSize,
    activeColorId,
    panMode,
    activeFilterRect,
    filterSelecting,
  ]);

  function getCellFromEvent(e: React.PointerEvent<HTMLCanvasElement>, ignoreFilter = false) {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left - drawTranslateX) / cellSize);
    const y = Math.floor((e.clientY - rect.top - drawTranslateY) / cellSize);
    if (x < 0 || y < 0 || x >= width || y >= height) return null;
    if (!ignoreFilter && !isCellInFilter(x, y)) return null;
    return { x, y };
  }

  function getClampedCellFromEvent(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const rawX = Math.floor((e.clientX - rect.left - drawTranslateX) / cellSize);
    const rawY = Math.floor((e.clientY - rect.top - drawTranslateY) / cellSize);
    const x = Math.max(0, Math.min(width - 1, rawX));
    const y = Math.max(0, Math.min(height - 1, rawY));
    return { x, y };
  }

  function getCanvasPoint(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    return { x: e.clientX - rect.left - drawTranslateX, y: e.clientY - rect.top - drawTranslateY };
  }

  function findClosestPaletteColor(r: number, g: number, b: number) {
    let bestId: number | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const color of paletteRgb) {
      const dr = color.r - r;
      const dg = color.g - g;
      const db = color.b - b;
      const dist = dr * dr + dg * dg + db * db;
      if (dist < bestDist) {
        bestDist = dist;
        bestId = color.id;
      }
    }
    return bestId;
  }

  function sampleTraceColorAtCell(cell: { x: number; y: number }) {
    if (!traceImage) return null;
    const scale = traceScale * zoom;
    if (!Number.isFinite(scale) || scale <= 0) return null;
    const centerX = (cell.x + 0.5) * cellSize;
    const centerY = (cell.y + 0.5) * cellSize;
    const imgX = (centerX - traceOffsetX * zoom) / scale;
    const imgY = (centerY - traceOffsetY * zoom) / scale;
    if (imgX < 0 || imgY < 0 || imgX >= traceImage.width || imgY >= traceImage.height) return null;
    const canvas = traceSamplerRef.current ?? document.createElement("canvas");
    traceSamplerRef.current = canvas;
    if (canvas.width !== traceImage.width || canvas.height !== traceImage.height) {
      canvas.width = traceImage.width;
      canvas.height = traceImage.height;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(traceImage, 0, 0);
    const data = ctx.getImageData(Math.floor(imgX), Math.floor(imgY), 1, 1).data;
    if (data[3] < 10) return null;
    return { r: data[0], g: data[1], b: data[2] };
  }

  function contrastForHex(hex: string) {
    const clean = hex.replace("#", "");
    if (clean.length !== 6) return "#000000";
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return luminance > 0.6 ? "#000000" : "#ffffff";
  }

  function pointInPolygon(point: { x: number; y: number }, polygon: { x: number; y: number }[]) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x;
      const yi = polygon[i].y;
      const xj = polygon[j].x;
      const yj = polygon[j].y;
      const intersect =
        yi > point.y !== yj > point.y &&
        point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function clampZoom(value: number) {
    return Math.min(maxZoom, Math.max(minZoom, Number(value.toFixed(2))));
  }

  function updatePinchPointer(id: number, x: number, y: number) {
    pinchPointersRef.current.set(id, { x, y });
    if (pinchPointersRef.current.size === 2) {
      pinchActiveRef.current = true;
      const points = Array.from(pinchPointersRef.current.values());
      const dx = points[0].x - points[1].x;
      const dy = points[0].y - points[1].y;
      const distance = Math.hypot(dx, dy);
      const center = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
      if (pinchStartDistanceRef.current === null) {
        pinchStartDistanceRef.current = distance;
        pinchStartZoomRef.current = zoom;
        pinchLastCenterRef.current = center;
      } else if (pinchStartZoomRef.current !== null) {
        const nextZoom = clampZoom((pinchStartZoomRef.current * distance) / pinchStartDistanceRef.current);
        onZoomChange(nextZoom);
        if (pinchLastCenterRef.current) {
          const deltaX = center.x - pinchLastCenterRef.current.x;
          const deltaY = center.y - pinchLastCenterRef.current.y;
          if (deltaX !== 0 || deltaY !== 0) {
            setPanOffset((prev) => clampPan(prev.x + deltaX, prev.y + deltaY));
          }
        }
        pinchLastCenterRef.current = center;
      }
    }
  }

  function clearPinchPointer(id: number) {
    pinchPointersRef.current.delete(id);
    if (pinchPointersRef.current.size < 2) {
      pinchStartDistanceRef.current = null;
      pinchStartZoomRef.current = null;
      pinchLastCenterRef.current = null;
    }
  }

  function paintLine(from: { x: number; y: number }, to: { x: number; y: number }, colorId: number) {
    let x0 = from.x;
    let y0 = from.y;
    const x1 = to.x;
    const y1 = to.y;
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    while (true) {
      paintStamp(x0, y0, colorId);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  function paintStamp(x: number, y: number, colorId: number) {
    const size = Math.max(1, Math.floor(brushSize));
    const radius = Math.floor(size / 2);
    const startX = x - radius;
    const startY = y - radius;
    const endX = startX + size - 1;
    const endY = startY + size - 1;
    for (let py = startY; py <= endY; py++) {
      for (let px = startX; px <= endX; px++) {
        if (px < 0 || py < 0 || px >= width || py >= height) continue;
        if (!isCellInFilter(px, py)) continue;
        onPaintCell(px, py, colorId);
      }
    }
  }

  type FillResult = { next: Uint16Array; filled: boolean; indices?: number[] };
  type FillBounds = { minX: number; maxX: number; minY: number; maxY: number };

  function scanlineFillSync(
    gridSnapshot: Uint16Array,
    startX: number,
    startY: number,
    targetColor: number,
    newColorId: number,
    collectIndices: boolean,
    bounds?: FillBounds
  ): FillResult {
    const w = width;
    const h = height;
    const minX = bounds?.minX ?? 0;
    const maxX = bounds?.maxX ?? w - 1;
    const minY = bounds?.minY ?? 0;
    const maxY = bounds?.maxY ?? h - 1;
    if (startX < minX || startX > maxX || startY < minY || startY > maxY) {
      return { next: new Uint16Array(gridSnapshot), filled: false };
    }
    const next = new Uint16Array(gridSnapshot);
    const max = w * h;
    const stackX = new Int32Array(max);
    const stackY = new Int32Array(max);
    let sp = 0;
    stackX[sp] = startX;
    stackY[sp] = startY;
    sp++;
    let filledAny = false;
    const indices: number[] | undefined = collectIndices ? [] : undefined;

    const scanRow = (ny: number, xL: number, xR: number) => {
      if (ny < minY || ny > maxY) return;
      const row = ny * w;
      let i = row + Math.max(minX, xL);
      const end = row + Math.min(maxX, xR);
      while (i <= end) {
        if (next[i] === targetColor) {
          stackX[sp] = i - row;
          stackY[sp] = ny;
          sp++;
          i++;
          while (i <= end && next[i] === targetColor) i++;
        } else {
          i++;
        }
      }
    };

    while (sp > 0) {
      sp--;
      const x0 = stackX[sp];
      const y0 = stackY[sp];
      if (x0 < minX || x0 > maxX || y0 < minY || y0 > maxY) continue;
      const row = y0 * w;
      if (next[row + x0] !== targetColor) continue;

      let xL = x0;
      while (xL >= minX && next[row + xL] === targetColor) xL--;
      xL++;
      let xR = x0;
      while (xR <= maxX && next[row + xR] === targetColor) xR++;
      xR--;

      for (let x = xL; x <= xR; x++) {
        const i = row + x;
        next[i] = newColorId;
        if (indices) indices.push(i);
      }
      filledAny = true;
      scanRow(y0 - 1, xL, xR);
      scanRow(y0 + 1, xL, xR);
    }

    return { next, filled: filledAny, indices };
  }

  async function scanlineFillChunked(
    gridSnapshot: Uint16Array,
    startX: number,
    startY: number,
    targetColor: number,
    newColorId: number,
    collectIndices: boolean,
    token: number,
    chunkSeedsPerFrame: number,
    bounds?: FillBounds
  ): Promise<FillResult | null> {
    const w = width;
    const h = height;
    const minX = bounds?.minX ?? 0;
    const maxX = bounds?.maxX ?? w - 1;
    const minY = bounds?.minY ?? 0;
    const maxY = bounds?.maxY ?? h - 1;
    if (startX < minX || startX > maxX || startY < minY || startY > maxY) {
      return { next: new Uint16Array(gridSnapshot), filled: false };
    }
    const next = new Uint16Array(gridSnapshot);
    const max = w * h;
    const stackX = new Int32Array(max);
    const stackY = new Int32Array(max);
    let sp = 0;
    stackX[sp] = startX;
    stackY[sp] = startY;
    sp++;
    let filledAny = false;
    const indices: number[] | undefined = collectIndices ? [] : undefined;

    const scanRow = (ny: number, xL: number, xR: number) => {
      if (ny < minY || ny > maxY) return;
      const row = ny * w;
      let i = row + Math.max(minX, xL);
      const end = row + Math.min(maxX, xR);
      while (i <= end) {
        if (next[i] === targetColor) {
          stackX[sp] = i - row;
          stackY[sp] = ny;
          sp++;
          i++;
          while (i <= end && next[i] === targetColor) i++;
        } else {
          i++;
        }
      }
    };

    const seedsPerFrame = Math.max(1, Math.floor(chunkSeedsPerFrame));

    return new Promise((resolve) => {
      const step = () => {
        if (fillTokenRef.current !== token) {
          resolve(null);
          return;
        }
        if (gridRef.current !== gridSnapshot) {
          resolve(null);
          return;
        }
        let processed = 0;
        while (sp > 0 && processed < seedsPerFrame) {
          sp--;
          const x0 = stackX[sp];
          const y0 = stackY[sp];
          if (x0 < minX || x0 > maxX || y0 < minY || y0 > maxY) {
            processed++;
            continue;
          }
          const row = y0 * w;
          if (next[row + x0] !== targetColor) {
            processed++;
            continue;
          }

          let xL = x0;
          while (xL >= minX && next[row + xL] === targetColor) xL--;
          xL++;
          let xR = x0;
          while (xR <= maxX && next[row + xR] === targetColor) xR++;
          xR--;

          for (let x = xL; x <= xR; x++) {
            const i = row + x;
            next[i] = newColorId;
            if (indices) indices.push(i);
          }
          filledAny = true;
          scanRow(y0 - 1, xL, xR);
          scanRow(y0 + 1, xL, xR);
          processed++;
        }

        if (sp > 0) {
          requestAnimationFrame(step);
        } else {
          resolve({ next, filled: filledAny, indices });
        }
      };
      requestAnimationFrame(step);
    });
  }

  async function fillRegion(startX: number, startY: number, newColorId: number) {
    const gridSnapshot = gridRef.current;
    const startIdx = idx(startX, startY, width);
    const targetColor = gridSnapshot[startIdx];
    if (targetColor === newColorId) return;

    const token = ++fillTokenRef.current;
    const collectIndices = !onFillGrid && Boolean(onFillCells);
    const maxCells = width * height;
    // Optional chunking for very large fills to keep the UI responsive.
    const shouldChunk = typeof requestAnimationFrame === "function" && maxCells > 240000;
    const bounds = filterRect
      ? { minX: filterRect.x0, maxX: filterRect.x1, minY: filterRect.y0, maxY: filterRect.y1 }
      : undefined;

    const result = shouldChunk
      ? await scanlineFillChunked(
          gridSnapshot,
          startX,
          startY,
          targetColor,
          newColorId,
          collectIndices,
          token,
          1800,
          bounds
        )
      : scanlineFillSync(gridSnapshot, startX, startY, targetColor, newColorId, collectIndices, bounds);

    if (!result || !result.filled) return;
    if (fillTokenRef.current !== token) return;
    if (gridRef.current !== gridSnapshot) return;

    if (onFillGrid) {
      onFillGrid(result.next);
    } else if (onFillCells && result.indices) {
      onFillCells(result.indices, newColorId);
    }
  }

  function maybeAddLassoPoint(point: { x: number; y: number }) {
    if (!isPointInFilter(point)) return;
    const last = lastLassoPointRef.current;
    if (!last) {
      lastLassoPointRef.current = point;
      onLassoPoint(point);
      return;
    }
    const minStep = Math.max(2, cellSize * 0.3);
    if (Math.hypot(point.x - last.x, point.y - last.y) >= minStep) {
      lastLassoPointRef.current = point;
      onLassoPoint(point);
    }
  }

  function getTraceHandle(point: { x: number; y: number }) {
    if (!traceImage) return null;
    const x = traceOffsetX * zoom;
    const y = traceOffsetY * zoom;
    const w = traceImage.width * traceScale * zoom;
    const h = traceImage.height * traceScale * zoom;
    const handleRadius = 8;
    const near = (px: number, py: number, cx: number, cy: number) =>
      Math.abs(px - cx) <= handleRadius && Math.abs(py - cy) <= handleRadius;
    if (near(point.x, point.y, x, y)) return "tl";
    if (near(point.x, point.y, x + w, y)) return "tr";
    if (near(point.x, point.y, x, y + h)) return "bl";
    if (near(point.x, point.y, x + w, y + h)) return "br";
    const midX = x + w / 2;
    const midY = y + h / 2;
    if (near(point.x, point.y, midX, y)) return "tm";
    if (near(point.x, point.y, midX, y + h)) return "bm";
    if (near(point.x, point.y, x, midY)) return "ml";
    if (near(point.x, point.y, x + w, midY)) return "mr";
    return null;
  }

  const alignX = "flex-start";
  const alignY = "flex-start";
  const effectivePanMode = panMode && !(traceAdjustMode && traceImage);
  const containerBg = darkCanvas ? "#000000" : threadView ? "#e6e6e6" : "#ffffff";

  return (
    <div
      style={{
        position: "relative",
        display: "inline-flex",
        justifyContent: alignX,
        alignItems: alignY,
        justifySelf: "center",
        alignSelf: "start",
        width: containerWidth || canvasW,
        height: containerHeight || canvasH,
        overflow: "hidden",
        borderRadius: 0,
        background: containerBg,
        boxShadow: "inset 0 0 0 1px rgba(15,23,42,0.15)",
        touchAction: "none",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          touchAction: "none",
          cursor:
            filterSelecting
              ? "crosshair"
              : effectivePanMode
                ? "grab"
                : traceAdjustMode && traceImage
                  ? "grab"
                  : tool === "eyedropper"
                    ? `url(${assetPath("/dropper_cursor.svg")}) 2 14, auto`
                    : tool === "paint" || tool === "eraser"
                      ? "crosshair"
                      : "auto",
        }}
        onContextMenu={(e) => {
          e.preventDefault();
        }}
        onPointerDown={(e) => {
          if (pinchEnabled && e.pointerType === "touch") {
            e.preventDefault();
            (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
          }
          if (filterSelecting) {
            e.preventDefault();
            const cell = getClampedCellFromEvent(e);
            if (!cell) return;
            (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
            filterDragStartRef.current = cell;
            setFilterPreviewRect({ x0: cell.x, y0: cell.y, x1: cell.x, y1: cell.y });
            return;
          }
          if (tool === "paint" || tool === "eraser") {
            updateHoverCell(getCellFromEvent(e));
          } else {
            updateHoverCell(null);
          }
          if (effectivePanMode || e.button === 2) {
            e.preventDefault();
            (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
            isPanningRef.current = true;
            const clamped = clampPan(panOffset.x, panOffset.y);
            setPanOffset(clamped);
            panDragStartRef.current = { x: e.clientX, y: e.clientY, ox: clamped.x, oy: clamped.y };
            return;
          }
          if (traceAdjustMode && traceImage) {
            const point = getCanvasPoint(e);
            const handle = getTraceHandle(point);
            (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
            if (handle) {
              traceResizeRef.current = {
                handle,
                startX: traceOffsetX,
                startY: traceOffsetY,
                startScale: traceScale,
                imgW: traceImage.width,
                imgH: traceImage.height,
              };
            } else {
              isTracingDragRef.current = true;
              traceDragStartRef.current = { x: e.clientX, y: e.clientY, ox: traceOffsetX, oy: traceOffsetY };
            }
            return;
          }
          if (pinchEnabled && e.pointerType === "touch") {
            updatePinchPointer(e.pointerId, e.clientX, e.clientY);
            if (pinchPointersRef.current.size >= 2) {
              pinchActiveRef.current = true;
              if (isPainting) {
                setIsPainting(false);
                onStrokeEnd();
              }
              return;
            }
          }
          if (tool === "paint" || tool === "eraser") {
            if (pinchEnabled && pinchActiveRef.current) return;
            (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
            setIsPainting(true);
            onStrokeStart();
            const cell = getCellFromEvent(e);
            if (!cell) return;
            lastPaintCellRef.current = cell;
            const colorId = tool === "eraser" ? 0 : activeColorId;
            paintStamp(cell.x, cell.y, colorId);
            return;
          }
          if (tool === "fill") {
            if (pinchEnabled && pinchActiveRef.current) return;
            const cell = getCellFromEvent(e);
            if (!cell) return;
            void fillRegion(cell.x, cell.y, activeColorId);
            return;
          }
          if (tool === "eyedropper") {
            if (pinchEnabled && pinchActiveRef.current) return;
            const cell = getCellFromEvent(e);
            if (!cell) return;
            const colorId = grid[idx(cell.x, cell.y, width)];
            if (colorId !== 0) {
              onPickColor(colorId);
              onPickColorComplete?.();
              return;
            }
            const sampled = sampleTraceColorAtCell(cell);
            if (!sampled) return;
            const nearest = findClosestPaletteColor(sampled.r, sampled.g, sampled.b);
            if (!nearest) return;
            onPickColor(nearest);
            onPickColorComplete?.();
            return;
          }
          if (tool === "lasso") {
            if (pinchEnabled && pinchActiveRef.current) return;
            const point = getCanvasPoint(e);
            if (!isPointInFilter(point)) return;
            if (lassoClosed && lassoPoints.length >= 3 && pointInPolygon(point, lassoPoints)) {
              onLassoFill(lassoPoints);
              return;
            }
            (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
            setIsLassoing(true);
            lastLassoPointRef.current = point;
            onLassoReset(point);
          }
        }}
        onPointerMove={(e) => {
          if (pinchEnabled && e.pointerType === "touch" && pinchPointersRef.current.size >= 2) {
            e.preventDefault();
          }
          if (filterSelecting) {
            if (filterDragStartRef.current) {
              const cell = getClampedCellFromEvent(e);
              setFilterPreviewRect(normalizeRect(filterDragStartRef.current, cell));
            }
            return;
          }
          if (tool === "paint" || tool === "eraser") {
            if (
              isPanningRef.current ||
              traceResizeRef.current ||
              isTracingDragRef.current ||
              isLassoing ||
              (pinchEnabled && pinchActiveRef.current) ||
              panMode ||
              traceAdjustMode
            ) {
              updateHoverCell(null);
            } else {
              updateHoverCell(getCellFromEvent(e));
            }
          } else if (hoverCell) {
            updateHoverCell(null);
          }
          if (isPanningRef.current && panDragStartRef.current) {
            const dx = e.clientX - panDragStartRef.current.x;
            const dy = e.clientY - panDragStartRef.current.y;
            const next = clampPan(panDragStartRef.current.ox + dx, panDragStartRef.current.oy + dy);
            setPanOffset(next);
            return;
          }
          if (traceResizeRef.current && traceImage) {
            const point = getCanvasPoint(e);
            const px = point.x / zoom;
            const py = point.y / zoom;
            const { handle, startX, startY, startScale, imgW, imgH } = traceResizeRef.current;
            const baseW = imgW * startScale;
            const baseH = imgH * startScale;
            const minScale = 0.05;
            let nextScale = startScale;
            let nextX = startX;
            let nextY = startY;
            if (handle === "tl") {
              const brX = startX + baseW;
              const brY = startY + baseH;
              const sx = (brX - px) / imgW;
              const sy = (brY - py) / imgH;
              nextScale = Math.max(minScale, Math.min(sx, sy));
              nextX = brX - imgW * nextScale;
              nextY = brY - imgH * nextScale;
            } else if (handle === "tr") {
              const blX = startX;
              const blY = startY + baseH;
              const sx = (px - blX) / imgW;
              const sy = (blY - py) / imgH;
              nextScale = Math.max(minScale, Math.min(sx, sy));
              nextX = blX;
              nextY = blY - imgH * nextScale;
            } else if (handle === "bl") {
              const trX = startX + baseW;
              const trY = startY;
              const sx = (trX - px) / imgW;
              const sy = (py - trY) / imgH;
              nextScale = Math.max(minScale, Math.min(sx, sy));
              nextX = trX - imgW * nextScale;
              nextY = trY;
            } else if (handle === "br") {
              const tlX = startX;
              const tlY = startY;
              const sx = (px - tlX) / imgW;
              const sy = (py - tlY) / imgH;
              nextScale = Math.max(minScale, Math.min(sx, sy));
              nextX = tlX;
              nextY = tlY;
            } else if (handle === "tm") {
              const anchorX = startX + baseW / 2;
              const anchorY = startY + baseH;
              const rawH = anchorY - py;
              const nextH = Math.max(imgH * minScale, rawH);
              const nextW = (nextH * imgW) / imgH;
              nextScale = nextW / imgW;
              nextX = anchorX - nextW / 2;
              nextY = anchorY - nextH;
            } else if (handle === "bm") {
              const anchorX = startX + baseW / 2;
              const anchorY = startY;
              const rawH = py - anchorY;
              const nextH = Math.max(imgH * minScale, rawH);
              const nextW = (nextH * imgW) / imgH;
              nextScale = nextW / imgW;
              nextX = anchorX - nextW / 2;
              nextY = anchorY;
            } else if (handle === "ml") {
              const anchorX = startX + baseW;
              const anchorY = startY + baseH / 2;
              const rawW = anchorX - px;
              const nextW = Math.max(imgW * minScale, rawW);
              const nextH = (nextW * imgH) / imgW;
              nextScale = nextW / imgW;
              nextX = anchorX - nextW;
              nextY = anchorY - nextH / 2;
            } else if (handle === "mr") {
              const anchorX = startX;
              const anchorY = startY + baseH / 2;
              const rawW = px - anchorX;
              const nextW = Math.max(imgW * minScale, rawW);
              const nextH = (nextW * imgH) / imgW;
              nextScale = nextW / imgW;
              nextX = anchorX;
              nextY = anchorY - nextH / 2;
            }
            onTraceScaleChange(nextScale);
            onTraceOffsetChange(nextX, nextY);
            return;
          }
          if (isTracingDragRef.current && traceDragStartRef.current) {
            const dx = e.clientX - traceDragStartRef.current.x;
            const dy = e.clientY - traceDragStartRef.current.y;
            onTraceOffsetChange(traceDragStartRef.current.ox + dx / zoom, traceDragStartRef.current.oy + dy / zoom);
            return;
          }
          if (isLassoing && tool === "lasso") {
            maybeAddLassoPoint(getCanvasPoint(e));
            return;
          }
          if (pinchEnabled && e.pointerType === "touch" && pinchPointersRef.current.size >= 2) {
            updatePinchPointer(e.pointerId, e.clientX, e.clientY);
            return;
          }
          if (pinchEnabled && pinchActiveRef.current) return;
          if (!isPainting) return;
          const cell = getCellFromEvent(e);
          if (!cell) return;
          const colorId = tool === "eraser" ? 0 : activeColorId;
          const last = lastPaintCellRef.current;
          if (last) {
            paintLine(last, cell, colorId);
          } else {
            paintStamp(cell.x, cell.y, colorId);
          }
          lastPaintCellRef.current = cell;
        }}
        onPointerUp={(e) => {
          if (filterSelecting && filterDragStartRef.current) {
            const endPoint = getClampedCellFromEvent(e);
            const rect = normalizeRect(filterDragStartRef.current, endPoint);
            filterDragStartRef.current = null;
            setFilterPreviewRect(null);
            onFilterRectChange?.(rect);
            onFilterSelectEnd?.();
            return;
          }
          if (isPanningRef.current) {
            isPanningRef.current = false;
            panDragStartRef.current = null;
            return;
          }
          if (traceResizeRef.current) {
            traceResizeRef.current = null;
            return;
          }
          if (isTracingDragRef.current) {
            isTracingDragRef.current = false;
            traceDragStartRef.current = null;
            return;
          }
          if (isLassoing) {
            setIsLassoing(false);
            lastLassoPointRef.current = null;
            onLassoClose();
            return;
          }
          setIsPainting(false);
          lastPaintCellRef.current = null;
          onStrokeEnd();
        }}
        onPointerCancel={(e) => {
          if (filterSelecting && filterDragStartRef.current) {
            const endPoint = getClampedCellFromEvent(e);
            const rect = normalizeRect(filterDragStartRef.current, endPoint);
            filterDragStartRef.current = null;
            setFilterPreviewRect(null);
            onFilterRectChange?.(rect);
            onFilterSelectEnd?.();
            return;
          }
          if (isPanningRef.current) {
            isPanningRef.current = false;
            panDragStartRef.current = null;
            return;
          }
          if (traceResizeRef.current) {
            traceResizeRef.current = null;
            return;
          }
          if (isTracingDragRef.current) {
            isTracingDragRef.current = false;
            traceDragStartRef.current = null;
            return;
          }
          if (isLassoing) {
            setIsLassoing(false);
            lastLassoPointRef.current = null;
            onLassoClose();
            return;
          }
          setIsPainting(false);
          lastPaintCellRef.current = null;
          onStrokeEnd();
        }}
        onPointerLeave={() => {
          if (filterSelecting) {
            return;
          }
          updateHoverCell(null);
        }}
        onPointerUpCapture={(e) => {
          if (!pinchEnabled || e.pointerType !== "touch") return;
          clearPinchPointer(e.pointerId);
          if (pinchPointersRef.current.size < 2) {
            pinchActiveRef.current = false;
          }
        }}
        onPointerCancelCapture={(e) => {
          if (!pinchEnabled || e.pointerType !== "touch") return;
          clearPinchPointer(e.pointerId);
          if (pinchPointersRef.current.size < 2) {
            pinchActiveRef.current = false;
          }
        }}
        // style={{
        //   touchAction: pinchEnabled ? "none" : "manipulation",
        //   display: "block",
        // }} // critical for iOS dragging
      />
    </div>
  );
}
