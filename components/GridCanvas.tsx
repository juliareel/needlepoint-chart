"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Color } from "../lib/grid";
import { idx } from "../lib/grid";
import { symbolForColorId } from "../lib/symbols";

type Props = {
  width: number;
  height: number;
  grid: Uint16Array;
  paletteById: Map<number, Color>;
  activeColorId: number;
  cellSize: number;
  containerWidth: number;
  containerHeight: number;
  zoom: number;
  minZoom: number;
  maxZoom: number;
  pinchEnabled: boolean;
  onZoomChange: (nextZoom: number) => void;
  threadView: boolean;
  darkCanvas: boolean;
  showSymbols: boolean;
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
  tool: "paint" | "eraser" | "eyedropper" | "lasso";
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
};

export default function GridCanvas(props: Props) {
  const {
    width,
    height,
    grid,
    paletteById,
    activeColorId,
    cellSize,
    containerWidth,
    containerHeight,
    zoom,
    minZoom,
    maxZoom,
    pinchEnabled,
    onZoomChange,
    threadView,
    darkCanvas,
    showSymbols,
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
  } = props;

  const canvasW = width * cellSize;
  const canvasH = height * cellSize;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const traceSamplerRef = useRef<HTMLCanvasElement | null>(null);
  const [isPainting, setIsPainting] = useState(false);
  const [isLassoing, setIsLassoing] = useState(false);
  const lastLassoPointRef = useRef<{ x: number; y: number } | null>(null);
  const lastPaintCellRef = useRef<{ x: number; y: number } | null>(null);
  const isTracingDragRef = useRef(false);
  const traceDragStartRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const traceResizeRef = useRef<
    | {
        corner: "tl" | "tr" | "bl" | "br";
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
  const fillWorkerRef = useRef<Worker | null>(null);

  function createFillWorker() {
    const workerCode = `
      self.onmessage = (event) => {
        const data = event.data || {};
        const gridBuffer = data.gridBuffer;
        const width = data.width;
        const height = data.height;
        const startIdx = data.startIdx;
        const colorId = data.colorId;
        if (!gridBuffer || !width || !height) {
          self.postMessage({ gridBuffer });
          return;
        }
        const grid = new Uint16Array(gridBuffer);
        if (grid[startIdx] !== 0) {
          self.postMessage({ gridBuffer: grid.buffer, filledStart: false }, [grid.buffer]);
          return;
        }
        const max = width * height;
        const stackX = new Int32Array(max);
        const stackY = new Int32Array(max);
        let sp = 0;

        const pushSeed = (x, y) => {
          const i = y * width + x;
          if (grid[i] !== 0) return;
          stackX[sp] = x;
          stackY[sp] = y;
          sp++;
        };

        for (let x = 0; x < width; x++) {
          pushSeed(x, 0);
          pushSeed(x, height - 1);
        }
        for (let y = 1; y < height - 1; y++) {
          pushSeed(0, y);
          pushSeed(width - 1, y);
        }

        while (sp > 0) {
          sp--;
          const x0 = stackX[sp];
          const y0 = stackY[sp];
          const base = y0 * width;
          if (grid[base + x0] !== 0) continue;

          let xL = x0;
          while (xL >= 0 && grid[base + xL] === 0) {
            grid[base + xL] = colorId;
            xL--;
          }
          xL++;
          let xR = x0 + 1;
          while (xR < width && grid[base + xR] === 0) {
            grid[base + xR] = colorId;
            xR++;
          }
          xR--;

          const checkRow = (ny) => {
            if (ny < 0 || ny >= height) return;
            let i = ny * width + xL;
            const end = ny * width + xR;
            while (i <= end) {
              if (grid[i] === 0) {
                stackX[sp] = i - ny * width;
                stackY[sp] = ny;
                sp++;
                while (i <= end && grid[i] === 0) i++;
              }
              i++;
            }
          };

          checkRow(y0 - 1);
          checkRow(y0 + 1);
        }

        const filledStart = grid[startIdx] === colorId;
        self.postMessage({ gridBuffer: grid.buffer, filledStart }, [grid.buffer]);
      };
    `;
    const blob = new Blob([workerCode], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);
    return { worker, url };
  }
  const panDragStartRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });

  function clampPan(x: number, y: number) {
    const extraX = containerWidth - canvasW;
    const extraY = containerHeight - canvasH;
    const maxX = extraX > 0 ? extraX / 2 : 0;
    const maxY = extraY > 0 ? extraY / 2 : 0;
    const minX = extraX > 0 ? -extraX / 2 : containerWidth - canvasW;
    const minY = extraY > 0 ? -extraY / 2 : containerHeight - canvasH;
    return {
      x: Math.max(minX, Math.min(maxX, x)),
      y: Math.max(minY, Math.min(maxY, y)),
    };
  }

  useEffect(() => {
    setPanOffset((prev) => clampPan(prev.x, prev.y));
  }, [canvasW, canvasH, containerWidth, containerHeight]);
  const pinchPointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStartDistanceRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef<number | null>(null);

  const panByCanvasX = canvasW <= containerWidth;
  const panByCanvasY = canvasH <= containerHeight;
  const drawTranslateX = panByCanvasX ? 0 : panOffset.x;
  const drawTranslateY = panByCanvasY ? 0 : panOffset.y;

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
    canvas.width = Math.floor(canvasW * dpr);
    canvas.height = Math.floor(canvasH * dpr);
    canvas.style.width = `${canvasW}px`;
    canvas.style.height = `${canvasH}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Background
    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.fillStyle = darkCanvas ? "#000000" : "#ffffff";
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Trace image (below cells)
    if (traceImage && traceOpacity > 0) {
      ctx.save();
      ctx.translate(drawTranslateX, drawTranslateY);
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
          const centerX = x * cellSize + cellSize / 2;
          const centerY = y * cellSize + cellSize / 2;
          const radiusX = Math.max(1, cellSize * 0.6);
          const radiusY = Math.max(1, cellSize * 0.35);
          ctx.save();
          ctx.translate(centerX, centerY);
          ctx.rotate(-Math.PI / 4);
          ctx.beginPath();
          ctx.ellipse(0, 0, radiusX, radiusY, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        } else {
          ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
        }

        if (showSymbols) {
          const symbol = symbolForColorId(color.id);
          if (symbol) {
            const centerX = x * cellSize + cellSize / 2;
            const centerY = y * cellSize + cellSize / 2;
            ctx.save();
            ctx.fillStyle = contrastForHex(color.hex);
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.font = `${Math.max(8, Math.floor(cellSize * 0.6))}px ui-sans-serif, system-ui, sans-serif`;
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
      ctx.globalAlpha = gridAlpha;
      ctx.strokeStyle = darkCanvas ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.18)";
      ctx.lineWidth = 1;

      // Vertical lines
      for (let x = 0; x <= width; x++) {
        ctx.beginPath();
        ctx.moveTo(x * cellSize + 0.5, 0);
        ctx.lineTo(x * cellSize + 0.5, canvasH);
        ctx.stroke();
      }
      // Horizontal lines
      for (let y = 0; y <= height; y++) {
        ctx.beginPath();
        ctx.moveTo(0, y * cellSize + 0.5);
        ctx.lineTo(canvasW, y * cellSize + 0.5);
        ctx.stroke();
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
      const corners = [
        [x, y],
        [x + w, y],
        [x, y + h],
        [x + w, y + h],
      ];
      corners.forEach(([cx, cy]) => {
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
  }, [
    width,
    height,
    grid,
    paletteById,
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
  ]);

  function getCellFromEvent(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left - drawTranslateX) / cellSize);
    const y = Math.floor((e.clientY - rect.top - drawTranslateY) / cellSize);
    if (x < 0 || y < 0 || x >= width || y >= height) return null;
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
      const points = Array.from(pinchPointersRef.current.values());
      const dx = points[0].x - points[1].x;
      const dy = points[0].y - points[1].y;
      const distance = Math.hypot(dx, dy);
      if (pinchStartDistanceRef.current === null) {
        pinchStartDistanceRef.current = distance;
        pinchStartZoomRef.current = zoom;
      } else if (pinchStartZoomRef.current !== null) {
        const nextZoom = clampZoom((pinchStartZoomRef.current * distance) / pinchStartDistanceRef.current);
        onZoomChange(nextZoom);
      }
    }
  }

  function clearPinchPointer(id: number) {
    pinchPointersRef.current.delete(id);
    if (pinchPointersRef.current.size < 2) {
      pinchStartDistanceRef.current = null;
      pinchStartZoomRef.current = null;
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
        onPaintCell(px, py, colorId);
      }
    }
  }

  // Fill tool temporarily disabled (keep logic for future revisit)
  async function fillAsync(startX: number, startY: number, colorId: number) {
    const gridSnapshot = grid;
    const startIdx = idx(startX, startY, width);
    if (gridSnapshot[startIdx] !== 0) return;
    let anyPainted = false;
    for (let i = 0; i < gridSnapshot.length; i++) {
      if (gridSnapshot[i] !== 0) {
        anyPainted = true;
        break;
      }
    }
    if (!anyPainted) {
      const next = new Uint16Array(gridSnapshot.length);
      next.fill(colorId);
      if (onFillGrid) {
        onFillGrid(next);
      } else if (onFillCells) {
        const all = Array.from({ length: gridSnapshot.length }, (_, i) => i);
        onFillCells(all, colorId);
      } else {
        for (let i = 0; i < gridSnapshot.length; i++) {
          const x = i % width;
          const y = Math.floor(i / width);
          onPaintCell(x, y, colorId);
        }
      }
      return;
    }
    const token = ++fillTokenRef.current;
    if (fillWorkerRef.current) {
      fillWorkerRef.current.terminate();
      fillWorkerRef.current = null;
    }
    if (typeof Worker !== "undefined") {
      const { worker, url } = createFillWorker();
      fillWorkerRef.current = worker;
      const gridCopy = new Uint16Array(gridSnapshot);
      const { result, filledStart } = await new Promise<{ result: Uint16Array; filledStart: boolean }>((resolve) => {
        const handleMessage = (event: MessageEvent) => {
          worker.removeEventListener("message", handleMessage);
          const data = event.data as { gridBuffer: ArrayBuffer; filledStart: boolean };
          resolve({ result: new Uint16Array(data.gridBuffer), filledStart: Boolean(data.filledStart) });
        };
        worker.addEventListener("message", handleMessage);
        worker.postMessage(
          {
            gridBuffer: gridCopy.buffer,
            width,
            height,
            startIdx,
            colorId,
          },
          [gridCopy.buffer]
        );
        setTimeout(() => {
          worker.removeEventListener("message", handleMessage);
          resolve({ result: new Uint16Array(gridSnapshot), filledStart: false });
        }, 5000);
      });
      worker.terminate();
      fillWorkerRef.current = null;
      URL.revokeObjectURL(url);
      if (fillTokenRef.current !== token) return;
      if (!filledStart) return;
      if (onFillGrid) {
        onFillGrid(result);
      } else if (onFillCells) {
        const cells: number[] = [];
        for (let i = 0; i < result.length; i++) {
          if (gridSnapshot[i] === 0 && result[i] === colorId) {
            cells.push(i);
          }
        }
        onFillCells(cells, colorId);
      } else {
        for (let i = 0; i < result.length; i++) {
          if (gridSnapshot[i] === 0 && result[i] === colorId) {
            const x = i % width;
            const y = Math.floor(i / width);
            onPaintCell(x, y, colorId);
          }
        }
      }
      return;
    }
    const visited = new Uint8Array(width * height);
    const queue = new Uint32Array(width * height);
    let head = 0;
    let tail = 0;
    const next = new Uint16Array(gridSnapshot);
    queue[tail++] = startIdx;
    visited[startIdx] = 1;

    const chunkSize = 8000;
    while (head < tail) {
      let count = 0;
      while (head < tail && count < chunkSize) {
        const i = queue[head++];
        if (gridSnapshot[i] !== 0) {
          count++;
          continue;
        }
        next[i] = colorId;
        const x = i % width;
        const y = Math.floor(i / width);
        if (x > 0) {
          const ni = i - 1;
          if (!visited[ni] && gridSnapshot[ni] === 0) {
            visited[ni] = 1;
            queue[tail++] = ni;
          }
        }
        if (x < width - 1) {
          const ni = i + 1;
          if (!visited[ni] && gridSnapshot[ni] === 0) {
            visited[ni] = 1;
            queue[tail++] = ni;
          }
        }
        if (y > 0) {
          const ni = i - width;
          if (!visited[ni] && gridSnapshot[ni] === 0) {
            visited[ni] = 1;
            queue[tail++] = ni;
          }
        }
        if (y < height - 1) {
          const ni = i + width;
          if (!visited[ni] && gridSnapshot[ni] === 0) {
            visited[ni] = 1;
            queue[tail++] = ni;
          }
        }
        count++;
      }
      if (fillTokenRef.current !== token) return;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    if (fillTokenRef.current !== token) return;
    if (onFillGrid) {
      onFillGrid(next);
    } else if (onFillCells) {
      const cells: number[] = [];
      for (let i = 0; i < next.length; i++) {
        if (gridSnapshot[i] === 0 && next[i] === colorId) {
          cells.push(i);
        }
      }
      onFillCells(cells, colorId);
    } else {
      for (let i = 0; i < next.length; i++) {
        if (gridSnapshot[i] === 0 && next[i] === colorId) {
          const x = i % width;
          const y = Math.floor(i / width);
          onPaintCell(x, y, colorId);
        }
      }
    }
  }

  function maybeAddLassoPoint(point: { x: number; y: number }) {
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
    return null;
  }

  const alignX = canvasW <= containerWidth ? "center" : "flex-start";
  const alignY = canvasH <= containerHeight ? "center" : "flex-start";

  return (
    <div
      style={{
        position: "relative",
        display: "inline-flex",
        justifyContent: alignX,
        alignItems: alignY,
        justifySelf: "start",
        alignSelf: "start",
        width: containerWidth || canvasW,
        height: containerHeight || canvasH,
        overflow: "hidden",
        borderRadius: 8,
        background: "rgba(255,255,255,0.08)",
        boxShadow: "inset 0 0 0 2px rgba(255,255,255,0.6)",
        touchAction: "none",
      }}
    >
      <canvas
        ref={canvasRef}
        height={canvasH}
        width={canvasW}
        style={{
          transform: `translate(${panByCanvasX ? panOffset.x : 0}px, ${panByCanvasY ? panOffset.y : 0}px)`,
          touchAction: "none",
          cursor:
            panMode
              ? "grab"
              : tool === "paint"
              ? "url(/brush_cursor.cur) 0 31, auto"
              : tool === "eraser"
                ? "url(/eraser_cursor.cur) 0 31, auto"
                : tool === "eyedropper"
                  ? "url(/dropper_cursor.cur) 0 31, auto"
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
          if (panMode || e.button === 2) {
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
                corner: handle,
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
          // Fill tool disabled
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
            const { corner, startX, startY, startScale, imgW, imgH } = traceResizeRef.current;
            const baseW = imgW * startScale;
            const baseH = imgH * startScale;
            const minScale = 0.05;
            let nextScale = startScale;
            let nextX = startX;
            let nextY = startY;
            if (corner === "tl") {
              const brX = startX + baseW;
              const brY = startY + baseH;
              const sx = (brX - px) / imgW;
              const sy = (brY - py) / imgH;
              nextScale = Math.max(minScale, Math.min(sx, sy));
              nextX = brX - imgW * nextScale;
              nextY = brY - imgH * nextScale;
            } else if (corner === "tr") {
              const blX = startX;
              const blY = startY + baseH;
              const sx = (px - blX) / imgW;
              const sy = (blY - py) / imgH;
              nextScale = Math.max(minScale, Math.min(sx, sy));
              nextX = blX;
              nextY = blY - imgH * nextScale;
            } else if (corner === "bl") {
              const trX = startX + baseW;
              const trY = startY;
              const sx = (trX - px) / imgW;
              const sy = (py - trY) / imgH;
              nextScale = Math.max(minScale, Math.min(sx, sy));
              nextX = trX - imgW * nextScale;
              nextY = trY;
            } else if (corner === "br") {
              const tlX = startX;
              const tlY = startY;
              const sx = (px - tlX) / imgW;
              const sy = (py - tlY) / imgH;
              nextScale = Math.max(minScale, Math.min(sx, sy));
              nextX = tlX;
              nextY = tlY;
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
        onPointerUp={() => {
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
        onPointerCancel={() => {
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
