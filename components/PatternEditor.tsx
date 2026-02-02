"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import GridCanvas from "./GridCanvas";
import Palette from "./Palette";
import ExportPdfButton from "./ExportPdfButton";
import type { Color } from "../lib/grid";
import { idx, makeGrid } from "../lib/grid";
import { DMC_COLORS } from "../lib/dmcColors";
import { SYMBOLS, symbolForColorId } from "../lib/symbols";
import { assetPath } from "../lib/assetPath";

const DEFAULT_PALETTE: Color[] = DMC_COLORS;
const EXPORT_CELL_SIZE = 24;

type Point = { x: number; y: number };
type FilterRect = { x0: number; y0: number; x1: number; y1: number };

function clampFilterRect(rect: FilterRect, width: number, height: number): FilterRect {
  const x0 = Math.max(0, Math.min(width - 1, rect.x0));
  const y0 = Math.max(0, Math.min(height - 1, rect.y0));
  const x1 = Math.max(0, Math.min(width - 1, rect.x1));
  const y1 = Math.max(0, Math.min(height - 1, rect.y1));
  return {
    x0: Math.min(x0, x1),
    y0: Math.min(y0, y1),
    x1: Math.max(x0, x1),
    y1: Math.max(y0, y1),
  };
}

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

type LabSamples = { values: Float32Array; count: number };

function contrastForHex(hex: string) {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return "#000000";
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.6 ? "#000000" : "#ffffff";
}

function srgbToLinear(value: number) {
  return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

function linearToSrgb(value: number) {
  return value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
}

function rgbToOklab(r: number, g: number, b: number) {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return {
    L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    A: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    B: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  };
}

function oklabToRgb(L: number, A: number, B: number) {
  const l_ = L + 0.3963377774 * A + 0.2158037573 * B;
  const m_ = L - 0.1055613458 * A - 0.0638541728 * B;
  const s_ = L - 0.0894841775 * A - 1.291485548 * B;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  const lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return { r: linearToSrgb(lr), g: linearToSrgb(lg), b: linearToSrgb(lb) };
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function rgbToHex(r: number, g: number, b: number) {
  const toHex = (value: number) => Math.round(clamp01(value) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function sampleTraceImageOklab(image: HTMLImageElement, maxSamples: number): LabSamples {
  const width = image.width;
  const height = image.height;
  if (width <= 0 || height <= 0) return { values: new Float32Array(0), count: 0 };
  const total = width * height;
  const scale = total > maxSamples ? Math.sqrt(maxSamples / total) : 1;
  const sampleW = Math.max(1, Math.round(width * scale));
  const sampleH = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = sampleW;
  canvas.height = sampleH;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { values: new Float32Array(0), count: 0 };
  ctx.drawImage(image, 0, 0, sampleW, sampleH);
  const data = ctx.getImageData(0, 0, sampleW, sampleH).data;
  const values = new Float32Array(sampleW * sampleH * 3);
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 16) continue;
    const { L, A, B } = rgbToOklab(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);
    const offset = count * 3;
    values[offset] = L;
    values[offset + 1] = A;
    values[offset + 2] = B;
    count += 1;
  }
  return { values, count };
}

function kMeansOklab(samples: LabSamples, k: number, iterations = 8) {
  const count = samples.count;
  const values = samples.values;
  if (count === 0 || k <= 0) {
    return { centers: new Float32Array(0), counts: new Int32Array(0) };
  }
  const centers = new Float32Array(k * 3);
  const counts = new Int32Array(k);
  const nearestDist = new Float32Array(count);

  let meanL = 0;
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < count; i++) {
    meanL += values[i * 3];
    meanA += values[i * 3 + 1];
    meanB += values[i * 3 + 2];
  }
  meanL /= count;
  meanA /= count;
  meanB /= count;
  let first = 0;
  let maxDist = -1;
  for (let i = 0; i < count; i++) {
    const dx = values[i * 3] - meanL;
    const dy = values[i * 3 + 1] - meanA;
    const dz = values[i * 3 + 2] - meanB;
    const dist = dx * dx + dy * dy + dz * dz;
    if (dist > maxDist) {
      maxDist = dist;
      first = i;
    }
  }
  centers[0] = values[first * 3];
  centers[1] = values[first * 3 + 1];
  centers[2] = values[first * 3 + 2];
  for (let i = 0; i < count; i++) {
    const dx = values[i * 3] - centers[0];
    const dy = values[i * 3 + 1] - centers[1];
    const dz = values[i * 3 + 2] - centers[2];
    nearestDist[i] = dx * dx + dy * dy + dz * dz;
  }

  for (let c = 1; c < k; c++) {
    let farthest = 0;
    let farthestDist = -1;
    for (let i = 0; i < count; i++) {
      const dist = nearestDist[i];
      if (dist > farthestDist) {
        farthestDist = dist;
        farthest = i;
      }
    }
    const base = c * 3;
    centers[base] = values[farthest * 3];
    centers[base + 1] = values[farthest * 3 + 1];
    centers[base + 2] = values[farthest * 3 + 2];
    for (let i = 0; i < count; i++) {
      const dx = values[i * 3] - centers[base];
      const dy = values[i * 3 + 1] - centers[base + 1];
      const dz = values[i * 3 + 2] - centers[base + 2];
      const dist = dx * dx + dy * dy + dz * dz;
      if (dist < nearestDist[i]) nearestDist[i] = dist;
    }
  }

  const sums = new Float32Array(k * 3);

  for (let iter = 0; iter < iterations; iter++) {
    counts.fill(0);
    sums.fill(0);
    for (let i = 0; i < count; i++) {
      let best = 0;
      let bestDist = Number.POSITIVE_INFINITY;
      const px = values[i * 3];
      const py = values[i * 3 + 1];
      const pz = values[i * 3 + 2];
      for (let c = 0; c < k; c++) {
        const base = c * 3;
        const dx = px - centers[base];
        const dy = py - centers[base + 1];
        const dz = pz - centers[base + 2];
        const dist = dx * dx + dy * dy + dz * dz;
        if (dist < bestDist) {
          bestDist = dist;
          best = c;
        }
      }
      counts[best] += 1;
      const sumBase = best * 3;
      sums[sumBase] += px;
      sums[sumBase + 1] += py;
      sums[sumBase + 2] += pz;
    }
    for (let c = 0; c < k; c++) {
      const countC = counts[c];
      const base = c * 3;
      if (countC > 0) {
        centers[base] = sums[base] / countC;
        centers[base + 1] = sums[base + 1] / countC;
        centers[base + 2] = sums[base + 2] / countC;
      } else {
        let farthest = 0;
        let farthestDist = -1;
        for (let i = 0; i < count; i++) {
          let bestDist = Number.POSITIVE_INFINITY;
          const px = values[i * 3];
          const py = values[i * 3 + 1];
          const pz = values[i * 3 + 2];
          for (let s = 0; s < k; s++) {
            const sBase = s * 3;
            const dx = px - centers[sBase];
            const dy = py - centers[sBase + 1];
            const dz = pz - centers[sBase + 2];
            const dist = dx * dx + dy * dy + dz * dz;
            if (dist < bestDist) bestDist = dist;
          }
          if (bestDist > farthestDist) {
            farthestDist = bestDist;
            farthest = i;
          }
        }
        centers[base] = values[farthest * 3];
        centers[base + 1] = values[farthest * 3 + 1];
        centers[base + 2] = values[farthest * 3 + 2];
      }
    }
  }

  return { centers, counts };
}

function selectDiverseClusters(centers: Float32Array, counts: Int32Array, targetCount: number) {
  const k = counts.length;
  const available: number[] = [];
  let maxCount = 0;
  for (let c = 0; c < k; c++) {
    const count = counts[c];
    if (count > 0) {
      available.push(c);
      if (count > maxCount) maxCount = count;
    }
  }
  if (available.length <= targetCount) return available;
  let bestIndex = available[0];
  for (const idx of available) {
    if (counts[idx] > counts[bestIndex]) bestIndex = idx;
  }
  const selected = [bestIndex];
  const selectedSet = new Set<number>(selected);
  const distanceWeight = 1.8;
  const importanceWeight = 0.6;
  const rarityBoost = 1.2;
  const hueWeight = 0.6;
  const chromaWeight = 0.5;
  const hueBins = 12;

  const chromaByIndex = new Float32Array(k);
  const hueByIndex = new Float32Array(k);
  for (let i = 0; i < k; i++) {
    const base = i * 3;
    const a = centers[base + 1];
    const b = centers[base + 2];
    const chroma = Math.sqrt(a * a + b * b);
    chromaByIndex[i] = chroma;
    let hue = Math.atan2(b, a);
    if (hue < 0) hue += Math.PI * 2;
    hueByIndex[i] = hue;
  }
  const hueBinCounts = new Int32Array(hueBins);
  const startHue = hueByIndex[bestIndex];
  const startBin = Math.min(hueBins - 1, Math.floor((startHue / (Math.PI * 2)) * hueBins));
  hueBinCounts[startBin] += 1;

  while (selected.length < targetCount) {
    let nextIndex = -1;
    let bestScore = -1;
    for (const idx of available) {
      if (selectedSet.has(idx)) continue;
      const importance = Math.log1p(counts[idx]) / Math.log1p(maxCount);
      const base = idx * 3;
      let minDist = Number.POSITIVE_INFINITY;
      let minHueDist = Number.POSITIVE_INFINITY;
      for (const sel of selected) {
        const selBase = sel * 3;
        const dx = centers[base] - centers[selBase];
        const dy = centers[base + 1] - centers[selBase + 1];
        const dz = centers[base + 2] - centers[selBase + 2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < minDist) minDist = dist;
        const hueA = hueByIndex[idx];
        const hueB = hueByIndex[sel];
        const diff = Math.abs(hueA - hueB);
        const hueDist = Math.min(diff, Math.PI * 2 - diff);
        if (hueDist < minHueDist) minHueDist = hueDist;
      }
      const chroma = chromaByIndex[idx];
      const chromaFactor = chroma / (chroma + 0.05);
      const hueScore = hueWeight * minHueDist * chromaFactor;
      const bin = Math.min(hueBins - 1, Math.floor((hueByIndex[idx] / (Math.PI * 2)) * hueBins));
      const binPenalty = 1 / (1 + hueBinCounts[bin] * 0.8);
      const score =
        (importanceWeight * importance +
          distanceWeight * minDist +
          rarityBoost * (1 - importance) * minDist +
          hueScore +
          chromaWeight * chroma * (1 - importance)) *
        binPenalty;
      if (score > bestScore) {
        bestScore = score;
        nextIndex = idx;
      }
    }
    if (nextIndex === -1) break;
    selected.push(nextIndex);
    selectedSet.add(nextIndex);
    const hue = hueByIndex[nextIndex];
    const bin = Math.min(hueBins - 1, Math.floor((hue / (Math.PI * 2)) * hueBins));
    hueBinCounts[bin] += 1;
  }
  return selected;
}

  function extractPaletteFromImage(image: HTMLImageElement, maxColors: number) {
  const maxSamples = 40000;
  const samples = sampleTraceImageOklab(image, maxSamples);
  if (samples.count === 0) return [];
  const target = Math.max(2, Math.min(maxColors, samples.count));
  const overCluster = Math.min(samples.count, Math.max(target * 5, Math.round(target * 6)));
  const { centers, counts } = kMeansOklab(samples, overCluster, 8);
  const selected = selectDiverseClusters(centers, counts, target);
  const seen = new Set<string>();
  const palette: string[] = [];
  for (const idx of selected) {
    const base = idx * 3;
    const rgb = oklabToRgb(centers[base], centers[base + 1], centers[base + 2]);
    const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
    if (seen.has(hex)) continue;
    seen.add(hex);
    palette.push(hex);
    if (palette.length >= target) break;
  }
  if (palette.length < target) {
    const order = Array.from({ length: counts.length }, (_, i) => i).sort((a, b) => counts[b] - counts[a]);
    for (const idx of order) {
      const base = idx * 3;
      const rgb = oklabToRgb(centers[base], centers[base + 1], centers[base + 2]);
      const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
      if (seen.has(hex)) continue;
      seen.add(hex);
      palette.push(hex);
      if (palette.length >= target) break;
    }
  }
  return palette;
}

export default function PatternEditor() {
  const [title, setTitle] = useState("Untitled Pattern");
  const [isNarrow, setIsNarrow] = useState(false);
  const [isCompact, setIsCompact] = useState(false);

  const [gridW, setGridW] = useState(112);
  const [gridH, setGridH] = useState(140);
  type Snapshot = { gridW: number; gridH: number; grid: Uint16Array };
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);
  const historyRef = useRef<Snapshot[]>([]);
  const futureRef = useRef<Snapshot[]>([]);
  const [tool, setTool] = useState<"paint" | "eraser" | "fill" | "eyedropper" | "lasso">("paint");
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
  const [filterMode, setFilterMode] = useState(false);
  const [filterRect, setFilterRect] = useState<FilterRect | null>(null);
  const [filterSelecting, setFilterSelecting] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmLabel?: string;
    position?: { top: number; left: number } | null;
  } | null>(null);
  const [gridOpen, setGridOpen] = useState(true);
  const [traceOpen, setTraceOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [canvasSettingsOpen, setCanvasSettingsOpen] = useState(true);
  const [usedColorsOpen, setUsedColorsOpen] = useState(true);
  const [imageToPatternOpen, setImageToPatternOpen] = useState(false);
  const [traceImageUrl, setTraceImageUrl] = useState<string | null>(null);
  const [traceFileName, setTraceFileName] = useState<string | null>(null);
  const [traceImage, setTraceImage] = useState<HTMLImageElement | null>(null);
  const [traceOpacity, setTraceOpacity] = useState(0.6);
  const [traceScale, setTraceScale] = useState(1);
  const [traceOffsetX, setTraceOffsetX] = useState(0);
  const [traceOffsetY, setTraceOffsetY] = useState(0);
  const [traceLocked, setTraceLocked] = useState(false);
  const [panMode, setPanMode] = useState(false);
  const traceUrlRef = useRef<string | null>(null);
  const strokeActiveRef = useRef(false);
  const strokeDirtyRef = useRef(false);
  const strokeSnapshotRef = useRef<Snapshot | null>(null);
  const strokePendingCommitRef = useRef(false);
  const strokeVersionRef = useRef(0);
  const gridRef = useRef<Uint16Array | null>(null);
  const traceSampleCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [palette, setPalette] = useState<Color[]>(DEFAULT_PALETTE);
  const [extractedPaletteIds, setExtractedPaletteIds] = useState<number[]>([]);
  const paletteById = useMemo(() => new Map(palette.map((c) => [c.id, c])), [palette]);
  const extractedIds = useMemo(
    () => extractedPaletteIds.filter((id) => paletteById.has(id)),
    [extractedPaletteIds, paletteById]
  );

  const [activeColorId, setActiveColorId] = useState<number>(DEFAULT_PALETTE[3].id);
  const [extractPaletteSize, setExtractPaletteSize] = useState(12);
  const [extractingPalette, setExtractingPalette] = useState(false);
  const [extractPaletteOpen, setExtractPaletteOpen] = useState(false);
  const [convertMaxColors, setConvertMaxColors] = useState(20);
  const [convertSmoothing, setConvertSmoothing] = useState(0.25);
  const [remapMode, setRemapMode] = useState(false);
  const [remapSourceId, setRemapSourceId] = useState<number | null>(null);
  const [remapTargetId, setRemapTargetId] = useState<number | null>(null);
  const [identifyColorId, setIdentifyColorId] = useState<number | null>(null);
  const [mergeMode, setMergeMode] = useState(false);
  const [mergeSelectedIds, setMergeSelectedIds] = useState<number[]>([]);
  const [mergeTargetId, setMergeTargetId] = useState<number | null>(null);
  const [deleteMode, setDeleteMode] = useState(false);
  const [deleteSelectedIds, setDeleteSelectedIds] = useState<number[]>([]);
  const draftInputRef = useRef<HTMLInputElement | null>(null);
  const clearButtonRef = useRef<HTMLButtonElement | null>(null);
  const confirmActionRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (isNarrow) {
      // setCanvasSettingsOpen(false);
      // setPaletteOpen(false);
    }
  }, [isNarrow]);
  const remapOriginalRef = useRef<Uint16Array | null>(null);
  const mergeOriginalRef = useRef<Uint16Array | null>(null);
  const deleteOriginalRef = useRef<Uint16Array | null>(null);

  const [zoom, setZoom] = useState(1);
  const [canvasControlsHeight, setCanvasControlsHeight] = useState(0);
  const minZoom = 0.25;
  const maxZoom = isNarrow ? 12 : 8;
  const [showGridlines, setShowGridlines] = useState(true);
  const [lastEditCell, setLastEditCell] = useState<{ x: number; y: number } | null>(null);
  const [jumpToLastEditTick, setJumpToLastEditTick] = useState(0);

  const [grid, setGrid] = useState<Uint16Array>(() => makeGrid(gridW, gridH, 0));
  const canvasAreaRef = useRef<HTMLDivElement | null>(null);
  const [canvasAreaWidth, setCanvasAreaWidth] = useState(0);

  useEffect(() => {
    gridRef.current = grid;
  }, [grid]);

  useEffect(() => {
    if (!filterMode && filterSelecting) {
      setFilterSelecting(false);
    }
  }, [filterMode, filterSelecting]);

  useEffect(() => {
    if (!filterRect) return;
    if (gridW <= 0 || gridH <= 0) return;
    const clamped = clampFilterRect(filterRect, gridW, gridH);
    if (
      clamped.x0 !== filterRect.x0 ||
      clamped.y0 !== filterRect.y0 ||
      clamped.x1 !== filterRect.x1 ||
      clamped.y1 !== filterRect.y1
    ) {
      setFilterRect(clamped);
    }
  }, [filterRect, gridW, gridH]);

  const activeFilterRect = useMemo(() => {
    if (!filterMode || !filterRect) return null;
    return clampFilterRect(filterRect, gridW, gridH);
  }, [filterMode, filterRect, gridW, gridH]);
  const isCellInFilter = (x: number, y: number) =>
    !activeFilterRect ||
    (x >= activeFilterRect.x0 &&
      x <= activeFilterRect.x1 &&
      y >= activeFilterRect.y0 &&
      y <= activeFilterRect.y1);
  const isIndexInFilter = (cellIdx: number) => {
    if (!activeFilterRect) return true;
    const x = cellIdx % gridW;
    const y = Math.floor(cellIdx / gridW);
    return (
      x >= activeFilterRect.x0 &&
      x <= activeFilterRect.x1 &&
      y >= activeFilterRect.y0 &&
      y <= activeFilterRect.y1
    );
  };

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

  const sidebarWidth = 210;
  const canvasCardPadding = 12;
  const canvasInnerWidth = Math.max(1, canvasAreaWidth - canvasCardPadding * 2);

  const fitCellSize = useMemo(() => {
    if (canvasInnerWidth <= 0) return 1;
    return Math.max(1, canvasInnerWidth / gridW);
  }, [canvasInnerWidth, gridW]);

  const prevFitCellSizeRef = useRef(fitCellSize);

  const displayCellSize = useMemo(() => {
    return Math.max(1, Number((fitCellSize * zoom).toFixed(2)));
  }, [fitCellSize, zoom]);

  const containerWidth = Math.max(1, canvasInnerWidth);
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

  function convertImageToPattern() {
    if (!traceImage) return;
    if (!Number.isFinite(fitCellSize) || fitCellSize <= 0) return;
    if (!Number.isFinite(traceScale) || traceScale <= 0) return;

    const canvas = traceSampleCanvasRef.current ?? document.createElement("canvas");
    traceSampleCanvasRef.current = canvas;
    if (canvas.width !== traceImage.width || canvas.height !== traceImage.height) {
      canvas.width = traceImage.width;
      canvas.height = traceImage.height;
    }
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(traceImage, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    const paletteLabs = palette
      .map((color) => {
        const clean = color.hex.replace("#", "");
        if (clean.length !== 6) return null;
        const r = parseInt(clean.slice(0, 2), 16) / 255;
        const g = parseInt(clean.slice(2, 4), 16) / 255;
        const b = parseInt(clean.slice(4, 6), 16) / 255;
        if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
        const lab = rgbToOklab(r, g, b);
        return { id: color.id, L: lab.L, A: lab.A, B: lab.B };
      })
      .filter((entry): entry is { id: number; L: number; A: number; B: number } => Boolean(entry));
    if (paletteLabs.length === 0) return;

    let allowedPalette = paletteLabs;
    const maxColors = Math.max(2, Math.min(convertMaxColors, paletteLabs.length));
    if (maxColors < paletteLabs.length) {
      const hexes = extractPaletteFromImage(traceImage, maxColors);
      const picked: number[] = [];
      const seen = new Set<number>();
      for (const hex of hexes) {
        const clean = hex.replace("#", "");
        if (clean.length !== 6) continue;
        const r = parseInt(clean.slice(0, 2), 16) / 255;
        const g = parseInt(clean.slice(2, 4), 16) / 255;
        const b = parseInt(clean.slice(4, 6), 16) / 255;
        if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) continue;
        const lab = rgbToOklab(r, g, b);
        let bestId: number | null = null;
        let bestDist = Number.POSITIVE_INFINITY;
        for (const candidate of paletteLabs) {
          if (seen.has(candidate.id)) continue;
          const dx = lab.L - candidate.L;
          const dy = lab.A - candidate.A;
          const dz = lab.B - candidate.B;
          const dist = dx * dx + dy * dy + dz * dz;
          if (dist < bestDist) {
            bestDist = dist;
            bestId = candidate.id;
          }
        }
        if (bestId == null) continue;
        seen.add(bestId);
        picked.push(bestId);
      }
      if (picked.length > 0) {
        const allowed = new Set(picked);
        const subset = paletteLabs.filter((entry) => allowed.has(entry.id));
        if (subset.length > 0) {
          allowedPalette = subset;
        }
      }
    }

    const imgW = canvas.width;
    const imgH = canvas.height;
    const cellCount = gridW * gridH;
    const rawR = new Float32Array(cellCount);
    const rawG = new Float32Array(cellCount);
    const rawB = new Float32Array(cellCount);
    const rawLabL = new Float32Array(cellCount);
    const rawLabA = new Float32Array(cellCount);
    const rawLabB = new Float32Array(cellCount);
    const mask = new Uint8Array(cellCount);

    for (let y = 0; y < gridH; y++) {
      const centerY = (y + 0.5) * fitCellSize;
      const imgY = (centerY - traceOffsetY) / traceScale;
      if (imgY < 0 || imgY >= imgH) continue;
      const iy = Math.floor(imgY);
      const rowOffset = iy * imgW * 4;
      for (let x = 0; x < gridW; x++) {
        const centerX = (x + 0.5) * fitCellSize;
        const imgX = (centerX - traceOffsetX) / traceScale;
        if (imgX < 0 || imgX >= imgW) continue;
        const ix = Math.floor(imgX);
        const idx4 = rowOffset + ix * 4;
        const alpha = data[idx4 + 3];
        if (alpha < 10) continue;
        const r = data[idx4] / 255;
        const g = data[idx4 + 1] / 255;
        const b = data[idx4 + 2] / 255;
        const lab = rgbToOklab(r, g, b);
        const cellIdx = idx(x, y, gridW);
        mask[cellIdx] = 1;
        rawR[cellIdx] = r;
        rawG[cellIdx] = g;
        rawB[cellIdx] = b;
        rawLabL[cellIdx] = lab.L;
        rawLabA[cellIdx] = lab.A;
        rawLabB[cellIdx] = lab.B;
      }
    }

    const smoothStrength = clamp01(convertSmoothing);
    const radius = smoothStrength > 0.66 ? 2 : 1;
    const spatialSigma = radius === 2 ? 1.6 : 1;
    const rangeSigma = 0.04 + 0.12 * smoothStrength;
    const rangeSigma2 = 2 * rangeSigma * rangeSigma;
    const offsets: { dx: number; dy: number; w: number }[] = [];
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const dist2 = dx * dx + dy * dy;
        const w = Math.exp(-dist2 / (2 * spatialSigma * spatialSigma));
        offsets.push({ dx, dy, w });
      }
    }

    const smoothR = new Float32Array(cellCount);
    const smoothG = new Float32Array(cellCount);
    const smoothB = new Float32Array(cellCount);
    const smoothLabL = new Float32Array(cellCount);
    const smoothLabA = new Float32Array(cellCount);
    const smoothLabB = new Float32Array(cellCount);

    if (smoothStrength > 0.01) {
      for (let y = 0; y < gridH; y++) {
        for (let x = 0; x < gridW; x++) {
          const cellIdx = idx(x, y, gridW);
          if (mask[cellIdx] === 0) continue;
          const baseL = rawLabL[cellIdx];
          const baseA = rawLabA[cellIdx];
          const baseB = rawLabB[cellIdx];
          let sumR = 0;
          let sumG = 0;
          let sumB = 0;
          let sumW = 0;
          for (const offset of offsets) {
            const nx = x + offset.dx;
            const ny = y + offset.dy;
            if (nx < 0 || ny < 0 || nx >= gridW || ny >= gridH) continue;
            const nIdx = idx(nx, ny, gridW);
            if (mask[nIdx] === 0) continue;
            const dL = rawLabL[nIdx] - baseL;
            const dA = rawLabA[nIdx] - baseA;
            const dB = rawLabB[nIdx] - baseB;
            const dist = dL * dL + dA * dA + dB * dB;
            const rangeW = Math.exp(-dist / rangeSigma2);
            const weight = offset.w * rangeW;
            sumR += rawR[nIdx] * weight;
            sumG += rawG[nIdx] * weight;
            sumB += rawB[nIdx] * weight;
            sumW += weight;
          }
          const r = sumW > 0 ? sumR / sumW : rawR[cellIdx];
          const g = sumW > 0 ? sumG / sumW : rawG[cellIdx];
          const b = sumW > 0 ? sumB / sumW : rawB[cellIdx];
          smoothR[cellIdx] = r;
          smoothG[cellIdx] = g;
          smoothB[cellIdx] = b;
          const lab = rgbToOklab(r, g, b);
          smoothLabL[cellIdx] = lab.L;
          smoothLabA[cellIdx] = lab.A;
          smoothLabB[cellIdx] = lab.B;
        }
      }
    } else {
      smoothR.set(rawR);
      smoothG.set(rawG);
      smoothB.set(rawB);
      smoothLabL.set(rawLabL);
      smoothLabA.set(rawLabA);
      smoothLabB.set(rawLabB);
    }

    const quantized = new Uint16Array(cellCount);
    for (let y = 0; y < gridH; y++) {
      for (let x = 0; x < gridW; x++) {
        const cellIdx = idx(x, y, gridW);
        if (mask[cellIdx] === 0) continue;
        const labL = smoothLabL[cellIdx];
        const labA = smoothLabA[cellIdx];
        const labB = smoothLabB[cellIdx];
        let bestId = allowedPalette[0].id;
        let bestDist = Number.POSITIVE_INFINITY;
        for (const candidate of allowedPalette) {
          const dx = labL - candidate.L;
          const dy = labA - candidate.A;
          const dz = labB - candidate.B;
          const dist = dx * dx + dy * dy + dz * dz;
          if (dist < bestDist) {
            bestDist = dist;
            bestId = candidate.id;
          }
        }
        quantized[cellIdx] = bestId;
      }
    }

    const edgeStrength = new Float32Array(cellCount);
    for (let y = 0; y < gridH; y++) {
      for (let x = 0; x < gridW; x++) {
        const cellIdx = idx(x, y, gridW);
        if (mask[cellIdx] === 0) continue;
        const l0 = smoothLabL[cellIdx];
        const a0 = smoothLabA[cellIdx];
        const b0 = smoothLabB[cellIdx];
        let maxDist = 0;
        if (x > 0) {
          const nIdx = cellIdx - 1;
          if (mask[nIdx]) {
            const dl = l0 - smoothLabL[nIdx];
            const da = a0 - smoothLabA[nIdx];
            const db = b0 - smoothLabB[nIdx];
            const dist = dl * dl + da * da + db * db;
            if (dist > maxDist) maxDist = dist;
          }
        }
        if (x < gridW - 1) {
          const nIdx = cellIdx + 1;
          if (mask[nIdx]) {
            const dl = l0 - smoothLabL[nIdx];
            const da = a0 - smoothLabA[nIdx];
            const db = b0 - smoothLabB[nIdx];
            const dist = dl * dl + da * da + db * db;
            if (dist > maxDist) maxDist = dist;
          }
        }
        if (y > 0) {
          const nIdx = cellIdx - gridW;
          if (mask[nIdx]) {
            const dl = l0 - smoothLabL[nIdx];
            const da = a0 - smoothLabA[nIdx];
            const db = b0 - smoothLabB[nIdx];
            const dist = dl * dl + da * da + db * db;
            if (dist > maxDist) maxDist = dist;
          }
        }
        if (y < gridH - 1) {
          const nIdx = cellIdx + gridW;
          if (mask[nIdx]) {
            const dl = l0 - smoothLabL[nIdx];
            const da = a0 - smoothLabA[nIdx];
            const db = b0 - smoothLabB[nIdx];
            const dist = dl * dl + da * da + db * db;
            if (dist > maxDist) maxDist = dist;
          }
        }
        edgeStrength[cellIdx] = maxDist;
      }
    }

    let cleaned = quantized;
    const visited = new Uint8Array(cellCount);
    const stack = new Int32Array(cellCount);
    const minBlobSize = Math.max(2, Math.round(2 + smoothStrength * 6));
    const edgeThreshold = 0.1 + (1 - smoothStrength) * 0.08;
    const edgeThresholdSq = edgeThreshold * edgeThreshold;

    for (let i = 0; i < cellCount; i++) {
      const colorId = cleaned[i];
      if (colorId === 0 || visited[i]) continue;
      let sp = 0;
      stack[sp++] = i;
      visited[i] = 1;
      let size = 0;
      let maxEdge = 0;
      const compIndices: number[] = [];
      const neighborCounts = new Map<number, number>();

      while (sp > 0) {
        const idxCell = stack[--sp];
        size += 1;
        if (size <= minBlobSize) compIndices.push(idxCell);
        if (edgeStrength[idxCell] > maxEdge) maxEdge = edgeStrength[idxCell];
        const x = idxCell % gridW;
        const y = Math.floor(idxCell / gridW);

        const checkNeighbor = (nx: number, ny: number) => {
          if (nx < 0 || ny < 0 || nx >= gridW || ny >= gridH) return;
          const nIdx = idx(nx, ny, gridW);
          const nId = cleaned[nIdx];
          if (nId === colorId) {
            if (!visited[nIdx]) {
              visited[nIdx] = 1;
              stack[sp++] = nIdx;
            }
          } else {
            neighborCounts.set(nId, (neighborCounts.get(nId) ?? 0) + 1);
          }
        };

        checkNeighbor(x - 1, y);
        checkNeighbor(x + 1, y);
        checkNeighbor(x, y - 1);
        checkNeighbor(x, y + 1);
      }

      if (size <= minBlobSize && maxEdge < edgeThresholdSq) {
        let replaceId = colorId;
        let bestCount = -1;
        for (const [id, count] of neighborCounts) {
          if (count > bestCount) {
            bestCount = count;
            replaceId = id;
          }
        }
        if (bestCount >= 0 && replaceId !== colorId) {
          for (const cellIdx of compIndices) {
            cleaned[cellIdx] = replaceId;
          }
        }
      }
    }

    const majorityPasses = smoothStrength > 0.7 ? 2 : 1;
    for (let pass = 0; pass < majorityPasses; pass++) {
      const updated = new Uint16Array(cleaned);
      for (let y = 0; y < gridH; y++) {
        for (let x = 0; x < gridW; x++) {
          const cellIdx = idx(x, y, gridW);
          if (mask[cellIdx] === 0) continue;
          if (edgeStrength[cellIdx] >= edgeThresholdSq) continue;
          const currentId = cleaned[cellIdx];
          const counts = new Map<number, number>();
          const check = (nx: number, ny: number) => {
            if (nx < 0 || ny < 0 || nx >= gridW || ny >= gridH) return;
            const nIdx = idx(nx, ny, gridW);
            if (mask[nIdx] === 0) return;
            const nId = cleaned[nIdx];
            if (nId === 0) return;
            counts.set(nId, (counts.get(nId) ?? 0) + 1);
          };
          check(x - 1, y);
          check(x + 1, y);
          check(x, y - 1);
          check(x, y + 1);
          check(x - 1, y - 1);
          check(x + 1, y - 1);
          check(x - 1, y + 1);
          check(x + 1, y + 1);
          let bestId = currentId;
          let bestCount = 0;
          for (const [id, count] of counts) {
            if (count > bestCount) {
              bestCount = count;
              bestId = id;
            }
          }
          if (bestId !== currentId && bestCount >= 5) {
            updated[cellIdx] = bestId;
          }
        }
      }
      cleaned = updated;
    }

    if (smoothStrength > 0.75) {
      const updated = new Uint16Array(cleaned);
      for (let y = 0; y < gridH; y++) {
        for (let x = 0; x < gridW; x++) {
          const cellIdx = idx(x, y, gridW);
          if (mask[cellIdx] === 0) continue;
          if (edgeStrength[cellIdx] >= edgeThresholdSq) continue;
          const currentId = cleaned[cellIdx];
          const counts = new Map<number, number>();
          const check = (nx: number, ny: number) => {
            if (nx < 0 || ny < 0 || nx >= gridW || ny >= gridH) return;
            const nIdx = idx(nx, ny, gridW);
            if (mask[nIdx] === 0) return;
            const nId = cleaned[nIdx];
            if (nId === 0) return;
            counts.set(nId, (counts.get(nId) ?? 0) + 1);
          };
          check(x - 1, y);
          check(x + 1, y);
          check(x, y - 1);
          check(x, y + 1);
          check(x - 1, y - 1);
          check(x + 1, y - 1);
          check(x - 1, y + 1);
          check(x + 1, y + 1);
          let bestId = currentId;
          let bestCount = 0;
          for (const [id, count] of counts) {
            if (count > bestCount) {
              bestCount = count;
              bestId = id;
            }
          }
          if (bestId !== currentId && bestCount >= 5) {
            updated[cellIdx] = bestId;
          }
        }
      }
      cleaned = updated;
    }

    updateGrid(() => cleaned);
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
    if (!isCellInFilter(x, y)) return;
    const currentGrid = gridRef.current ?? grid;
    const cellIdx = idx(x, y, gridW);
    if (currentGrid[cellIdx] === colorId) return;
    setLastEditCell({ x, y });
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
    const filtered = activeFilterRect ? indices.filter((i) => isIndexInFilter(i)) : indices;
    if (filtered.length === 0) return;
    let sumX = 0;
    let sumY = 0;
    for (const i of filtered) {
      sumX += i % gridW;
      sumY += Math.floor(i / gridW);
    }
    setLastEditCell({
      x: Math.round(sumX / filtered.length),
      y: Math.round(sumY / filtered.length),
    });
    if (strokeActiveRef.current) {
      strokeDirtyRef.current = true;
    }
    const version = strokeVersionRef.current;
    updateGrid((prev) => {
      const next = new Uint16Array(prev);
      for (const i of filtered) {
        next[i] = colorId;
      }
      return next;
    }, version);
  }

  function onFillGrid(nextGrid: Uint16Array) {
    if (strokeActiveRef.current) {
      strokeDirtyRef.current = true;
    }
    if (nextGrid.length === gridW * gridH) {
      const prev = gridRef.current ?? grid;
      for (let i = 0; i < nextGrid.length; i++) {
        if (nextGrid[i] !== prev[i]) {
          setLastEditCell({ x: i % gridW, y: Math.floor(i / gridW) });
          break;
        }
      }
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

  function hasPaintedCells() {
    const current = gridRef.current ?? grid;
    for (let i = 0; i < current.length; i++) {
      if (current[i] !== 0) return true;
    }
    return false;
  }

  function confirmAndApplyGrid() {
    if (hasPaintedCells()) {
      openConfirmDialog({
        title: "Change canvas size?",
        message: "Changing the grid size will clear your current stitches. Do you want to continue?",
        confirmLabel: "Continue",
        onConfirm: applyDraftGrid,
      });
      return;
    }
    applyDraftGrid();
  }

  function toggleTraceLock() {
    if (!traceImage) return;
    if (traceLocked) {
      if (hasPaintedCells()) {
        openConfirmDialog({
          title: "Unlock trace image?",
          message:
            "Unlocking the trace image after painting may misalign it with your stitches. Do you want to continue?",
          confirmLabel: "Unlock",
          onConfirm: () => setTraceLocked(false),
        });
        return;
      }
      setTraceLocked(false);
      return;
    }
    setTraceLocked(true);
  }

  function setTraceLockedState(nextLocked: boolean) {
    if (!traceImage) return;
    if (!nextLocked && traceLocked) {
      if (hasPaintedCells()) {
        openConfirmDialog({
          title: "Unlock background image?",
          message:
            "Unlocking the background image after painting may misalign it with your stitches. Do you want to continue?",
          confirmLabel: "Unlock",
          onConfirm: () => setTraceLocked(nextLocked),
        });
        return;
      }
    }
    setTraceLocked(nextLocked);
  }

  function performClearGrid() {
    bumpStrokeVersion();
    updateGrid(() => makeGrid(gridW, gridH, 0));
  }

  function clearGrid() {
    if (hasPaintedCells()) {
      openConfirmDialog({
        title: "Clear canvas?",
        message: "This will clear all painted cells. This action can be undone.",
        confirmLabel: "Clear",
        onConfirm: performClearGrid,
        anchorRef: clearButtonRef,
      });
      return;
    }
    performClearGrid();
  }

  function openConfirmDialog(opts: {
    title: string;
    message: string;
    confirmLabel?: string;
    onConfirm: () => void;
    anchorRef?: React.RefObject<HTMLElement | null>;
  }) {
    const { title, message, confirmLabel, onConfirm, anchorRef } = opts;
    confirmActionRef.current = onConfirm;
    let position: { top: number; left: number } | null = null;
    if (anchorRef?.current && typeof window !== "undefined") {
      const rect = anchorRef.current.getBoundingClientRect();
      const margin = 12;
      const panelW = Math.min(360, window.innerWidth - margin * 2);
      const panelH = 150;
      const centerLeft = rect.left + rect.width / 2 - panelW / 2;
      const left = Math.min(Math.max(centerLeft, margin), window.innerWidth - panelW - margin);
      let top = rect.bottom + 8;
      if (top + panelH > window.innerHeight - margin) {
        top = Math.max(margin, rect.top - panelH - 8);
      }
      position = { top, left };
    }
    setConfirmDialog({ title, message, confirmLabel, position });
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
      let minX = gridW;
      let minY = gridH;
      let maxX = 0;
      let maxY = 0;
      for (let y = 0; y < gridH; y++) {
        for (let x = 0; x < gridW; x++) {
          if (!isCellInFilter(x, y)) continue;
          const cx = (x + 0.5) * displayCellSize;
          const cy = (y + 0.5) * displayCellSize;
          if (!pointInPolygon({ x: cx, y: cy }, points)) continue;
          const cellIdx = idx(x, y, gridW);
          if (next[cellIdx] === activeColorId) continue;
          next[cellIdx] = activeColorId;
          changed = true;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
      if (changed) {
        setLastEditCell({
          x: Math.round((minX + maxX) / 2),
          y: Math.round((minY + maxY) / 2),
        });
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

  async function extractPaletteFromTrace() {
    if (!traceImage || extractingPalette) return;
    const targetSize = Math.max(2, Math.min(32, Math.floor(extractPaletteSize)));
    setExtractingPalette(true);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const hexes = extractPaletteFromImage(traceImage, targetSize);
    setExtractingPalette(false);
    if (hexes.length === 0) return;
    const toRgb = (hex: string) => {
      const clean = hex.replace("#", "");
      if (clean.length !== 6) return null;
      const r = parseInt(clean.slice(0, 2), 16) / 255;
      const g = parseInt(clean.slice(2, 4), 16) / 255;
      const b = parseInt(clean.slice(4, 6), 16) / 255;
      if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
      return { r, g, b };
    };

    const paletteLabs = palette
      .map((c) => {
        const rgb = toRgb(c.hex);
        if (!rgb) return null;
        const lab = rgbToOklab(rgb.r, rgb.g, rgb.b);
        return { id: c.id, L: lab.L, A: lab.A, B: lab.B };
      })
      .filter((entry): entry is { id: number; L: number; A: number; B: number } => Boolean(entry));

    const picked: number[] = [];
    const seen = new Set<number>();
    for (const hex of hexes) {
      const rgb = toRgb(hex);
      if (!rgb) continue;
      const lab = rgbToOklab(rgb.r, rgb.g, rgb.b);
      let bestId: number | null = null;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const candidate of paletteLabs) {
        if (seen.has(candidate.id)) continue;
        const dx = lab.L - candidate.L;
        const dy = lab.A - candidate.A;
        const dz = lab.B - candidate.B;
        const dist = dx * dx + dy * dy + dz * dz;
        if (dist < bestDist) {
          bestDist = dist;
          bestId = candidate.id;
        }
      }
      if (bestId == null) continue;
      seen.add(bestId);
      picked.push(bestId);
    }

    if (picked.length === 0) return;
    setExtractedPaletteIds(picked);
    setActiveColorId(picked[0]);
  }

  const cardShadow = "0 6px 16px rgba(15, 23, 42, 0.12)";
  const cardShadowCollapsed = "0 3px 10px rgba(15, 23, 42, 0.08)";
  const cardStyle = {
    background: "var(--card-bg)",
    border: "none",
    borderRadius: 12,
    padding: 12,
    boxShadow: cardShadow,
  } as const;
  const canvasSettingsMaxHeight = traceImage ? 1200 : 800;

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
        if (!isIndexInFilter(i)) continue;
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
        if (!isIndexInFilter(i)) continue;
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

  function cancelMerge() {
    if (mergeOriginalRef.current) {
      setGrid(mergeOriginalRef.current);
    }
    mergeOriginalRef.current = null;
    setMergeSelectedIds([]);
    setMergeTargetId(null);
  }

  function cancelDelete() {
    if (deleteOriginalRef.current) {
      setGrid(deleteOriginalRef.current);
    }
    deleteOriginalRef.current = null;
    setDeleteSelectedIds([]);
  }

  function toggleRemapMode() {
    if (remapMode) {
      cancelRemap();
      setRemapMode(false);
      return;
    }
    if (mergeMode) {
      cancelMerge();
      setMergeMode(false);
    }
    if (deleteMode) {
      cancelDelete();
      setDeleteMode(false);
    }
    cancelRemap();
    setRemapMode(true);
  }

  function toggleMergeMode() {
    if (mergeMode) {
      cancelMerge();
      setMergeMode(false);
      return;
    }
    if (remapMode) {
      cancelRemap();
      setRemapMode(false);
    }
    if (deleteMode) {
      cancelDelete();
      setDeleteMode(false);
    }
    cancelMerge();
    mergeOriginalRef.current = new Uint16Array(grid);
    setMergeMode(true);
  }

  function toggleDeleteMode() {
    if (deleteMode) {
      cancelDelete();
      setDeleteMode(false);
      return;
    }
    if (remapMode) {
      cancelRemap();
      setRemapMode(false);
    }
    if (mergeMode) {
      cancelMerge();
      setMergeMode(false);
    }
    cancelDelete();
    deleteOriginalRef.current = new Uint16Array(grid);
    setDeleteMode(true);
  }

  function startFilterSelection() {
    setFilterMode(true);
    setFilterSelecting(true);
  }

  function clearFilterSelection() {
    setFilterRect(null);
    setFilterSelecting(false);
    setFilterMode(false);
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
    let focusCell: { x: number; y: number } | null = null;
    setGrid(() => {
      const next = new Uint16Array(original);
      for (let i = 0; i < next.length; i++) {
        if (!isIndexInFilter(i)) continue;
        if (next[i] === remapSourceId) {
          next[i] = remapTargetId;
          if (focusCell == null) {
            focusCell = { x: i % gridW, y: Math.floor(i / gridW) };
          }
        }
      }
      return next;
    });
    if (focusCell) {
      setLastEditCell(focusCell);
    }
    setActiveColorId(remapTargetId);
    remapOriginalRef.current = null;
    setRemapSourceId(null);
    setRemapTargetId(null);
    setRemapMode(false);
  }

  function confirmMerge() {
    if (mergeSelectedIds.length < 2 || mergeTargetId === null || !mergeSelectedIds.includes(mergeTargetId)) {
      return;
    }
    const targetId = mergeTargetId;
    const sourceIds = mergeSelectedIds.filter((id) => id !== targetId);
    if (sourceIds.length === 0) return;
    const sourceSet = new Set(sourceIds);
    const original = mergeOriginalRef.current ?? new Uint16Array(grid);
    mergeOriginalRef.current = original;
    bumpStrokeVersion();
    pushHistory({ gridW, gridH, grid: original });
    setFutureState([]);
    let focusCell: { x: number; y: number } | null = null;
    setGrid((prev) => {
      const next = new Uint16Array(original);
      let changed = false;
      for (let i = 0; i < next.length; i++) {
        if (!isIndexInFilter(i)) continue;
        if (sourceSet.has(next[i])) {
          next[i] = targetId;
          changed = true;
          if (!focusCell) {
            focusCell = { x: i % gridW, y: Math.floor(i / gridW) };
          }
        }
      }
      return changed ? next : prev;
    });
    if (focusCell) {
      setLastEditCell(focusCell);
    }
    setActiveColorId(targetId);
    mergeOriginalRef.current = null;
    setMergeSelectedIds([]);
    setMergeTargetId(null);
    setMergeMode(false);
  }

  function confirmDeleteColors() {
    if (deleteSelectedIds.length === 0) return;
    const availableIds = usedColorIds.filter((id) => !deleteSelectedIds.includes(id));
    if (availableIds.length === 0) return;

    const toLab = (id: number) => {
      const color = paletteById.get(id);
      if (!color) return null;
      const clean = color.hex.replace("#", "");
      if (clean.length !== 6) return null;
      const r = parseInt(clean.slice(0, 2), 16) / 255;
      const g = parseInt(clean.slice(2, 4), 16) / 255;
      const b = parseInt(clean.slice(4, 6), 16) / 255;
      if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
      return rgbToOklab(r, g, b);
    };

    const candidateLabs = availableIds
      .map((id) => {
        const lab = toLab(id);
        if (!lab) return null;
        return { id, L: lab.L, A: lab.A, B: lab.B };
      })
      .filter((entry): entry is { id: number; L: number; A: number; B: number } => Boolean(entry));

    const fallbackId = candidateLabs[0]?.id ?? availableIds[0];
    if (fallbackId == null) return;

    const replacementById = new Map<number, number>();
    for (const id of deleteSelectedIds) {
      const lab = toLab(id);
      if (!lab || candidateLabs.length === 0) {
        replacementById.set(id, fallbackId);
        continue;
      }
      let bestId = fallbackId;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const candidate of candidateLabs) {
        const dx = lab.L - candidate.L;
        const dy = lab.A - candidate.A;
        const dz = lab.B - candidate.B;
        const dist = dx * dx + dy * dy + dz * dz;
        if (dist < bestDist) {
          bestDist = dist;
          bestId = candidate.id;
        }
      }
      replacementById.set(id, bestId);
    }

    const original = deleteOriginalRef.current ?? new Uint16Array(grid);
    deleteOriginalRef.current = original;
    bumpStrokeVersion();
    pushHistory({ gridW, gridH, grid: original });
    setFutureState([]);
    let focusCell: { x: number; y: number } | null = null;
    setGrid((prev) => {
      const next = new Uint16Array(original);
      let changed = false;
      for (let i = 0; i < next.length; i++) {
        if (!isIndexInFilter(i)) continue;
        const replacement = replacementById.get(next[i]);
        if (replacement != null) {
          next[i] = replacement;
          changed = true;
          if (!focusCell) {
            focusCell = { x: i % gridW, y: Math.floor(i / gridW) };
          }
        }
      }
      return changed ? next : prev;
    });
    if (focusCell) {
      setLastEditCell(focusCell);
    }
    if (replacementById.has(activeColorId)) {
      setActiveColorId(replacementById.get(activeColorId) ?? activeColorId);
    }
    deleteOriginalRef.current = null;
    setDeleteSelectedIds([]);
    setDeleteMode(false);
  }

  const usedColorsGrid =
    remapMode && remapOriginalRef.current
      ? remapOriginalRef.current
      : mergeMode && mergeOriginalRef.current
        ? mergeOriginalRef.current
        : deleteMode && deleteOriginalRef.current
          ? deleteOriginalRef.current
          : grid;
  const usedColors = useMemo(() => {
    const counts = new Map<number, number>();
    if (activeFilterRect) {
      for (let y = activeFilterRect.y0; y <= activeFilterRect.y1; y++) {
        for (let x = activeFilterRect.x0; x <= activeFilterRect.x1; x++) {
          const id = usedColorsGrid[idx(x, y, gridW)];
          if (id === 0) continue;
          counts.set(id, (counts.get(id) || 0) + 1);
        }
      }
    } else {
      for (let i = 0; i < usedColorsGrid.length; i++) {
        const id = usedColorsGrid[i];
        if (id === 0) continue;
        counts.set(id, (counts.get(id) || 0) + 1);
      }
    }
    const arr = Array.from(counts.entries())
      .map(([id, count]) => ({ color: paletteById.get(id)!, count }))
      .filter((x) => Boolean(x.color))
      .sort((a, b) => b.count - a.count);
    return arr;
  }, [usedColorsGrid, paletteById, activeFilterRect, gridW]);
  const usedColorIds = useMemo(() => usedColors.map((entry) => entry.color.id), [usedColors]);
  const [symbolMap, setSymbolMap] = useState<Map<number, string>>(() => new Map());
  useEffect(() => {
    if (usedColors.length === 0) return;
    setSymbolMap((prev) => {
      let changed = false;
      const next = new Map(prev);
      const usedSymbols = new Set(next.values());
      for (const entry of usedColors) {
        const id = entry.color.id;
        if (next.has(id)) continue;
        const symbol = SYMBOLS.find((value) => value && !usedSymbols.has(value)) ?? "";
        if (symbol) {
          next.set(id, symbol);
          usedSymbols.add(symbol);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [usedColors]);
  useEffect(() => {
    setMergeSelectedIds((prev) => prev.filter((id) => usedColorIds.includes(id)));
  }, [usedColorIds]);
  useEffect(() => {
    if (mergeTargetId !== null && !usedColorIds.includes(mergeTargetId)) {
      setMergeTargetId(null);
    }
  }, [mergeTargetId, usedColorIds]);
  useEffect(() => {
    setDeleteSelectedIds((prev) => prev.filter((id) => usedColorIds.includes(id)));
  }, [usedColorIds]);

  useEffect(() => {
    if (!mergeMode) return;
    const original = mergeOriginalRef.current;
    if (!original) return;
    if (mergeSelectedIds.length < 2 || mergeTargetId === null || !mergeSelectedIds.includes(mergeTargetId)) {
      setGrid(original);
      return;
    }
    const targetId = mergeTargetId;
    const sourceSet = new Set(mergeSelectedIds.filter((id) => id !== targetId));
    if (sourceSet.size === 0) {
      setGrid(original);
      return;
    }
    setGrid(() => {
      const next = new Uint16Array(original);
      for (let i = 0; i < next.length; i++) {
        if (!isIndexInFilter(i)) continue;
        if (sourceSet.has(next[i])) {
          next[i] = targetId;
        }
      }
      return next;
    });
  }, [mergeMode, mergeSelectedIds, mergeTargetId, activeFilterRect, gridW]);

  useEffect(() => {
    if (!deleteMode) return;
    const original = deleteOriginalRef.current;
    if (!original) return;
    if (deleteSelectedIds.length === 0) {
      setGrid(original);
      return;
    }
    const availableIds = usedColorIds.filter((id) => !deleteSelectedIds.includes(id));
    if (availableIds.length === 0) {
      setGrid(original);
      return;
    }
    const toLab = (id: number) => {
      const color = paletteById.get(id);
      if (!color) return null;
      const clean = color.hex.replace("#", "");
      if (clean.length !== 6) return null;
      const r = parseInt(clean.slice(0, 2), 16) / 255;
      const g = parseInt(clean.slice(2, 4), 16) / 255;
      const b = parseInt(clean.slice(4, 6), 16) / 255;
      if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
      return rgbToOklab(r, g, b);
    };
    const candidateLabs = availableIds
      .map((id) => {
        const lab = toLab(id);
        if (!lab) return null;
        return { id, L: lab.L, A: lab.A, B: lab.B };
      })
      .filter((entry): entry is { id: number; L: number; A: number; B: number } => Boolean(entry));
    const fallbackId = candidateLabs[0]?.id ?? availableIds[0];
    if (fallbackId == null) {
      setGrid(original);
      return;
    }
    const replacementById = new Map<number, number>();
    for (const id of deleteSelectedIds) {
      const lab = toLab(id);
      if (!lab || candidateLabs.length === 0) {
        replacementById.set(id, fallbackId);
        continue;
      }
      let bestId = fallbackId;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const candidate of candidateLabs) {
        const dx = lab.L - candidate.L;
        const dy = lab.A - candidate.A;
        const dz = lab.B - candidate.B;
        const dist = dx * dx + dy * dy + dz * dz;
        if (dist < bestDist) {
          bestDist = dist;
          bestId = candidate.id;
        }
      }
      replacementById.set(id, bestId);
    }
    setGrid(() => {
      const next = new Uint16Array(original);
      for (let i = 0; i < next.length; i++) {
        if (!isIndexInFilter(i)) continue;
        const replacement = replacementById.get(next[i]);
        if (replacement != null) {
          next[i] = replacement;
        }
      }
      return next;
    });
  }, [deleteMode, deleteSelectedIds, usedColorIds, paletteById, activeFilterRect, gridW]);

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
        setTitle(parsed.title || "Untitled Pattern");
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
        // setDarkCanvas(Boolean(parsed.darkCanvas));
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

  const collapseStyle = (open: boolean, maxHeight = 1200) =>
    ({
      minHeight: 0,
      maxHeight: open ? maxHeight : 0,
      opacity: open ? 1 : 0,
      transform: open ? "translateY(0)" : "translateY(-4px)",
      overflow: open ? "visible" : "hidden",
      transition: "max-height 220ms ease, opacity 180ms ease, transform 180ms ease",
      pointerEvents: open ? "auto" : "none",
    }) as const;

  const paletteSection = (
    <div
      className="app-card"
      style={{ ...cardStyle, boxShadow: paletteOpen ? cardShadow : cardShadowCollapsed }}
    >
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
          marginBottom: paletteOpen ? 12 : 0,
          cursor: "pointer",
          fontWeight: 600,
        }}
        type="button"
      >
        <span>Palette</span>
        <span style={{ opacity: 0.7 }}>{paletteOpen ? "▾" : "▸"}</span>
      </button>
      <div style={{ display: "grid", gap: 10, ...collapseStyle(paletteOpen, 1600) }}>
          {traceImage && (
            <div
              style={{
                display: "grid",
                gap: extractPaletteOpen ? 6 : 0,
                padding: extractPaletteOpen ? "10px 12px" : "6px 10px",
                borderRadius: 10,
                background: "var(--accent-wash)",
              }}
            >
              <button
                onClick={() => setExtractPaletteOpen((open) => !open)}
                type="button"
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
                  fontSize: 14,
                  opacity: 0.85,
                }}
              >
                <span>Generate from image</span>
                <span style={{ opacity: 0.7, width: 14, textAlign: "center" }}>
                  {extractPaletteOpen ? "▾" : "▸"}
                </span>
              </button>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", ...collapseStyle(extractPaletteOpen, 120) }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 12, opacity: 0.7 }}>Max colors</span>
                    <input
                      type="number"
                      min={2}
                      max={32}
                      step={1}
                      value={extractPaletteSize}
                      onChange={(e) => setExtractPaletteSize(Number(e.target.value))}
                      style={{
                        width: 72,
                        padding: "6px 8px",
                        borderRadius: 8,
                        border: "1px solid var(--panel-border)",
                        background: "transparent",
                        color: "var(--foreground)",
                      }}
                    />
                  </label>
                        <button
                          onClick={extractPaletteFromTrace}
                          disabled={extractingPalette}
                          style={{
                            padding: "4px 10px",
                            borderRadius: 8,
                            border: "none",
                            background: "var(--accent)",
                            color: "#ffffff",
                            cursor: "pointer",
                            opacity: extractingPalette ? 0.5 : 1,
                          }}
                        >
                    {extractingPalette ? "Generating..." : "Generate"}
                  </button>
                </div>
            </div>
          )}
          <Palette
            palette={palette}
            extractedIds={extractedIds}
            showExtractedFilter={Boolean(traceImage) && extractedIds.length > 0}
            usedIds={usedColorIds}
            showUsedFilter={usedColorIds.length > 0}
            activeColorId={remapTargetId ?? activeColorId}
            onSelect={setActiveColorId}
            remapSourceId={remapSourceId}
            remapTargetId={remapTargetId}
            onRemapSelect={(targetId) => previewRemap(targetId)}
            onAddColor={addColor}
          />
      </div>
    </div>
  );

  const usedColorsSection = (
    <div
      className="app-card"
      style={{ ...cardStyle, boxShadow: usedColorsOpen ? cardShadow : cardShadowCollapsed }}
    >
      <button
        onClick={() => setUsedColorsOpen((open) => !open)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          border: "none",
          background: "transparent",
          padding: 0,
          marginBottom: usedColorsOpen ? 8 : 0,
          cursor: "pointer",
          fontWeight: 600,
        }}
        type="button"
      >
        <span>Used colors ({usedColors.length})</span>
        <span style={{ opacity: 0.7, width: 14, textAlign: "center" }}>
          {usedColorsOpen ? "▾" : "▸"}
        </span>
      </button>
      <div style={{ ...collapseStyle(usedColorsOpen, 800) }}>
          <div
            className="used-colors-toolbar"
            style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}
          >
            <button
              onClick={toggleRemapMode}
              aria-pressed={remapMode}
              aria-label="Replace colors"
              data-tooltip="Replace colors"
              data-active={remapMode ? "true" : undefined}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "6px 8px",
                borderRadius: 10,
                cursor: "pointer",
              }}
            >
              <img
                src={assetPath("/swap.svg")}
                alt=""
                aria-hidden="true"
                width={18}
                height={18}
                style={{ display: "block", filter: "var(--icon-on-bg-filter)" }}
              />
            </button>
            <button
              onClick={toggleMergeMode}
              aria-pressed={mergeMode}
              aria-label="Merge colors"
              data-tooltip="Merge colors"
              data-active={mergeMode ? "true" : undefined}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "6px 8px",
                borderRadius: 10,
                cursor: "pointer",
              }}
            >
              <img
                src={assetPath("/merge.svg")}
                alt=""
                aria-hidden="true"
                width={18}
                height={18}
                style={{ display: "block", filter: "var(--icon-on-bg-filter)" }}
              />
            </button>
            <button
              onClick={toggleDeleteMode}
              aria-pressed={deleteMode}
              aria-label="Delete colors"
              data-tooltip="Delete colors"
              data-active={deleteMode ? "true" : undefined}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "6px 8px",
                borderRadius: 10,
                cursor: "pointer",
              }}
            >
              <img
                src={assetPath("/deselect.svg")}
                alt=""
                aria-hidden="true"
                width={18}
                height={18}
                style={{ display: "block", filter: "var(--icon-on-bg-filter)" }}
              />
            </button>
            <button
              onClick={() => {
                if (filterMode) {
                  clearFilterSelection();
                } else {
                  startFilterSelection();
                }
              }}
              aria-pressed={filterMode}
              aria-label="Filter canvas"
              data-tooltip="Filter canvas"
              data-active={filterMode ? "true" : undefined}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "6px 8px",
                borderRadius: 10,
                cursor: "pointer",
              }}
            >
              <img
                src={assetPath("/crop_filter.svg")}
                alt=""
                aria-hidden="true"
                width={18}
                height={18}
                style={{ display: "block", filter: "var(--icon-on-bg-filter)" }}
              />
            </button>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              {remapMode
                ? remapSourceId !== null
                  ? "Pick replacement color."
                  : "Select a used color to replace."
                : mergeMode
                  ? mergeSelectedIds.length < 2
                    ? "Select at least 2 colors."
                    : mergeTargetId
                      ? "Ready to merge."
                      : "Pick a target color."
                : deleteMode
                  ? deleteSelectedIds.length === 0
                    ? "Select colors to delete."
                    : usedColors.length - deleteSelectedIds.length < 1
                      ? "Keep at least one color."
                      : "Ready to delete."
                : ""}
            </div>
          </div>
          {filterSelecting && (
            <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 6 }}>
              Drag on canvas to set your filter area. Color changes will only apply within selection.
            </div>
          )}
          {deleteMode && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
              <button
                onClick={() => {
                  cancelDelete();
                  setDeleteMode(false);
                }}
                style={{
                  padding: "2px 8px",
                  borderRadius: 999,
                  border: "none",
                  background: "var(--muted-bg)",
                  color: "var(--foreground)",
                  cursor: "pointer",
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteColors}
                disabled={deleteSelectedIds.length === 0 || usedColors.length - deleteSelectedIds.length < 1}
                style={{
                  padding: "2px 8px",
                  borderRadius: 999,
                  border: "1px solid var(--foreground)",
                  background: "var(--foreground)",
                  color: "var(--background)",
                  cursor:
                    deleteSelectedIds.length === 0 || usedColors.length - deleteSelectedIds.length < 1
                      ? "not-allowed"
                      : "pointer",
                  opacity: deleteSelectedIds.length === 0 || usedColors.length - deleteSelectedIds.length < 1 ? 0.5 : 1,
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                Delete
              </button>
            </div>
          )}
          {mergeMode && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
              <button
                onClick={() => {
                  cancelMerge();
                  setMergeMode(false);
                }}
                style={{
                  padding: "2px 8px",
                  borderRadius: 999,
                  border: "none",
                  background: "var(--muted-bg)",
                  color: "var(--foreground)",
                  cursor: "pointer",
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmMerge}
                disabled={mergeSelectedIds.length < 2 || mergeTargetId === null}
                style={{
                  padding: "2px 8px",
                  borderRadius: 999,
                  border: "1px solid var(--foreground)",
                  background: "var(--foreground)",
                  color: "var(--background)",
                  cursor: mergeSelectedIds.length < 2 || mergeTargetId === null ? "not-allowed" : "pointer",
                  opacity: mergeSelectedIds.length < 2 || mergeTargetId === null ? 0.5 : 1,
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                Merge
              </button>
            </div>
          )}
          {remapMode && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
              <button
                onClick={() => {
                  cancelRemap();
                  setRemapMode(false);
                }}
                style={{
                  padding: "2px 8px",
                  borderRadius: 999,
                  border: "none",
                  background: "var(--muted-bg)",
                  color: "var(--foreground)",
                  cursor: "pointer",
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmRemap}
                disabled={remapSourceId === null || remapTargetId === null}
                style={{
                  padding: "2px 8px",
                  borderRadius: 999,
                  border: "1px solid var(--foreground)",
                  background: "var(--foreground)",
                  color: "var(--background)",
                  cursor: remapSourceId === null || remapTargetId === null ? "not-allowed" : "pointer",
                  opacity: remapSourceId === null || remapTargetId === null ? 0.5 : 1,
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                OK
              </button>
            </div>
          )}
          <div style={{ display: "grid", gap: 6, maxHeight: 240, overflowY: "auto", paddingRight: 4 }}>
            {usedColors.length === 0 ? (
              <div style={{ opacity: 0.7 }}>None yet.</div>
            ) : (
              usedColors.map(({ color, count }) => {
                const isIdentifyActive = identifyColorId === color.id;
                const isMergeSelected = mergeSelectedIds.includes(color.id);
                const isMergeTarget = mergeTargetId === color.id;
                const isDeleteSelected = deleteSelectedIds.includes(color.id);
                const mergeSelectionIndex = mergeSelectedIds.indexOf(color.id);
                const isRemapTarget = remapTargetId === color.id;
                const borderStyle = mergeMode && isMergeTarget
                  ? "2px solid var(--accent-strong)"
                  : mergeMode && isMergeSelected
                    ? "2px solid var(--accent)"
                    : deleteMode && isDeleteSelected
                      ? "2px solid var(--accent-strong)"
                      : remapSourceId === color.id
                        ? "2px solid var(--foreground)"
                        : remapMode && isRemapTarget
                          ? "2px solid var(--accent-strong)"
                          : isIdentifyActive
                            ? "2px solid var(--accent-strong)"
                            : "1px solid transparent";
                const backgroundStyle =
                  mergeMode && isMergeSelected
                    ? "var(--accent-wash)"
                    : deleteMode && isDeleteSelected
                      ? "var(--accent-wash)"
                      : remapMode && isRemapTarget
                        ? "var(--accent-wash)"
                        : "transparent";
                const handleUsedColorClick = () => {
                  if (deleteMode) {
                    setDeleteSelectedIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(color.id)) {
                        next.delete(color.id);
                      } else {
                        next.add(color.id);
                      }
                      return Array.from(next);
                    });
                    return;
                  }
                  if (mergeMode) {
                    setMergeSelectedIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(color.id)) {
                        if (mergeTargetId === color.id) {
                          setMergeTargetId(null);
                        }
                        next.delete(color.id);
                      } else {
                        next.add(color.id);
                        setMergeTargetId(color.id);
                      }
                      return Array.from(next);
                    });
                    return;
                  }
                  if (remapMode) {
                    if (remapSourceId === null) {
                      beginRemap(color.id);
                      return;
                    }
                    if (color.id === remapSourceId) return;
                    previewRemap(color.id);
                    return;
                  }
                  setActiveColorId(color.id);
                };
                return (
                  <div
                    key={color.id}
                    role="button"
                    tabIndex={0}
                    onClick={handleUsedColorClick}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        handleUsedColorClick();
                      }
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "4px 6px",
                      position: "relative",
                      borderRadius: 8,
                      border: borderStyle,
                      background: backgroundStyle,
                      cursor: "pointer",
                      textAlign: "left",
                      minWidth: 0,
                    }}
                    aria-label={`Select ${color.name}`}
                  >
                    {mergeMode && isMergeSelected && (
                      <span
                        style={{
                          position: "absolute",
                          top: -6,
                          right: -6,
                          minWidth: 18,
                          height: 18,
                          padding: "0 4px",
                          borderRadius: 999,
                          background: "var(--accent-strong)",
                          color: "#ffffff",
                          fontSize: 10,
                          fontWeight: 700,
                          display: "grid",
                          placeItems: "center",
                          boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
                          pointerEvents: "none",
                        }}
                      >
                        {mergeSelectionIndex + 1}
                      </span>
                    )}
                    <span
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: 5,
                        background: color.hex,
                        display: "block",
                        flexShrink: 0,
                        boxShadow: isMergeTarget
                          ? "0 0 0 3px var(--accent-strong), 0 0 0 6px rgba(191,100,217,0.25), inset 0 0 0 1px rgba(0,0,0,0.2)"
                          : "inset 0 0 0 1px rgba(0,0,0,0.15)",
                        position: "relative",
                      }}
                      onClick={(event) => {
                        if (!mergeMode) return;
                        event.stopPropagation();
                        setMergeSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (!next.has(color.id)) {
                            next.add(color.id);
                          }
                          return Array.from(next);
                        });
                        setMergeTargetId((prev) => (prev === color.id ? null : color.id));
                      }}
                      role={mergeMode ? "button" : undefined}
                      aria-label={mergeMode ? `Set ${color.name} as merge target` : undefined}
                      title={mergeMode ? "Set as merge target" : undefined}
                    >
                      {showSymbols && symbolForColorId(color.id, symbolMap) && (
                        <span
                          style={{
                            position: "absolute",
                            inset: 0,
                            display: "grid",
                            placeItems: "center",
                            fontSize: 12,
                            fontWeight: 700,
                            color: contrastForHex(color.hex),
                            opacity: 0.85,
                            pointerEvents: "none",
                          }}
                        >
                          {symbolForColorId(color.id, symbolMap)}
                        </span>
                      )}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        lineHeight: 1.2,
                        whiteSpace: "normal",
                        wordBreak: "break-word",
                        flex: "1 1 auto",
                        minWidth: 0,
                      }}
                    >
                      {color.code ? `#${color.code} ` : ""}
                      {color.name} ({count})
                    </span>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setIdentifyColorId((prev) => (prev === color.id ? null : color.id));
                      }}
                      aria-label={isIdentifyActive ? `Hide ${color.name}` : `Identify ${color.name}`}
                      title={isIdentifyActive ? "Hide highlight" : "Highlight color"}
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 999,
                        border: isIdentifyActive ? "1px solid var(--accent-strong)" : "1px solid transparent",
                        background: isIdentifyActive ? "var(--accent-soft)" : "transparent",
                        display: "grid",
                        placeItems: "center",
                        cursor: "pointer",
                        flexShrink: 0,
                      }}
                    >
                      <img
                        src={assetPath("/identify.svg")}
                        alt=""
                        aria-hidden="true"
                        width={14}
                        height={14}
                        style={{ display: "block", filter: "var(--icon-on-bg-filter)" }}
                      />
                    </button>
                  </div>
                );
              })
            )}
          </div>
      </div>
    </div>
  );

  return (
      <div
        className="pattern-editor"
        style={{ display: "grid", gap: 12, padding: 0, width: "100%", maxWidth: "100%", margin: "0 auto" }}
      >
      <div
        className="pattern-main"
        style={{
          display: "grid",
          columnGap: 12,
          rowGap: 16,
          alignItems: "start",
          width: "100%",
          minWidth: 0,
          gridTemplateColumns: isNarrow ? "1fr" : `${sidebarWidth}px minmax(0, 1fr) ${sidebarWidth}px`,
        }}
      >
        <div
          className="pattern-sidebar"
          style={{
            display: "grid",
            gap: 16,
            alignContent: "start",
            width: "100%",
            minWidth: 0,
          }}
        >
          <div style={{ display: "flex", justifyContent: "center" }}>
            <img
              src={assetPath("/wippa_logo.png")}
              alt="Wippa"
              style={{ height: 92, width: "auto", display: "block" }}
            />
          </div>
          <div
            className="app-card"
            style={{
              ...cardStyle,
              display: "grid",
              gap: 8,
              justifyItems: "center",
              textAlign: "center",
            }}
          >
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid var(--panel-border)",
                width: "100%",
              }}
            />
            <div style={{ display: "grid", gap: 8, width: "100%" }}>
              <button
                onClick={saveDraft}
                style={{
                  padding: "6px 10px",
                  borderRadius: 8,
                  border: "none",
                  background: "var(--muted-bg)",
                  color: "var(--foreground)",
                  cursor: "pointer",
                  fontSize: 14,
                  width: "100%",
                }}
              >
                Save WIP
              </button>
              <button
                onClick={() => draftInputRef.current?.click()}
                style={{
                  padding: "6px 10px",
                  borderRadius: 8,
                  border: "none",
                  background: "var(--muted-bg)",
                  color: "var(--foreground)",
                  cursor: "pointer",
                  fontSize: 14,
                  width: "100%",
                }}
              >
                Load WIP
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
            <div style={{ display: "flex", justifyContent: "center", width: "100%" }}>
              <ExportPdfButton
                title={title}
                canvasRef={exportCanvasRef}
                usedColors={usedColors}
                grid={grid}
                paletteById={paletteById}
                symbolMap={symbolMap}
                width={gridW}
                height={gridH}
                cellSize={EXPORT_CELL_SIZE}
              />
            </div>
          </div>
          <div
            className="app-card"
            style={{
              ...cardStyle,
              boxShadow: gridOpen ? cardShadow : cardShadowCollapsed,
              width: "100%",
              minHeight: gridOpen ? 240 : 0,
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
                marginBottom: gridOpen ? 12 : 0,
                cursor: "pointer",
                fontWeight: 600,
              }}
              type="button"
            >
              <span>Canvas Size</span>
              <span style={{ opacity: 0.7 }}>{gridOpen ? "▾" : "▸"}</span>
            </button>

            <div style={{ display: "grid", gap: 8, width: "100%", ...collapseStyle(gridOpen, 900) }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "nowrap" }}>
                  <button
                    type="button"
                    onClick={() => setDraftGridMode("stitches")}
                    aria-pressed={draftGridMode === "stitches"}
                    style={{
                      padding: "5px 9px",
                      borderRadius: 10,
                      border: draftGridMode === "stitches" ? "1px solid var(--accent-strong)" : "none",
                      background: draftGridMode === "stitches" ? "var(--accent-wash)" : "var(--muted-bg)",
                      color: draftGridMode === "stitches" ? "var(--accent-strong)" : "var(--foreground)",
                      cursor: "pointer",
                      fontSize: 13.5,
                      flex: "1 1 0",
                    }}
                  >
                    Stitch Count
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraftGridMode("inches")}
                    aria-pressed={draftGridMode === "inches"}
                    style={{
                      padding: "5px 9px",
                      borderRadius: 10,
                      border: draftGridMode === "inches" ? "1px solid var(--accent-strong)" : "none",
                      background: draftGridMode === "inches" ? "var(--accent-wash)" : "var(--muted-bg)",
                      color: draftGridMode === "inches" ? "var(--accent-strong)" : "var(--foreground)",
                      cursor: "pointer",
                      fontSize: 13.5,
                      flex: "1 1 0",
                    }}
                  >
                    Dimensions
                  </button>
                </div>

                {draftGridMode === "stitches" ? (
                  <>
                    <label style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                      <span style={{ fontSize: 14 }}>Width (stitches)</span>
                    <input
                      type="number"
                      min={1}
                      value={draftGridW}
                      onChange={(e) => setDraftGridW(parseInt(e.target.value || "1", 10))}
                      style={{
                        width: 72,
                        padding: 6,
                        borderRadius: 8,
                        border: "1px solid rgba(0,0,0,0.2)",
                        fontSize: 14,
                      }}
                    />
                    </label>
                    <label style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                      <span style={{ fontSize: 14 }}>Height (stitches)</span>
                    <input
                      type="number"
                      min={1}
                      value={draftGridH}
                      onChange={(e) => setDraftGridH(parseInt(e.target.value || "1", 10))}
                      style={{
                        width: 72,
                        padding: 6,
                        borderRadius: 8,
                        border: "1px solid rgba(0,0,0,0.2)",
                        fontSize: 14,
                      }}
                    />
                    </label>
                  </>
                ) : (
                  <>
                    <label style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                      <span style={{ fontSize: 14 }}>Width (inches)</span>
                    <input
                      type="number"
                      min={0.1}
                      step={0.1}
                      value={draftWidthIn}
                      onChange={(e) => setDraftWidthIn(parseFloat(e.target.value || "0"))}
                      style={{
                        width: 72,
                        padding: 6,
                        borderRadius: 8,
                        border: "1px solid rgba(0,0,0,0.2)",
                        fontSize: 14,
                      }}
                    />
                    </label>
                    <label style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                      <span style={{ fontSize: 14 }}>Height (inches)</span>
                    <input
                      type="number"
                      min={0.1}
                      step={0.1}
                      value={draftHeightIn}
                      onChange={(e) => setDraftHeightIn(parseFloat(e.target.value || "0"))}
                      style={{
                        width: 72,
                        padding: 6,
                        borderRadius: 8,
                        border: "1px solid rgba(0,0,0,0.2)",
                        fontSize: 14,
                      }}
                    />
                    </label>
                    <label style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                      <span style={{ fontSize: 14 }}>Mesh (stitches/in)</span>
                    <input
                      type="number"
                      min={1}
                      value={draftMeshCount}
                      onChange={(e) => setDraftMeshCount(parseInt(e.target.value || "1", 10))}
                      style={{
                        width: 72,
                        padding: 6,
                        borderRadius: 8,
                        border: "1px solid rgba(0,0,0,0.2)",
                        fontSize: 14,
                      }}
                    />
                    </label>
                  </>
                )}
                <div style={{ display: "flex", justifyContent: "center", gap: 12, alignItems: "center" }}>
                  <button
                    onClick={confirmAndApplyGrid}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 10,
                      border: "none",
                      background: "var(--accent)",
                      color: "var(--card-bg)",
                      cursor: "pointer",
                    }}
                  >
                    Apply Size
                  </button>
                </div>
            </div>
          </div>

          <div
            className="app-card"
            style={{ ...cardStyle, boxShadow: traceOpen ? cardShadow : cardShadowCollapsed }}
          >
            <button
              onClick={() => setTraceOpen((open) => !open)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                width: "100%",
                border: "none",
                background: "transparent",
                padding: 0,
                marginBottom: traceOpen ? 12 : 0,
                cursor: "pointer",
                fontWeight: 600,
              }}
              type="button"
            >
              <span>Background Image</span>
              <span style={{ opacity: 0.7 }}>{traceOpen ? "▾" : "▸"}</span>
            </button>
            <div style={{ display: "grid", gap: 10, width: "100%", ...collapseStyle(traceOpen, 900) }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <label
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      padding: "6px 8px",
                      borderRadius: 10,
                      border: "none",
                      background: "var(--muted-bg)",
                      color: "var(--foreground)",
                      cursor: "pointer",
                      fontSize: 12,
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
                      border: "none",
                      background: "var(--muted-bg)",
                      color: "var(--foreground)",
                      cursor: "pointer",
                      opacity: !traceImage || traceLocked ? 0.5 : 1,
                      fontSize: 12,
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
                      border: "none",
                      background: "var(--muted-bg)",
                      color: "var(--foreground)",
                      cursor: "pointer",
                      opacity: traceImage ? 1 : 0.5,
                      fontSize: 12,
                    }}
                  >
                    Remove
                  </button>
                </div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>
                  Drag the image to move it. Drag the corners to resize. Lock it when aligned.
                </div>
                <div style={{ display: "flex", justifyContent: "center", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ display: "inline-flex", gap: 4 }}>
                    <button
                      onClick={() => setTraceLockedState(true)}
                      disabled={!traceImage}
                      aria-pressed={traceLocked}
                      style={{
                        padding: "7px 8px",
                        borderRadius: 10,
                        border: traceLocked ? "1px solid var(--accent-strong)" : "none",
                        background: traceLocked ? "var(--accent-soft)" : "var(--muted-bg)",
                        color: traceLocked ? "var(--accent-strong)" : "var(--foreground)",
                        cursor: "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        opacity: traceImage ? 1 : 0.5,
                        fontSize: 13,
                      }}
                    >
                      <img
                        src={assetPath("/lock.svg")}
                        alt=""
                        aria-hidden="true"
                        width={15}
                        height={15}
                        style={{
                          display: "block",
                          filter: traceLocked ? "none" : "var(--icon-on-bg-filter)",
                        }}
                      />
                      Lock Image
                    </button>
                    <button
                      onClick={() => setTraceLockedState(false)}
                      disabled={!traceImage}
                      aria-pressed={!traceLocked}
                      style={{
                        padding: "7px 8px",
                        borderRadius: 10,
                        border: !traceLocked ? "1px solid var(--accent-strong)" : "none",
                        background: !traceLocked ? "var(--accent-soft)" : "var(--muted-bg)",
                        color: !traceLocked ? "var(--accent-strong)" : "var(--foreground)",
                        cursor: "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        opacity: traceImage ? 1 : 0.5,
                        fontSize: 13,
                      }}
                    >
                      <img
                        src={assetPath("/unlock.svg")}
                        alt=""
                        aria-hidden="true"
                        width={15}
                        height={15}
                        style={{
                          display: "block",
                          filter: !traceLocked ? "none" : "var(--icon-on-bg-filter)",
                        }}
                      />
                      Unlock Image
                    </button>
                  </div>
                </div>
            </div>
          </div>

          <div
            className="app-card"
            style={{ ...cardStyle, boxShadow: imageToPatternOpen ? cardShadow : cardShadowCollapsed }}
          >
            <button
              onClick={() => setImageToPatternOpen((open) => !open)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-start",
                width: "100%",
                border: "none",
                background: "transparent",
                padding: 0,
                marginBottom: imageToPatternOpen ? 8 : 0,
                cursor: "pointer",
                fontWeight: 600,
                textAlign: "left",
              }}
              type="button"
            >
              <span>Convert Image to Pattern</span>
              <span style={{ opacity: 0.7, width: 14, textAlign: "center", marginLeft: "auto" }}>
                {imageToPatternOpen ? "▾" : "▸"}
              </span>
            </button>
            <div
              style={{
                display: "grid",
                gap: 10,
                width: "100%",
                ...collapseStyle(imageToPatternOpen, 500),
              }}
            >
              <div style={{ fontSize: 12, opacity: 0.7 }}>
                Running this will overwrite the current pattern.
              </div>
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 12, opacity: 0.7 }}>Max colors</span>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{convertMaxColors}</span>
                  </div>
                  <input
                    type="range"
                    min={2}
                    max={32}
                    value={convertMaxColors}
                    onChange={(e) => setConvertMaxColors(parseInt(e.target.value, 10))}
                    disabled={!traceImage}
                  />
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 12, opacity: 0.7 }}>Smoothing</span>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>
                      {Math.round(convertSmoothing * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(convertSmoothing * 100)}
                    onChange={(e) => setConvertSmoothing(parseInt(e.target.value, 10) / 100)}
                    disabled={!traceImage}
                  />
                </div>
                <button
                  onClick={convertImageToPattern}
                  disabled={!traceImage}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: "none",
                    background: "var(--muted-bg)",
                    color: "var(--foreground)",
                    cursor: "pointer",
                    opacity: traceImage ? 1 : 0.5,
                    width: "100%",
                  }}
                >
                  Convert
                </button>
            </div>
          </div>

        </div>

        <div
          className="pattern-canvas-shell"
          style={{ minWidth: 0, paddingInline: "var(--canvas-shell-padding, 12px)" }}
        >
          {isNarrow && (
            <div
              className="app-card"
              style={{
                ...cardStyle,
                boxShadow: canvasSettingsOpen ? cardShadow : cardShadowCollapsed,
                display: "grid",
                gap: canvasSettingsOpen ? 12 : 0,
                marginBottom: 16,
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
                <span style={{ opacity: 0.7, width: 14, textAlign: "center" }}>
                  {canvasSettingsOpen ? "▾" : "▸"}
                </span>
              </button>
              <div style={{ ...collapseStyle(canvasSettingsOpen, canvasSettingsMaxHeight) }}>
                <div
                  style={{
                    display: "grid",
                    gap: 10,
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  }}
                >
                  <Toggle label="Show gridlines" checked={showGridlines} onChange={setShowGridlines} />
                  <Toggle label="Thread view" checked={threadView} onChange={setThreadView} />
                  {/* <Toggle label="Dark canvas" checked={darkCanvas} onChange={setDarkCanvas} /> */}
                  <Toggle label="Color symbols" checked={showSymbols} onChange={setShowSymbols} />
                </div>
                {traceImage && (
                  <label style={{ display: "grid", gap: 6, padding: "10px 0 5px" }}>
                    <span style={{ fontSize: 12, opacity: 0.7 }}>Image opacity</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(traceOpacity * 100)}
                      onChange={(e) => setTraceOpacity(parseInt(e.target.value, 10) / 100)}
                      style={{ width: 120 }}
                    />
                  </label>
                )}
              </div>
            </div>
          )}
          {/* Canvas area */}
          <div
            ref={canvasAreaRef}
            className="pattern-canvas-area"
            style={{
              minWidth: 0,
              flex: "1 1 0",
              paddingBottom: isNarrow ? 0 : undefined,
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
              onToolChange={(nextTool: "paint" | "eraser" | "fill" | "eyedropper" | "lasso") => {
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
              clearButtonRef={clearButtonRef}
              canUndo={history.length > 0}
              canRedo={future.length > 0}
              lastEditCell={lastEditCell}
              onJumpToLastEdit={() => {
                if (!lastEditCell) return;
                setJumpToLastEditTick((tick) => tick + 1);
              }}
              jumpToLastEditToken={jumpToLastEditTick}
              zoom={zoom}
              minZoom={minZoom}
              maxZoom={maxZoom}
              pinchEnabled={isNarrow}
              onZoomChange={(next: number) => setZoom(clampZoom(next))}
              darkCanvas={darkCanvas}
              onControlsHeightChange={setCanvasControlsHeight}
              showSymbols={showSymbols}
              identifyColorId={identifyColorId}
              symbolMap={symbolMap}
              filterMode={filterMode}
              filterRect={activeFilterRect}
              filterSelecting={filterSelecting}
              onStartFilterSelection={startFilterSelection}
              onClearFilterSelection={clearFilterSelection}
              onFilterRectChange={(rect: FilterRect | null) =>
                setFilterRect(rect ? clampFilterRect(rect, gridW, gridH) : null)
              }
              onFilterSelectEnd={() => setFilterSelecting(false)}
            />
          </div>
        </div>
        {isNarrow && paletteSection}
        {isNarrow && usedColorsSection}
        {!isNarrow && (
          <div
            style={{
              width: "100%",
              minWidth: 0,
              display: "grid",
              gap: 16,
            }}
          >
            <div
              className="app-card"
              style={{
                ...cardStyle,
                boxShadow: canvasSettingsOpen ? cardShadow : cardShadowCollapsed,
                width: "100%",
                display: "grid",
                gap: canvasSettingsOpen ? 12 : 0,
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
              <div style={{ ...collapseStyle(canvasSettingsOpen, canvasSettingsMaxHeight) }}>
                  <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                    <Toggle label="Show gridlines" checked={showGridlines} onChange={setShowGridlines} />
                    <Toggle label="Thread view" checked={threadView} onChange={setThreadView} />
                    {/* <Toggle label="Dark canvas" checked={darkCanvas} onChange={setDarkCanvas} /> */}
                    <Toggle label="Color symbols" checked={showSymbols} onChange={setShowSymbols} />
                  </div>
                  {traceImage && (
                    <label style={{ display: "grid", gap: 6, padding: "10px 0 5px" }}>
                      <span style={{ fontSize: 12, opacity: 0.7 }}>Image opacity</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={Math.round(traceOpacity * 100)}
                        onChange={(e) => setTraceOpacity(parseInt(e.target.value, 10) / 100)}
                        style={{ width: 120 }}
                      />
                    </label>
                  )}
              </div>
            </div>
            {paletteSection}
            {usedColorsSection}
          </div>
        )}
      </div>
      {confirmDialog && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={confirmDialog.title}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.35)",
            display: "block",
            zIndex: 50,
            padding: 16,
          }}
          onClick={() => setConfirmDialog(null)}
        >
          <div
            style={{
              background: "var(--card-bg)",
              color: "var(--foreground)",
              borderRadius: 14,
              padding: 16,
              width: "min(360px, 90vw)",
              boxShadow: "0 16px 40px rgba(15, 23, 42, 0.2)",
              display: "grid",
              gap: 12,
              position: "absolute",
              top: confirmDialog.position ? confirmDialog.position.top : "50%",
              left: confirmDialog.position ? confirmDialog.position.left : "50%",
              transform: confirmDialog.position ? "none" : "translate(-50%, -50%)",
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div style={{ fontWeight: 700, fontSize: 15 }}>{confirmDialog.title}</div>
            <div style={{ fontSize: 12.5, opacity: 0.75 }}>{confirmDialog.message}</div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                type="button"
                onClick={() => setConfirmDialog(null)}
                style={{
                  padding: "6px 10px",
                  borderRadius: 10,
                  border: "none",
                  background: "var(--muted-bg)",
                  color: "var(--foreground)",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmDialog(null);
                  confirmActionRef.current?.();
                }}
                style={{
                  padding: "6px 10px",
                  borderRadius: 10,
                  border: "1px solid var(--accent-strong)",
                  background: "var(--accent-wash)",
                  color: "var(--accent-strong)",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {confirmDialog.confirmLabel ?? "OK"}
              </button>
            </div>
          </div>
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
    symbolMap,
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
    onFillCells,
    onFillGrid,
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
    clearButtonRef,
    canUndo,
    canRedo,
    lastEditCell,
    onJumpToLastEdit,
    jumpToLastEditToken,
    zoom,
    minZoom,
    maxZoom,
    pinchEnabled,
    onZoomChange,
    darkCanvas,
    onControlsHeightChange,
    showSymbols,
    identifyColorId,
    filterMode,
    filterRect,
    filterSelecting,
    onStartFilterSelection,
    onClearFilterSelection,
    onFilterRectChange,
    onFilterSelectEnd,
  } = props;

  // Render the interactive canvas
  // And a hidden export canvas at a higher resolution (fixed cell size) for clean PDFs
  const exportCellSize = EXPORT_CELL_SIZE;
  const zoomPercent = Math.round(zoom * 100);
  const [zoomInput, setZoomInput] = useState(String(zoomPercent));
  const zoomStep =
    zoom < 1 ? 0.1 : zoom < 2 ? 0.2 : zoom < 4 ? 0.35 : 0.5;
  const activeColor = paletteById.get(activeColorId);
  const hasFilterRect = Boolean(filterRect);
  const canvasCardRef = useRef<HTMLDivElement | null>(null);
  const zoomRowRef = useRef<HTMLDivElement | null>(null);
  const [canvasCardMaxHeight, setCanvasCardMaxHeight] = useState<number | null>(null);
  const [canvasViewportHeight, setCanvasViewportHeight] = useState<number | null>(null);
  const [centerCanvasTick, setCenterCanvasTick] = useState(0);

  useEffect(() => {
    setZoomInput(String(zoomPercent));
  }, [zoomPercent]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const updateHeights = () => {
      const card = canvasCardRef.current;
      if (!card) return;
      const rect = card.getBoundingClientRect();
      const bottomPadding = 16;
      const maxHeight = Math.max(240, Math.floor(window.innerHeight - rect.top - bottomPadding));
      setCanvasCardMaxHeight(maxHeight);
      const zoomRowHeight = zoomRowRef.current?.getBoundingClientRect().height ?? 0;
      const padding = 12;
      const gap = 10;
      const availableCanvasHeight = Math.max(120, maxHeight - zoomRowHeight - padding * 2 - gap);
      setCanvasViewportHeight(availableCanvasHeight);
    };
    updateHeights();
    window.addEventListener("resize", updateHeights);
    return () => window.removeEventListener("resize", updateHeights);
  }, [containerWidth, containerHeight, zoom]);

  const effectiveContainerHeight =
    canvasViewportHeight !== null ? Math.min(containerHeight, canvasViewportHeight) : containerHeight;

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

  function fitToHeight() {
    if (!canvasCardRef.current) return;
    const rect = canvasCardRef.current.getBoundingClientRect();
    const rowHeight = zoomRowRef.current?.getBoundingClientRect().height ?? 0;
    const padding = 12;
    const gap = 10;
    const bottomPadding = 24;
    const available = window.innerHeight - rect.top - bottomPadding - rowHeight - gap - padding * 2;
    if (!Number.isFinite(available) || available <= 0) return;
    const baseCellSize = cellSize / (zoom || 1);
    if (!Number.isFinite(baseCellSize) || baseCellSize <= 0) return;
    const nextZoom = available / (height * baseCellSize);
    onZoomChange(nextZoom);
    setCenterCanvasTick((tick) => tick + 1);
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
        <div
          className="canvas-toolbar"
          style={{
            background: "var(--card-bg)",
            border: "none",
            borderRadius: 12,
            padding: "var(--canvas-toolbar-padding, 12px)",
            boxShadow: "none",
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <button
              onClick={onTogglePanMode}
              aria-pressed={panMode}
              aria-label="Pan"
              data-tooltip="Pan"
              data-active={panMode ? "true" : undefined}
              style={{
                padding: "6px 8px",
                borderRadius: 10,
                cursor: "pointer",
              }}
            >
            <img
              src={assetPath("/pan.svg")}
              alt=""
              aria-hidden="true"
              width={18}
                height={18}
                style={{ display: "block", filter: "var(--icon-on-bg-filter)" }}
              />
            </button>
          {(["paint", "eraser", "fill", "eyedropper", "lasso"] as const).map((t) => (
            <button
              key={t}
              onClick={() => onToolChange(t)}
              aria-label={
                t === "paint"
                  ? "Brush"
                  : t === "eraser"
                    ? "Eraser"
                    : t === "fill"
                      ? "Fill"
                    : t === "eyedropper"
                      ? "Eyedropper"
                      : "Lasso"
              }
              data-tooltip={
                t === "paint"
                  ? "Brush"
                  : t === "eraser"
                    ? "Eraser"
                    : t === "fill"
                      ? "Fill"
                      : t === "eyedropper"
                        ? "Eyedropper"
                        : "Lasso"
              }
              data-active={tool === t && !panMode ? "true" : undefined}
              style={{
                padding: "6px 8px",
                borderRadius: 10,
                  cursor: "pointer",
                }}
            >
                <img
                  src={
                    t === "paint"
                      ? assetPath("/brush.svg")
                      : t === "eraser"
                        ? assetPath("/eraser.svg")
                        : t === "fill"
                          ? assetPath("/paint_bucket.svg")
                        : t === "eyedropper"
                          ? assetPath("/dropper.svg")
                          : assetPath("/lasso.svg")
                  }
                  alt=""
                  aria-hidden="true"
                  width={18}
                height={18}
                style={{
                  display: "block",
                  filter: "var(--icon-on-bg-filter)",
                }}
              />
            </button>
          ))}
            <span style={{ opacity: 0.45, margin: "0 6px" }}>|</span>
            <button
              onClick={onUndo}
              disabled={!canUndo}
              aria-label="Undo"
              data-tooltip="Undo"
              style={{
                padding: "6px 8px",
                borderRadius: 10,
                cursor: "pointer",
                opacity: canUndo ? 1 : 0.5,
              }}
            >
            <img
              src={assetPath("/undo.svg")}
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
              data-tooltip="Redo"
              style={{
                padding: "6px 8px",
                borderRadius: 10,
                cursor: "pointer",
                opacity: canRedo ? 1 : 0.5,
              }}
            >
            <img
              src={assetPath("/redo.svg")}
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
              data-tooltip="Clear"
              ref={clearButtonRef}
              style={{
                padding: "6px 8px",
                borderRadius: 10,
                cursor: "pointer",
              }}
            >
            <img
              src={assetPath("/trash.svg")}
              alt=""
              aria-hidden="true"
              width={18}
                height={18}
                style={{ display: "block", filter: "var(--icon-on-bg-filter)" }}
              />
            </button>
          </div>
          <div style={{ flex: "1 1 auto" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
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
            {pinchEnabled && (
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
          </div>
        </div>
      </div>

      <div
        ref={canvasCardRef}
        style={{
          background: "var(--card-bg)",
          border: "none",
          borderRadius: 12,
          padding: "var(--canvas-card-padding, 12px)",
          boxShadow: "0 6px 16px rgba(15, 23, 42, 0.12)",
          display: "grid",
          gap: 10,
          maxHeight: canvasCardMaxHeight ?? undefined,
          overflow: "visible",
        }}
      >
        <div
          ref={zoomRowRef}
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}
        >
          <div style={{ display: "grid", justifyItems: "center", gap: 4 }}>
            <span
              style={{
                width: 24,
                height: 24,
                borderRadius: 8,
                border: "1px solid rgba(0,0,0,0.2)",
                background: activeColor?.hex ?? "transparent",
                display: "inline-block",
              }}
            />
            <span style={{ fontSize: 12, opacity: 0.7, fontWeight: 600 }}>
              {activeColor?.code ? `#${activeColor.code}` : ""}
            </span>
          </div>
          <div
            className="zoom-row"
            style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}
          >
            <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
              <button
                onClick={() => onJumpToLastEdit?.()}
                disabled={!lastEditCell}
                aria-label="Jump to last edit"
                data-tooltip="Jump to last edit"
                title="Jump to last edit"
                style={{
                  padding: "4px 8px",
                  borderRadius: 8,
                  border: "none",
                  background: "var(--muted-bg)",
                  color: "var(--foreground)",
                  cursor: lastEditCell ? "pointer" : "not-allowed",
                  opacity: lastEditCell ? 1 : 0.5,
                  fontSize: 12,
                }}
              >
                <img
                  src={assetPath("/jump_to_element.svg")}
                  alt=""
                  aria-hidden="true"
                  width={16}
                  height={16}
                  style={{ display: "block", filter: "var(--icon-on-bg-filter)" }}
                />
              </button>
              <button
                onClick={() => {
                  onZoomChange(1);
                  setCenterCanvasTick((tick) => tick + 1);
                }}
                aria-label="Fit width"
                data-tooltip="Fit width"
                title="Fit width"
                style={{
                  padding: "4px 8px",
                  borderRadius: 8,
                  border: "none",
                  background: "var(--muted-bg)",
                  color: "var(--foreground)",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                <img
                  src={assetPath("/fit_width.svg")}
                  alt=""
                  aria-hidden="true"
                  width={16}
                  height={16}
                  style={{ display: "block", filter: "var(--icon-on-bg-filter)" }}
                />
              </button>
              <button
                onClick={() => {
                  fitToHeight();
                }}
                aria-label="Fit height"
                data-tooltip="Fit height"
                title="Fit height"
                style={{
                  padding: "4px 8px",
                  borderRadius: 8,
                  border: "none",
                  background: "var(--muted-bg)",
                  color: "var(--foreground)",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                <img
                  src={assetPath("/fit_height.svg")}
                  alt=""
                  aria-hidden="true"
                  width={16}
                  height={16}
                  style={{ display: "block", filter: "var(--icon-on-bg-filter)" }}
                />
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
                style={{
                  width: 60,
                  height: 28,
                  padding: "0 6px",
                  borderRadius: 8,
                  border: "1px solid rgba(0,0,0,0.2)",
                  fontSize: 12,
                  lineHeight: "26px",
                }}
              />
              <span style={{ fontSize: 12, opacity: 0.7 }}>%</span>
            </div>
            <div style={{ display: "flex", gap: 4, alignItems: "center", width: "100%" }}>
              <button
                onClick={() => onZoomChange(Math.max(minZoom, Number((zoom - zoomStep).toFixed(2))))}
                style={{
                  padding: "4px 8px",
                  borderRadius: 8,
                  border: "none",
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
                style={{ flex: 1 }}
              />
              <button
                onClick={() => onZoomChange(Math.min(maxZoom, Number((zoom + zoomStep).toFixed(2))))}
                style={{
                  padding: "4px 8px",
                  borderRadius: 8,
                  border: "none",
                  background: "transparent",
                  color: "var(--foreground)",
                  cursor: "pointer",
                }}
              >
                +
              </button>
            </div>
          </div>
        </div>
        <GridCanvas
          width={width}
          height={height}
          grid={grid}
          paletteById={paletteById}
          symbolMap={symbolMap}
          activeColorId={activeColorId}
          identifyColorId={identifyColorId}
          cellSize={cellSize}
          containerWidth={containerWidth}
          containerHeight={effectiveContainerHeight}
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
          onFillCells={onFillCells}
          onFillGrid={onFillGrid}
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
          centerCanvasToken={centerCanvasTick}
          focusCell={lastEditCell}
          focusCellToken={jumpToLastEditToken}
          filterRect={filterRect}
          filterSelecting={filterSelecting}
          onFilterRectChange={onFilterRectChange}
          onFilterSelectEnd={onFilterSelectEnd}
        />
      </div>

      {/* Hidden high-res canvas for export */}
      <div style={{ position: "absolute", left: -10000, top: -10000 }}>
        <ExportCanvas
          exportCanvasRef={exportCanvasRef}
          width={width}
          height={height}
          grid={grid}
          paletteById={paletteById}
          symbolMap={symbolMap}
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
  symbolMap,
  cellSize,
  showGridlines,
}: {
  exportCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  width: number;
  height: number;
  grid: Uint16Array;
  paletteById: Map<number, Color>;
  symbolMap?: Map<number, string>;
  cellSize: number;
  showGridlines: boolean;
}) {
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

        const symbol = symbolForColorId(color.id, symbolMap);
        if (symbol) {
          ctx.save();
          ctx.fillStyle = contrastForHex(color.hex);
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.font = `700 ${Math.max(10, Math.floor(cellSize * 0.7))}px ui-sans-serif, system-ui, sans-serif`;
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
  }, [
    exportCanvasRef,
    canvasW,
    canvasH,
    width,
    height,
    grid,
    paletteById,
    symbolMap,
    cellSize,
    showGridlines,
  ]);

  return <canvas ref={exportCanvasRef} />;
}
