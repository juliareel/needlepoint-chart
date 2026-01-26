"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import GridCanvas from "./GridCanvas";
import Palette from "./Palette";
import ExportPdfButton from "./ExportPdfButton";
import type { Color } from "../lib/grid";
import { idx, makeGrid } from "../lib/grid";
import { DMC_COLORS } from "../lib/dmcColors";
import { symbolForColorId } from "../lib/symbols";

const DEFAULT_PALETTE: Color[] = DMC_COLORS;
const EXPORT_CELL_SIZE = 24;

type Point = { x: number; y: number };

function pointInPolygon(point: Point, polygon: Point[]) {
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

export default function PatternEditor() {
  const [title, setTitle] = useState("My Needlepoint Pattern");
  const [isNarrow, setIsNarrow] = useState(false);
  const [isCompact, setIsCompact] = useState(false);

  const [gridW, setGridW] = useState(112);
  const [gridH, setGridH] = useState(140);
  type Snapshot = { gridW: number; gridH: number; grid: Uint16Array };
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);
  const historyRef = useRef<Snapshot[]>([]);
  const futureRef = useRef<Snapshot[]>([]);
  const [tool, setTool] = useState<"paint" | "eraser" | "eyedropper" | "lasso">("paint");
  const [brushSize, setBrushSize] = useState(1);
  const [lassoPoints, setLassoPoints] = useState<Point[]>([]);
  const [lassoClosed, setLassoClosed] = useState(false);
  const [gridMode, setGridMode] = useState<"stitches" | "inches">("stitches");
  const [meshCount, setMeshCount] = useState(10);
  const [widthIn, setWidthIn] = useState(11.2);
  const [heightIn, setHeightIn] = useState(14);
  const [draftGridMode, setDraftGridMode] = useState<"stitches" | "inches">(gridMode);
  const [draftGridW, setDraftGridW] = useState(gridW);
  const [draftGridH, setDraftGridH] = useState(gridH);
  const [draftMeshCount, setDraftMeshCount] = useState(meshCount);
  const [draftWidthIn, setDraftWidthIn] = useState(widthIn);
  const [draftHeightIn, setDraftHeightIn] = useState(heightIn);
  const [threadView, setThreadView] = useState(false);
  const [darkCanvas, setDarkCanvas] = useState(false);
  const [showSymbols, setShowSymbols] = useState(false);
  const [gridOpen, setGridOpen] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [canvasSettingsOpen, setCanvasSettingsOpen] = useState(true);
  const [traceImageUrl, setTraceImageUrl] = useState<string | null>(null);
  const [traceFileName, setTraceFileName] = useState<string | null>(null);
  const [traceImage, setTraceImage] = useState<HTMLImageElement | null>(null);
  const [traceOpacity, setTraceOpacity] = useState(0.6);
  const [traceScale, setTraceScale] = useState(1);
  const [traceOffsetX, setTraceOffsetX] = useState(0);
  const [traceOffsetY, setTraceOffsetY] = useState(0);
  const [traceLocked, setTraceLocked] = useState(false);
  const [configTab, setConfigTab] = useState<"grid" | "trace">("grid");
  const [panMode, setPanMode] = useState(false);
  const traceUrlRef = useRef<string | null>(null);
  const strokeActiveRef = useRef(false);
  const strokeDirtyRef = useRef(false);
  const strokeSnapshotRef = useRef<Snapshot | null>(null);
  const strokePendingCommitRef = useRef(false);
  const strokeVersionRef = useRef(0);
  const gridRef = useRef<Uint16Array | null>(null);

  const [palette, setPalette] = useState<Color[]>(DEFAULT_PALETTE);
  const paletteById = useMemo(() => new Map(palette.map((c) => [c.id, c])), [palette]);

  const [activeColorId, setActiveColorId] = useState<number>(DEFAULT_PALETTE[3].id);
  const [remapSourceId, setRemapSourceId] = useState<number | null>(null);
  const [remapTargetId, setRemapTargetId] = useState<number | null>(null);
  const draftInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isNarrow) {
      setCanvasSettingsOpen(false);
      setPaletteOpen(false);
    }
  }, [isNarrow]);
  const remapOriginalRef = useRef<Uint16Array | null>(null);

  const [zoom, setZoom] = useState(1);
  const [canvasControlsHeight, setCanvasControlsHeight] = useState(0);
  const minZoom = 0.25;
  const maxZoom = isNarrow ? 8 : 4;
  const [showGridlines, setShowGridlines] = useState(true);

  const [grid, setGrid] = useState<Uint16Array>(() => makeGrid(gridW, gridH, 0));
  const canvasAreaRef = useRef<HTMLDivElement | null>(null);
  const [canvasAreaWidth, setCanvasAreaWidth] = useState(0);

  useEffect(() => {
    gridRef.current = grid;
  }, [grid]);

  useEffect(() => {
    if (!traceImageUrl) {
      setTraceImage(null);
      setTraceFileName(null);
      setTraceOpacity(0);
      return;
    }
    const img = new Image();
    img.onload = () => setTraceImage(img);
    img.src = traceImageUrl;
    return () => {
      setTraceImage(null);
    };
  }, [traceImageUrl]);



  useEffect(() => {
    return () => {
      if (traceUrlRef.current) {
        URL.revokeObjectURL(traceUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const el = canvasAreaRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setCanvasAreaWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const narrowQuery = window.matchMedia("(max-width: 900px)");
    const compactQuery = window.matchMedia("(max-width: 640px)");

    const handleChange = () => {
      setIsNarrow(narrowQuery.matches);
      setIsCompact(compactQuery.matches);
    };

    handleChange();
    narrowQuery.addEventListener("change", handleChange);
    compactQuery.addEventListener("change", handleChange);
    return () => {
      narrowQuery.removeEventListener("change", handleChange);
      compactQuery.removeEventListener("change", handleChange);
    };
  }, []);

  const fitCellSize = useMemo(() => {
    if (canvasAreaWidth <= 0) return 1;
    return Math.max(1, canvasAreaWidth / gridW);
  }, [canvasAreaWidth, gridW]);

  const prevFitCellSizeRef = useRef(fitCellSize);

  const displayCellSize = useMemo(() => {
    return Math.max(1, Number((fitCellSize * zoom).toFixed(2)));
  }, [fitCellSize, zoom]);

  const containerWidth = Math.max(1, canvasAreaWidth);
  const containerHeight = Math.max(1, Math.round((containerWidth * gridH) / gridW));
  const canvasW = gridW * displayCellSize;
  const canvasH = gridH * displayCellSize;

  useEffect(() => {
    if (!traceImage) {
      prevFitCellSizeRef.current = fitCellSize;
      return;
    }
    const prev = prevFitCellSizeRef.current;
    if (prev > 0 && fitCellSize > 0 && prev !== fitCellSize) {
      const ratio = fitCellSize / prev;
      setTraceScale((value) => value * ratio);
      setTraceOffsetX((value) => value * ratio);
      setTraceOffsetY((value) => value * ratio);
    }
    prevFitCellSizeRef.current = fitCellSize;
  }, [fitCellSize, traceImage]);

  function clampZoom(value: number) {
    return Math.min(maxZoom, Math.max(minZoom, Number(value.toFixed(2))));
  }

  function fitTraceToGrid() {
    if (!traceImage) return;
    const baseCanvasW = gridW * fitCellSize;
    const baseCanvasH = gridH * fitCellSize;
    const scale = Math.min(baseCanvasW / traceImage.width, baseCanvasH / traceImage.height);
    setTraceScale(scale);
    setTraceOffsetX((baseCanvasW - traceImage.width * scale) / 2);
    setTraceOffsetY((baseCanvasH - traceImage.height * scale) / 2);
  }

  function clearTraceImage() {
    setTraceImageUrl(null);
    setTraceFileName(null);
    setTraceImage(null);
    setTraceOpacity(0);
    setTraceLocked(false);
    if (traceUrlRef.current) {
      URL.revokeObjectURL(traceUrlRef.current);
      traceUrlRef.current = null;
    }
  }

  useEffect(() => {
    if (tool !== "lasso") {
      setLassoPoints([]);
      setLassoClosed(false);
    }
  }, [tool]);

  useEffect(() => {
    if (meshCount <= 0) return;
    if (gridMode !== "stitches") return;
    setWidthIn(Number((gridW / meshCount).toFixed(2)));
    setHeightIn(Number((gridH / meshCount).toFixed(2)));
  }, [gridW, gridH, meshCount, gridMode]);

  useEffect(() => {
    setDraftGridMode(gridMode);
    setDraftGridW(gridW);
    setDraftGridH(gridH);
    setDraftMeshCount(meshCount);
    setDraftWidthIn(widthIn);
    setDraftHeightIn(heightIn);
  }, [gridMode, gridW, gridH, meshCount, widthIn, heightIn]);

  function bumpStrokeVersion() {
    strokeVersionRef.current += 1;
  }

  function setHistoryState(next: Snapshot[]) {
    historyRef.current = next;
    setHistory(next);
  }

  function setFutureState(next: Snapshot[]) {
    futureRef.current = next;
    setFuture(next);
  }

  function pushHistory(entry: Snapshot) {
    setHistoryState([...historyRef.current, entry]);
  }

  function pushFuture(entry: Snapshot) {
    setFutureState([...futureRef.current, entry]);
  }

  function commitPendingStroke() {
    if (!strokePendingCommitRef.current) return;
    const snapshot = strokeSnapshotRef.current;
    if (snapshot) {
      pushHistory(snapshot);
      setFutureState([]);
    }
    strokePendingCommitRef.current = false;
    strokeSnapshotRef.current = null;
  }

  function popHistory() {
    const current = historyRef.current;
    if (current.length === 0) return null;
    const last = current[current.length - 1];
    setHistoryState(current.slice(0, -1));
    return last;
  }

  function popFuture() {
    const current = futureRef.current;
    if (current.length === 0) return null;
    const last = current[current.length - 1];
    setFutureState(current.slice(0, -1));
    return last;
  }

  function updateGrid(updater: (prev: Uint16Array) => Uint16Array, version?: number) {
    setGrid((prev) => {
      if (version !== undefined && version !== strokeVersionRef.current) return prev;
      const next = updater(prev);
      if (next === prev) return prev;
      if (strokeActiveRef.current) {
      } else {
        pushHistory({ gridW, gridH, grid: prev });
        setFutureState([]);
      }
      return next;
    });
  }

  // Keep a reference to the actual canvas element inside GridCanvas:
  // easiest approach: wrap GridCanvas in a div and query; but better: pass a ref down.
  // For MVP, we’ll do a lightweight approach by duplicating the canvas render ref inside GridCanvas later.
  // Here we’ll store a ref and attach it by exposing it in GridCanvas if desired.
  const exportCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Paint updates (immutable-ish: copy Uint16Array)
  function onPaintCell(x: number, y: number, colorId: number) {
    const currentGrid = gridRef.current ?? grid;
    const cellIdx = idx(x, y, gridW);
    if (currentGrid[cellIdx] === colorId) return;
    if (strokeActiveRef.current) {
      strokeDirtyRef.current = true;
    }
    const version = strokeVersionRef.current;
    updateGrid((prev) => {
      const next = new Uint16Array(prev);
      next[cellIdx] = colorId;
      return next;
    }, version);
  }

  function onFillCells(indices: number[], colorId: number) {
    if (indices.length === 0) return;
    if (strokeActiveRef.current) {
      strokeDirtyRef.current = true;
    }
    const version = strokeVersionRef.current;
    updateGrid((prev) => {
      const next = new Uint16Array(prev);
      for (const i of indices) {
        next[i] = colorId;
      }
      return next;
    }, version);
  }

  function onFillGrid(nextGrid: Uint16Array) {
    if (strokeActiveRef.current) {
      strokeDirtyRef.current = true;
    }
    const version = strokeVersionRef.current;
    updateGrid(() => nextGrid, version);
  }

  function resetGrid(newW: number, newH: number) {
    bumpStrokeVersion();
    pushHistory({ gridW, gridH, grid });
    setFutureState([]);
    setGridW(newW);
    setGridH(newH);
    setGrid(makeGrid(newW, newH, 0));
  }

  function applyGridFromInches(inW: number, inH: number, mesh: number) {
    const safeMesh = Math.max(1, mesh);
    const targetW = Math.max(1, Math.round(inW * safeMesh));
    const targetH = Math.max(1, Math.round(inH * safeMesh));
    resetGrid(targetW, targetH);
  }

  function applyDraftGrid() {
    if (draftGridMode === "stitches") {
      if (gridMode === "stitches" && draftGridW === gridW && draftGridH === gridH) {
        return;
      }
      setGridMode("stitches");
      resetGrid(draftGridW, draftGridH);
      return;
    }
    if (
      gridMode === "inches" &&
      draftMeshCount === meshCount &&
      draftWidthIn === widthIn &&
      draftHeightIn === heightIn
    ) {
      return;
    }
    setGridMode("inches");
    setMeshCount(draftMeshCount);
    setWidthIn(draftWidthIn);
    setHeightIn(draftHeightIn);
    applyGridFromInches(draftWidthIn, draftHeightIn, draftMeshCount);
  }

  function clearGrid() {
    bumpStrokeVersion();
    updateGrid(() => makeGrid(gridW, gridH, 0));
  }

  function undo() {
    commitPendingStroke();
    const last = popHistory();
    if (!last) return;
    bumpStrokeVersion();
    pushFuture({ gridW, gridH, grid });
    setGridW(last.gridW);
    setGridH(last.gridH);
    setGrid(last.grid);
  }

  function redo() {
    commitPendingStroke();
    const next = popFuture();
    if (!next) return;
    bumpStrokeVersion();
    pushHistory({ gridW, gridH, grid });
    setGridW(next.gridW);
    setGridH(next.gridH);
    setGrid(next.grid);
  }

  function beginStroke() {
    strokeActiveRef.current = true;
    strokeDirtyRef.current = false;
    strokeSnapshotRef.current = { gridW, gridH, grid };
    bumpStrokeVersion();
  }

  function endStroke() {
    if (!strokeActiveRef.current) return;
    if (strokeSnapshotRef.current && strokeDirtyRef.current) {
      strokePendingCommitRef.current = true;
      queueMicrotask(() => {
        commitPendingStroke();
      });
    } else {
      strokeSnapshotRef.current = null;
    }
    strokeActiveRef.current = false;
    strokeDirtyRef.current = false;
  }

  function addLassoPoint(point: Point) {
    if (lassoClosed) {
      setLassoPoints([point]);
      setLassoClosed(false);
      return;
    }
    setLassoPoints((points) => [...points, point]);
  }

  function resetLasso(point: Point) {
    setLassoPoints([point]);
    setLassoClosed(false);
  }

  function closeLasso() {
    if (lassoPoints.length < 3) return;
    setLassoClosed(true);
  }

  function fillLasso(points: Point[]) {
    if (points.length < 3) return;
    updateGrid((prev) => {
      const next = new Uint16Array(prev);
      let changed = false;
      for (let y = 0; y < gridH; y++) {
        for (let x = 0; x < gridW; x++) {
          const cx = (x + 0.5) * displayCellSize;
          const cy = (y + 0.5) * displayCellSize;
          if (!pointInPolygon({ x: cx, y: cy }, points)) continue;
          const cellIdx = idx(x, y, gridW);
          if (next[cellIdx] === activeColorId) continue;
          next[cellIdx] = activeColorId;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setLassoPoints([]);
    setLassoClosed(false);
  }

  function addColor(name: string, hex: string) {
    setPalette((prev) => {
      const nextId = prev.reduce((m, c) => Math.max(m, c.id), 0) + 1;
      return [...prev, { id: nextId, name, hex, family: "Custom" }];
    });
  }

  function replaceColor(sourceId: number, targetId: number) {
    if (sourceId === targetId) {
      setRemapSourceId(null);
      return;
    }
    bumpStrokeVersion();
    pushHistory({ gridW, gridH, grid });
    setFutureState([]);
    setGrid((prev) => {
      const next = new Uint16Array(prev);
      let changed = false;
      for (let i = 0; i < next.length; i++) {
        if (next[i] === sourceId) {
          next[i] = targetId;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setActiveColorId(targetId);
    setRemapSourceId(null);
  }

  function beginRemap(sourceId: number) {
    setRemapSourceId(sourceId);
    setRemapTargetId(null);
    remapOriginalRef.current = new Uint16Array(grid);
  }

  function previewRemap(targetId: number) {
    if (remapSourceId === null) return;
    const original = remapOriginalRef.current ?? new Uint16Array(grid);
    remapOriginalRef.current = original;
    setRemapTargetId(targetId);
    setGrid(() => {
      const next = new Uint16Array(original);
      for (let i = 0; i < next.length; i++) {
        if (next[i] === remapSourceId) next[i] = targetId;
      }
      return next;
    });
  }

  function cancelRemap() {
    if (remapOriginalRef.current) {
      setGrid(remapOriginalRef.current);
    }
    remapOriginalRef.current = null;
    setRemapSourceId(null);
    setRemapTargetId(null);
  }

  function confirmRemap() {
    if (remapSourceId === null || remapTargetId === null) {
      cancelRemap();
      return;
    }
    const original = remapOriginalRef.current ?? new Uint16Array(grid);
    bumpStrokeVersion();
    pushHistory({ gridW, gridH, grid: original });
    setFutureState([]);
    setGrid(() => {
      const next = new Uint16Array(original);
      for (let i = 0; i < next.length; i++) {
        if (next[i] === remapSourceId) next[i] = remapTargetId;
      }
      return next;
    });
    setActiveColorId(remapTargetId);
    remapOriginalRef.current = null;
    setRemapSourceId(null);
    setRemapTargetId(null);
  }

  const usedColors = useMemo(() => {
    const counts = new Map<number, number>();
    for (let i = 0; i < grid.length; i++) {
      const id = grid[i];
      if (id === 0) continue;
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    const arr = Array.from(counts.entries())
      .map(([id, count]) => ({ color: paletteById.get(id)!, count }))
      .filter((x) => Boolean(x.color))
      .sort((a, b) => b.count - a.count);
    return arr;
  }, [grid, paletteById]);

  async function buildTraceImageDataUrl() {
    if (!traceImage) return null;
    const canvas = document.createElement("canvas");
    canvas.width = traceImage.width;
    canvas.height = traceImage.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(traceImage, 0, 0);
    return canvas.toDataURL("image/png");
  }

  async function saveDraft() {
    const traceImageDataUrl = await buildTraceImageDataUrl();
    const draft = {
      version: 1,
      title,
      gridW,
      gridH,
      grid: Array.from(grid),
      gridMode,
      meshCount,
      widthIn,
      heightIn,
      brushSize,
      activeColorId,
      showGridlines,
      threadView,
      darkCanvas,
      showSymbols,
      zoom,
      trace: {
        imageDataUrl: traceImageDataUrl,
        opacity: traceOpacity,
        scale: traceScale,
        offsetX: traceOffsetX,
        offsetY: traceOffsetY,
        locked: traceLocked,
      },
    };
    const blob = new Blob([JSON.stringify(draft)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${sanitizeFilename(title || "needlepoint-draft")}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function loadDraftFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string);
        if (!parsed || parsed.version !== 1) return;
        setTitle(parsed.title || "My Needlepoint Pattern");
        setGridW(parsed.gridW);
        setGridH(parsed.gridH);
        const expectedSize = parsed.gridW * parsed.gridH;
        const nextGrid =
          Array.isArray(parsed.grid) && parsed.grid.length === expectedSize
            ? new Uint16Array(parsed.grid)
            : makeGrid(parsed.gridW, parsed.gridH);
        setGrid(nextGrid);
        setGridMode(parsed.gridMode || "stitches");
        setMeshCount(parsed.meshCount || 10);
        setWidthIn(parsed.widthIn || 11.2);
        setHeightIn(parsed.heightIn || 14);
        setDraftGridMode(parsed.gridMode || "stitches");
        setDraftGridW(parsed.gridW);
        setDraftGridH(parsed.gridH);
        setDraftMeshCount(parsed.meshCount || 10);
        setDraftWidthIn(parsed.widthIn || 11.2);
        setDraftHeightIn(parsed.heightIn || 14);
        setBrushSize(parsed.brushSize || 1);
        setActiveColorId(parsed.activeColorId || DEFAULT_PALETTE[0].id);
        setShowGridlines(Boolean(parsed.showGridlines));
        setThreadView(Boolean(parsed.threadView));
        setDarkCanvas(Boolean(parsed.darkCanvas));
        setShowSymbols(Boolean(parsed.showSymbols));
        setZoom(clampZoom(parsed.zoom || 1));
        setHistoryState([]);
        setFutureState([]);
        setRemapSourceId(null);
        setRemapTargetId(null);
        const trace = parsed.trace;
        if (trace?.imageDataUrl) {
          const img = new Image();
          img.onload = () => {
            setTraceImage(img);
            setTraceImageUrl(trace.imageDataUrl);
            setTraceFileName("Draft image");
            setTraceOpacity(trace.opacity ?? 0.5);
            setTraceScale(trace.scale ?? 1);
            setTraceOffsetX(trace.offsetX ?? 0);
            setTraceOffsetY(trace.offsetY ?? 0);
            setTraceLocked(Boolean(trace.locked));
            traceUrlRef.current = null;
          };
          img.src = trace.imageDataUrl;
        } else {
          setTraceImage(null);
          setTraceImageUrl(null);
          setTraceFileName(null);
          setTraceOpacity(0);
          setTraceScale(1);
          setTraceOffsetX(0);
          setTraceOffsetY(0);
          setTraceLocked(false);
          traceUrlRef.current = null;
        }
      } catch {
        // ignore malformed drafts
      }
    };
    reader.readAsText(file);
  }

  function sanitizeFilename(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  }

  function Toggle({
    label,
    checked,
    onChange,
  }: {
    label: string;
    checked: boolean;
    onChange: (next: boolean) => void;
  }) {
    return (
      <label
        style={{
          display: "grid",
          gap: 4,
          justifyItems: "start",
          cursor: "pointer",
        }}
      >
        <span style={{ fontSize: 12, opacity: 0.8 }}>{label}</span>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          style={{ position: "absolute", opacity: 0, width: 1, height: 1 }}
        />
        <span
          aria-hidden="true"
          style={{
            width: 36,
            height: 20,
            borderRadius: 999,
            border: "1px solid var(--foreground)",
            background: checked ? "var(--foreground)" : "transparent",
            position: "relative",
            transition: "background 150ms ease",
          }}
        >
          <span
            style={{
              position: "absolute",
              top: 2,
              left: checked ? 18 : 2,
              width: 14,
              height: 14,
              borderRadius: "50%",
              background: checked ? "var(--background)" : "var(--foreground)",
              transition: "left 150ms ease, background 150ms ease",
            }}
          />
        </span>
      </label>
    );
  }

  const usedColorsSection = (
    <div style={{ border: "1px solid var(--panel-border)", borderRadius: 12, padding: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Used colors</div>
      <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>
        Click a color to replace it.
      </div>
      {remapSourceId !== null && (
        <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 8 }}>
          Pick a replacement color from the palette, then press OK to apply.
          <button
            onClick={cancelRemap}
            style={{
              marginLeft: 8,
              padding: "2px 8px",
              borderRadius: 999,
              border: "1px solid var(--foreground)",
              background: "transparent",
              color: "var(--foreground)",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={confirmRemap}
            style={{
              marginLeft: 8,
              padding: "2px 8px",
              borderRadius: 999,
              border: "1px solid var(--foreground)",
              background: "var(--foreground)",
              color: "var(--background)",
              cursor: "pointer",
            }}
          >
            OK
          </button>
        </div>
      )}
      <div style={{ display: "grid", gap: 6 }}>
        {usedColors.length === 0 ? (
          <div style={{ opacity: 0.7 }}>None yet.</div>
        ) : (
          usedColors.slice(0, 12).map(({ color, count }) => (
            <button
              key={color.id}
              onClick={() => beginRemap(color.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "4px 6px",
                borderRadius: 8,
                border: remapSourceId === color.id ? "2px solid var(--foreground)" : "1px solid transparent",
                background: "transparent",
                cursor: "pointer",
                textAlign: "left",
              }}
              aria-label={`Replace ${color.name}`}
            >
              <span
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 4,
                  border: "1px solid rgba(0,0,0,0.2)",
                  background: color.hex,
                  display: "inline-block",
                }}
              />
              <span style={{ fontSize: 13 }}>
                {color.code ? `#${color.code} ` : ""}
                {color.name} ({count})
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );

  return (
      <div
        className="pattern-editor"
        style={{ display: "grid", gap: 12, padding: 16, maxWidth: "100%", margin: "0 auto" }}
      >
      {!isNarrow && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <ExportPdfButton
            title={title}
            canvasRef={exportCanvasRef}
            usedColors={usedColors}
            grid={grid}
            paletteById={paletteById}
            width={gridW}
            height={gridH}
            cellSize={EXPORT_CELL_SIZE}
          />
        </div>
      )}
      <div
        className="pattern-main"
        style={{
          display: "flex",
          gap: 16,
          alignItems: "flex-start",
          flexDirection: isNarrow ? "column" : "row",
          width: "100%",
          minWidth: 0,
        }}
      >
        <div
          className="pattern-sidebar"
          style={{
            display: "grid",
            gap: 16,
            alignContent: "start",
            flex: isNarrow ? "1 1 auto" : "0 0 280px",
            width: isNarrow ? "100%" : undefined,
          }}
        >
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontWeight: 700 }}>Needlepoint Pattern Editor (MVP)</div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--panel-border)" }}
            />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                onClick={saveDraft}
                style={{
                  padding: "6px 10px",
                  borderRadius: 8,
                  border: "1px solid var(--foreground)",
                  background: "transparent",
                  color: "var(--foreground)",
                  cursor: "pointer",
                }}
              >
                Save draft
              </button>
              <button
                onClick={() => draftInputRef.current?.click()}
                style={{
                  padding: "6px 10px",
                  borderRadius: 8,
                  border: "1px solid var(--foreground)",
                  background: "transparent",
                  color: "var(--foreground)",
                  cursor: "pointer",
                }}
              >
                Load draft
              </button>
              <input
                ref={draftInputRef}
                type="file"
                accept="application/json"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  loadDraftFile(file);
                  e.currentTarget.value = "";
                }}
                style={{ display: "none" }}
              />
            </div>
          </div>
          <div
            style={{
              border: "1px solid var(--panel-border)",
              borderRadius: 12,
              padding: 12,
              width: "100%",
              minHeight: !isNarrow || gridOpen ? 240 : 0,
              boxSizing: "border-box",
            }}
          >
            <button
              onClick={() => setGridOpen((open) => !open)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                width: "100%",
                border: "none",
                background: "transparent",
                padding: 0,
                marginBottom: gridOpen || !isNarrow ? 12 : 0,
                cursor: isNarrow ? "pointer" : "default",
                fontWeight: 600,
              }}
              type="button"
            >
              <span>{configTab === "grid" ? "Grid" : "Trace image"}</span>
              {isNarrow && <span style={{ opacity: 0.7 }}>{gridOpen ? "▾" : "▸"}</span>}
            </button>

            {(!isNarrow || gridOpen) && (configTab === "grid" ? (
              <div style={{ display: "grid", gap: 8, width: "100%" }}>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input
                      type="radio"
                      name="gridMode"
                      checked={draftGridMode === "stitches"}
                      onChange={() => setDraftGridMode("stitches")}
                    />
                    Stitches
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input
                      type="radio"
                      name="gridMode"
                      checked={draftGridMode === "inches"}
                      onChange={() => setDraftGridMode("inches")}
                    />
                    Inches + mesh
                  </label>
                </div>

                {draftGridMode === "stitches" ? (
                  <>
                    <label style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <span>Width (stitches)</span>
                    <input
                      type="number"
                      min={1}
                      value={draftGridW}
                      onChange={(e) => setDraftGridW(parseInt(e.target.value || "1", 10))}
                      style={{ width: 110, padding: 6, borderRadius: 8, border: "1px solid rgba(0,0,0,0.2)" }}
                    />
                    </label>
                    <label style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <span>Height (stitches)</span>
                    <input
                      type="number"
                      min={1}
                      value={draftGridH}
                      onChange={(e) => setDraftGridH(parseInt(e.target.value || "1", 10))}
                      style={{ width: 110, padding: 6, borderRadius: 8, border: "1px solid rgba(0,0,0,0.2)" }}
                    />
                    </label>
                  </>
                ) : (
                  <>
                    <label style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <span>Width (inches)</span>
                    <input
                      type="number"
                      min={0.1}
                      step={0.1}
                      value={draftWidthIn}
                      onChange={(e) => setDraftWidthIn(parseFloat(e.target.value || "0"))}
                      style={{ width: 110, padding: 6, borderRadius: 8, border: "1px solid rgba(0,0,0,0.2)" }}
                    />
                    </label>
                    <label style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <span>Height (inches)</span>
                    <input
                      type="number"
                      min={0.1}
                      step={0.1}
                      value={draftHeightIn}
                      onChange={(e) => setDraftHeightIn(parseFloat(e.target.value || "0"))}
                      style={{ width: 110, padding: 6, borderRadius: 8, border: "1px solid rgba(0,0,0,0.2)" }}
                    />
                    </label>
                    <label style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <span>Mesh (stitches/in)</span>
                    <input
                      type="number"
                      min={1}
                      value={draftMeshCount}
                      onChange={(e) => setDraftMeshCount(parseInt(e.target.value || "1", 10))}
                      style={{ width: 110, padding: 6, borderRadius: 8, border: "1px solid rgba(0,0,0,0.2)" }}
                    />
                    </label>
                  </>
                )}
                <div style={{ fontSize: 12, opacity: 0.7 }}>
                  Applying grid settings will reset the canvas and remove painted stitches.
                </div>
                <div style={{ display: "flex", justifyContent: "center", gap: 12, alignItems: "center" }}>
                  <button
                    onClick={() => {
                      applyDraftGrid();
                    }}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 10,
                      border: "1px solid var(--foreground)",
                      background: "var(--foreground)",
                      color: "var(--background)",
                      cursor: "pointer",
                    }}
                  >
                    Apply grid
                  </button>
                  <button
                    onClick={() => setConfigTab("trace")}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 10,
                      border: "1px solid var(--foreground)",
                      background: "transparent",
                      color: "var(--foreground)",
                      cursor: "pointer",
                    }}
                  >
                    {">"}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 10, width: "100%" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: "1px solid var(--foreground)",
                  background: "transparent",
                  color: "var(--foreground)",
                  cursor: "pointer",
                  width: "fit-content",
                }}
              >
                Choose file
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (traceUrlRef.current) {
                      URL.revokeObjectURL(traceUrlRef.current);
                    }
                    const url = URL.createObjectURL(file);
                    traceUrlRef.current = url;
                    setTraceImageUrl(url);
                    setTraceFileName(file.name);
                    setTraceLocked(false);
                    setTraceOpacity(0.5);
                  }}
                  style={{ display: "none" }}
                />
              </label>
              <span style={{ fontSize: 12, opacity: 0.75 }}>
                {traceFileName ?? "No file chosen"}
              </span>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  onClick={fitTraceToGrid}
                  disabled={!traceImage || traceLocked}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: "1px solid var(--foreground)",
                    background: "transparent",
                    color: "var(--foreground)",
                    cursor: "pointer",
                    opacity: !traceImage || traceLocked ? 0.5 : 1,
                  }}
                >
                  Fit to grid
                </button>
                <button
                  onClick={clearTraceImage}
                  disabled={!traceImage}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: "1px solid var(--foreground)",
                    background: "transparent",
                    color: "var(--foreground)",
                    cursor: "pointer",
                    opacity: traceImage ? 1 : 0.5,
                  }}
                >
                  Remove
                </button>
              </div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>
                Drag the image to move it. Drag the corners to resize. Clicking Apply locks the image.
              </div>
              <div style={{ fontSize: 12, opacity: 0.7, visibility: "hidden" }}>
                Applying grid settings will reset the canvas and remove painted stitches.
              </div>
              <div style={{ display: "flex", justifyContent: "center", gap: 12, alignItems: "center" }}>
                <button
                  onClick={() => setConfigTab("grid")}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 10,
                    border: "1px solid var(--foreground)",
                    background: "transparent",
                    color: "var(--foreground)",
                    cursor: "pointer",
                  }}
                >
                  {"<"}
                </button>
                <button
                  onClick={() => {
                    applyDraftGrid();
                    setTraceLocked(true);
                  }}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: "1px solid var(--foreground)",
                    background: "var(--foreground)",
                    color: "var(--background)",
                    cursor: "pointer",
                  }}
                >
                  Apply trace
                </button>
              </div>
              </div>
            ))}
          </div>

          <div style={{ border: "1px solid var(--panel-border)", borderRadius: 12, padding: 12 }}>
            <button
              onClick={() => setPaletteOpen((open) => !open)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                width: "100%",
                border: "none",
                background: "transparent",
                padding: 0,
                marginBottom: paletteOpen || !isNarrow ? 12 : 0,
                cursor: isNarrow ? "pointer" : "default",
                fontWeight: 600,
              }}
              type="button"
            >
              <span>Palette</span>
              {isNarrow && <span style={{ opacity: 0.7 }}>{paletteOpen ? "▾" : "▸"}</span>}
            </button>
            {(!isNarrow || paletteOpen) && (
              <Palette
                palette={palette}
                activeColorId={activeColorId}
                onSelect={setActiveColorId}
                remapSourceId={remapSourceId}
                onRemapSelect={(targetId) => previewRemap(targetId)}
                onAddColor={addColor}
              />
            )}
          </div>

          {isNarrow && (
            <div
              style={{
                border: "1px solid var(--panel-border)",
                borderRadius: 12,
                padding: 12,
                display: "grid",
                gap: 12,
              }}
            >
              <button
                onClick={() => setCanvasSettingsOpen((open) => !open)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                  border: "none",
                  background: "transparent",
                  padding: 0,
                  cursor: "pointer",
                  fontWeight: 600,
                }}
                type="button"
              >
                <span>Canvas Settings</span>
                <span style={{ opacity: 0.7 }}>{canvasSettingsOpen ? "▾" : "▸"}</span>
              </button>
              {canvasSettingsOpen && (
                <>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 12, opacity: 0.7 }}>Image opacity</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(traceOpacity * 100)}
                      onChange={(e) => setTraceOpacity(parseInt(e.target.value, 10) / 100)}
                      disabled={!traceImage}
                      style={{ opacity: traceImage ? 1 : 0.4, width: 120 }}
                    />
                  </label>
                  <div
                    style={{
                      display: "grid",
                      gap: 10,
                      gridTemplateColumns: isNarrow ? "repeat(2, minmax(0, 1fr))" : "1fr",
                    }}
                  >
                    <Toggle label="Show gridlines" checked={showGridlines} onChange={setShowGridlines} />
                    <Toggle label="Thread view" checked={threadView} onChange={setThreadView} />
                    <Toggle label="Dark canvas" checked={darkCanvas} onChange={setDarkCanvas} />
                    <Toggle label="Color symbols" checked={showSymbols} onChange={setShowSymbols} />
                  </div>
                </>
              )}
            </div>
          )}

          {!isNarrow && usedColorsSection}
        </div>

        <div
          style={{
            display: "flex",
            gap: 16,
            alignItems: "flex-start",
            flex: "1 1 0",
            minWidth: 0,
            width: "100%",
            flexDirection: isNarrow ? "column" : "row",
          }}
        >
          {/* Canvas area */}
          <div
            ref={canvasAreaRef}
            className="pattern-canvas-area"
            style={{
              minWidth: 0,
              flex: "1 1 0",
              width: "100%",
              maxWidth: "100%",
            }}
          >
            <CanvasWithExportRef
              exportCanvasRef={exportCanvasRef}
              title={title}
              usedColors={usedColors}
              width={gridW}
              height={gridH}
              grid={grid}
              paletteById={paletteById}
              activeColorId={activeColorId}
              cellSize={displayCellSize}
              containerWidth={containerWidth}
              containerHeight={containerHeight}
              showGridlines={showGridlines}
              tool={tool}
              onToolChange={(nextTool: "paint" | "eraser" | "eyedropper" | "lasso") => {
                setTool(nextTool);
                setPanMode(false);
              }}
              brushSize={brushSize}
              onBrushSizeChange={(value: number) => setBrushSize(value)}
              lassoPoints={lassoPoints}
              lassoClosed={lassoClosed}
              onPickColor={setActiveColorId}
              onPickColorComplete={() => {
                setTool("paint");
                setPanMode(false);
              }}
              onLassoReset={resetLasso}
              onLassoPoint={addLassoPoint}
              onLassoClose={closeLasso}
              onLassoFill={fillLasso}
              onStrokeStart={beginStroke}
              onStrokeEnd={endStroke}
              onPaintCell={onPaintCell}
              onFillCells={onFillCells}
              onFillGrid={onFillGrid}
              threadView={threadView}
              onTogglePanMode={() => setPanMode((value) => !value)}
              traceImage={traceImage}
              traceOpacity={traceOpacity}
              traceScale={traceScale}
              traceOffsetX={traceOffsetX}
              traceOffsetY={traceOffsetY}
              traceAdjustMode={!traceLocked}
              onTraceOffsetChange={(x: React.SetStateAction<number>, y: React.SetStateAction<number>) => {
                setTraceOffsetX(x);
                setTraceOffsetY(y);
              }}
              onTraceScaleChange={(value: number) => setTraceScale(value)}
              panMode={panMode}
              onUndo={undo}
              onRedo={redo}
              onClear={clearGrid}
              canUndo={history.length > 0}
              canRedo={future.length > 0}
              zoom={zoom}
              minZoom={minZoom}
              maxZoom={maxZoom}
              pinchEnabled={isNarrow}
              onZoomChange={(next: number) => setZoom(clampZoom(next))}
              darkCanvas={darkCanvas}
              onControlsHeightChange={setCanvasControlsHeight}
              showSymbols={showSymbols}
            />
            {isNarrow && <div style={{ marginTop: 16 }}>{usedColorsSection}</div>}
          </div>
          {!isNarrow && (
            <div
              style={{
                border: "1px solid var(--panel-border)",
                borderRadius: 12,
                padding: 12,
                width: "fit-content",
                minWidth: 140,
                flex: "0 0 auto",
                marginTop: canvasControlsHeight > 0 ? canvasControlsHeight + 10 : 0,
                display: "grid",
                gap: 12,
              }}
            >
              <button
                onClick={() => setCanvasSettingsOpen((open) => !open)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                  border: "none",
                  background: "transparent",
                  padding: 0,
                  cursor: "pointer",
                  fontWeight: 600,
                }}
                type="button"
              >
                <span>Canvas Settings</span>
                <span style={{ opacity: 0.7 }}>{canvasSettingsOpen ? "▾" : "▸"}</span>
              </button>
              {canvasSettingsOpen && (
                <>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 12, opacity: 0.7 }}>Image opacity</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(traceOpacity * 100)}
                      onChange={(e) => setTraceOpacity(parseInt(e.target.value, 10) / 100)}
                      disabled={!traceImage}
                      style={{ opacity: traceImage ? 1 : 0.4, width: 120 }}
                    />
                  </label>
                  <div style={{ display: "grid", gap: 10 }}>
                    <Toggle label="Show gridlines" checked={showGridlines} onChange={setShowGridlines} />
                    <Toggle label="Thread view" checked={threadView} onChange={setThreadView} />
                    <Toggle label="Dark canvas" checked={darkCanvas} onChange={setDarkCanvas} />
                    <Toggle label="Color symbols" checked={showSymbols} onChange={setShowSymbols} />
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      {isNarrow && (
        <div style={{ display: "flex", justifyContent: "center", marginTop: -8 }}>
          <ExportPdfButton
            title={title}
            canvasRef={exportCanvasRef}
            usedColors={usedColors}
            grid={grid}
            paletteById={paletteById}
            width={gridW}
            height={gridH}
            cellSize={EXPORT_CELL_SIZE}
          />
        </div>
      )}
    </div>
  );
}

// Helper wrapper to grab the underlying canvas for PDF export.
// For the MVP, we simply render a second hidden canvas for export using the same drawing logic.
// Later: refactor GridCanvas to forwardRef and use the same canvas.
function CanvasWithExportRef(props: any) {
  const {
    exportCanvasRef,
    title,
    usedColors,
    width,
    height,
    grid,
    paletteById,
    activeColorId,
    cellSize,
    containerWidth,
    containerHeight,
    showGridlines,
    tool,
    brushSize,
    onBrushSizeChange,
    onToolChange,
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
    threadView,
    onTogglePanMode,
    traceImage,
    traceOpacity,
    traceScale,
    traceOffsetX,
    traceOffsetY,
    traceAdjustMode,
    onTraceScaleChange,
    onTraceOffsetChange,
    panMode,
    onUndo,
    onRedo,
    onClear,
    canUndo,
    canRedo,
    zoom,
    minZoom,
    maxZoom,
    pinchEnabled,
    onZoomChange,
    darkCanvas,
    onControlsHeightChange,
    showSymbols,
  } = props;

  // Render the interactive canvas
  // And a hidden export canvas at a higher resolution (fixed cell size) for clean PDFs
  const exportCellSize = EXPORT_CELL_SIZE;
  const zoomPercent = Math.round(zoom * 100);
  const [zoomInput, setZoomInput] = useState(String(zoomPercent));

  useEffect(() => {
    setZoomInput(String(zoomPercent));
  }, [zoomPercent]);

  function commitZoomInput(value: string) {
    if (value.trim() === "") {
      setZoomInput(String(zoomPercent));
      return;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      setZoomInput(String(zoomPercent));
      return;
    }
    const minValue = Math.round(minZoom * 100);
    const maxValue = Math.round(maxZoom * 100);
    const clamped = Math.min(maxValue, Math.max(minValue, parsed));
    onZoomChange(clamped / 100);
    setZoomInput(String(Math.round(clamped)));
  }

  const controlsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!controlsRef.current || !onControlsHeightChange) return;
    const node = controlsRef.current;
    const notify = () => {
      onControlsHeightChange(Math.round(node.getBoundingClientRect().height));
    };
    notify();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => notify());
    observer.observe(node);
    return () => observer.disconnect();
  }, [onControlsHeightChange]);

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div ref={controlsRef} style={{ display: "grid", gap: 10 }}>
        {pinchEnabled && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, opacity: 0.7 }}>Tool size</span>
            <input
              type="range"
              min={1}
              max={12}
              step={1}
              value={brushSize}
              onChange={(e) => onBrushSizeChange(parseInt(e.target.value, 10))}
            />
            <span style={{ fontSize: 12, opacity: 0.7 }}>{brushSize}</span>
          </div>
        )}
        <div
          className="canvas-toolbar"
          style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
        >
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 12, opacity: 0.7 }}>Tool</span>
            <button
              onClick={onTogglePanMode}
              aria-pressed={panMode}
              aria-label="Pan"
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid var(--foreground)",
                background: panMode ? "var(--foreground)" : "transparent",
                color: panMode ? "var(--background)" : "var(--foreground)",
                cursor: "pointer",
              }}
            >
              <img
                src="/pan.svg"
                alt=""
                aria-hidden="true"
                width={18}
                height={18}
                style={{ display: "block", filter: panMode ? "var(--icon-on-fg-filter)" : "var(--icon-on-bg-filter)" }}
              />
            </button>
          {(["paint", "eraser", "eyedropper", "lasso"] as const).map((t) => (
            <button
              key={t}
              onClick={() => onToolChange(t)}
              aria-label={
                t === "paint"
                  ? "Brush"
                  : t === "eraser"
                    ? "Eraser"
                    : t === "eyedropper"
                      ? "Eyedropper"
                      : "Lasso"
              }
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                  border: "1px solid var(--foreground)",
                  background: tool === t && !panMode ? "var(--foreground)" : "transparent",
                  color: tool === t && !panMode ? "var(--background)" : "var(--foreground)",
                  cursor: "pointer",
                }}
            >
              <img
                src={
                  t === "paint"
                    ? "/brush.svg"
                    : t === "eraser"
                      ? "/eraser.svg"
                      : t === "eyedropper"
                        ? "/dropper.svg"
                        : "/lasso.svg"
                }
                alt=""
                aria-hidden="true"
                width={18}
                height={18}
                style={{
                  display: "block",
                  filter: tool === t && !panMode ? "var(--icon-on-fg-filter)" : "var(--icon-on-bg-filter)",
                }}
              />
            </button>
          ))}
            <button
              onClick={onUndo}
              disabled={!canUndo}
              aria-label="Undo"
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid var(--foreground)",
                background: "transparent",
                color: "var(--foreground)",
                cursor: "pointer",
                opacity: canUndo ? 1 : 0.5,
              }}
            >
              <img
                src="/undo.svg"
                alt=""
                aria-hidden="true"
                width={18}
                height={18}
                style={{ display: "block", filter: "var(--icon-on-bg-filter)" }}
              />
            </button>
            <button
              onClick={onRedo}
              disabled={!canRedo}
              aria-label="Redo"
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid var(--foreground)",
                background: "transparent",
                color: "var(--foreground)",
                cursor: "pointer",
                opacity: canRedo ? 1 : 0.5,
              }}
            >
              <img
                src="/redo.svg"
                alt=""
                aria-hidden="true"
                width={18}
                height={18}
                style={{ display: "block", filter: "var(--icon-on-bg-filter)" }}
              />
            </button>
            <button
              onClick={onClear}
              aria-label="Clear"
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid var(--foreground)",
                background: "transparent",
                color: "var(--foreground)",
                cursor: "pointer",
              }}
            >
              <img
                src="/trash.svg"
                alt=""
                aria-hidden="true"
                width={18}
                height={18}
                style={{ display: "block", filter: "var(--icon-on-bg-filter)" }}
              />
            </button>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {!pinchEnabled && (
            <>
              <span style={{ fontSize: 12, opacity: 0.7 }}>Tool size</span>
              <input
                type="range"
                min={1}
                max={12}
                step={1}
                value={brushSize}
                onChange={(e) => onBrushSizeChange(parseInt(e.target.value, 10))}
              />
              <span style={{ fontSize: 12, opacity: 0.7 }}>{brushSize}</span>
            </>
          )}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              marginLeft: pinchEnabled ? 0 : "auto",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <label className="zoom-row" style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button
                  onClick={() => onZoomChange(Math.max(minZoom, Number((zoom - 0.1).toFixed(2))))}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: "1px solid var(--foreground)",
                    background: "transparent",
                    color: "var(--foreground)",
                    cursor: "pointer",
                  }}
                >
                  -
                </button>
                <input
                  type="range"
                  min={Math.round(minZoom * 100)}
                  max={Math.round(maxZoom * 100)}
                  value={Math.round(zoom * 100)}
                  onChange={(e) => onZoomChange(parseInt(e.target.value, 10) / 100)}
                />
                <button
                  onClick={() => onZoomChange(Math.min(maxZoom, Number((zoom + 0.1).toFixed(2))))}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: "1px solid var(--foreground)",
                    background: "transparent",
                    color: "var(--foreground)",
                    cursor: "pointer",
                  }}
                >
                  +
                </button>
                <input
                  type="text"
                  inputMode="numeric"
                  value={zoomInput}
                  onChange={(e) => {
                    const next = e.target.value.replace(/[^\d]/g, "");
                    setZoomInput(next);
                  }}
                  onBlur={(e) => commitZoomInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      commitZoomInput((e.target as HTMLInputElement).value);
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  style={{ width: 64, padding: 6, borderRadius: 8, border: "1px solid rgba(0,0,0,0.2)" }}
                />
                <span style={{ fontSize: 12, opacity: 0.7 }}>%</span>
              </div>
            </label>
          </div>
        </div>
      </div>

      <GridCanvas
        width={width}
        height={height}
        grid={grid}
        paletteById={paletteById}
        activeColorId={activeColorId}
        cellSize={cellSize}
        containerWidth={containerWidth}
        containerHeight={containerHeight}
        showGridlines={showGridlines}
        tool={tool}
        brushSize={brushSize}
        lassoPoints={lassoPoints}
        lassoClosed={lassoClosed}
        onPickColor={onPickColor}
        onPickColorComplete={onPickColorComplete}
        onLassoReset={onLassoReset}
        onLassoPoint={onLassoPoint}
        onLassoClose={onLassoClose}
        onLassoFill={onLassoFill}
        onStrokeStart={onStrokeStart}
        onStrokeEnd={onStrokeEnd}
        onPaintCell={onPaintCell}
        threadView={threadView}
        darkCanvas={darkCanvas}
        panMode={panMode}
        showSymbols={showSymbols}
        traceImage={traceImage}
        traceOpacity={traceOpacity}
        traceScale={traceScale}
        traceOffsetX={traceOffsetX}
        traceOffsetY={traceOffsetY}
        traceAdjustMode={traceAdjustMode}
        onTraceOffsetChange={onTraceOffsetChange}
        onTraceScaleChange={onTraceScaleChange}
        zoom={zoom}
        minZoom={minZoom}
        maxZoom={maxZoom}
        pinchEnabled={pinchEnabled}
        onZoomChange={onZoomChange}
      />

      {/* Hidden high-res canvas for export */}
      <div style={{ position: "absolute", left: -10000, top: -10000 }}>
        <ExportCanvas
          exportCanvasRef={exportCanvasRef}
          width={width}
          height={height}
          grid={grid}
          paletteById={paletteById}
          cellSize={exportCellSize}
          showGridlines={true}
        />
      </div>
    </div>
  );
}

function ExportCanvas({
  exportCanvasRef,
  width,
  height,
  grid,
  paletteById,
  cellSize,
  showGridlines,
}: {
  exportCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  width: number;
  height: number;
  grid: Uint16Array;
  paletteById: Map<number, Color>;
  cellSize: number;
  showGridlines: boolean;
}) {
  function contrastForHex(hex: string) {
    const clean = hex.replace("#", "");
    if (clean.length !== 6) return "#000000";
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return luminance > 0.6 ? "#000000" : "#ffffff";
  }
  const canvasW = width * cellSize;
  const canvasH = height * cellSize;

  React.useEffect(() => {
    const canvas = exportCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // No DPR scaling for export canvas: keep deterministic sizing
    canvas.width = canvasW;
    canvas.height = canvasH;

    ctx.clearRect(0, 0, canvasW, canvasH);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const colorId = grid[idx(x, y, width)];
        if (colorId === 0) continue;
        const color = paletteById.get(colorId);
        if (!color) continue;
        ctx.fillStyle = color.hex;
        ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);

        const symbol = symbolForColorId(color.id);
        if (symbol) {
          ctx.save();
          ctx.fillStyle = contrastForHex(color.hex);
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.font = `${Math.max(8, Math.floor(cellSize * 0.6))}px ui-sans-serif, system-ui, sans-serif`;
          ctx.fillText(symbol, x * cellSize + cellSize / 2, y * cellSize + cellSize / 2 + 0.5);
          ctx.restore();
        }
      }
    }

    if (showGridlines) {
      ctx.strokeStyle = "rgba(0,0,0,0.18)";
      ctx.lineWidth = 1;
      for (let x = 0; x <= width; x++) {
        ctx.beginPath();
        ctx.moveTo(x * cellSize + 0.5, 0);
        ctx.lineTo(x * cellSize + 0.5, canvasH);
        ctx.stroke();
      }
      for (let y = 0; y <= height; y++) {
        ctx.beginPath();
        ctx.moveTo(0, y * cellSize + 0.5);
        ctx.lineTo(canvasW, y * cellSize + 0.5);
        ctx.stroke();
      }
    }
  }, [exportCanvasRef, canvasW, canvasH, width, height, grid, paletteById, cellSize, showGridlines]);

  return <canvas ref={exportCanvasRef} />;
}
