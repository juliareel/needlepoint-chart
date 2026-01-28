"use client";

import React from "react";
import type { Color } from "../lib/grid";
import { exportPatternPdf } from "../lib/pdf";

type Props = {
  title: string;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  usedColors: { color: Color; count: number }[];
  grid: Uint16Array;
  paletteById: Map<number, Color>;
  symbolMap?: Map<number, string>;
  width: number;
  height: number;
  cellSize: number;
};

export default function ExportPdfButton({
  title,
  canvasRef,
  usedColors,
  grid,
  paletteById,
  symbolMap,
  width,
  height,
  cellSize,
}: Props) {
  return (
    <button
      onClick={() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        exportPatternPdf({ title, canvas, usedColors, grid, paletteById, symbolMap, width, height, cellSize });
      }}
      style={{
        padding: "10px 12px",
        borderRadius: 10,
        border: "none",
        background: "var(--accent)",
        color: "#ffffff",
        cursor: "pointer",
        width: "100%",
      }}
    >
      Export PDF
    </button>
  );
}
