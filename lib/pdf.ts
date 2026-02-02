import jsPDF from "jspdf";
import type { Color } from "./grid";
import { idx } from "./grid";
import { symbolForColorId } from "./symbols";

export function exportPatternPdf(opts: {
  title: string;
  canvas: HTMLCanvasElement;
  usedColors: { color: Color; count: number }[];
  grid: Uint16Array;
  paletteById: Map<number, Color>;
  symbolMap?: Map<number, string>;
  width: number;
  height: number;
  cellSize: number;
}) {
  const { title, canvas, usedColors, grid, paletteById, symbolMap, width, height, cellSize } = opts;

  const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 36;

  const maxW = pageW - margin * 2;
  const maxH = pageH - margin * 2 - 140;

  function addChartPage(pageTitle: string, chartCanvas: HTMLCanvasElement) {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(14);
    pdf.text(pageTitle, margin, margin);

    const imgData = chartCanvas.toDataURL("image/png");
    const imgW = chartCanvas.width;
    const imgH = chartCanvas.height;
    const ratio = Math.min(maxW / imgW, maxH / imgH);
    const drawW = imgW * ratio;
    const drawH = imgH * ratio;

    const chartX = margin;
    const chartY = margin + 18;
    pdf.addImage(imgData, "PNG", chartX, chartY, drawW, drawH);
    return { chartY, drawH };
  }

  const titleText = title || "Needlepoint Pattern";
  const firstPage = addChartPage(titleText, canvas);

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);

  const legendY = firstPage.chartY + firstPage.drawH + 18;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(12);
  pdf.text("Legend (used colors)", margin, legendY);

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);

  let y = legendY + 14;
  const swatch = 10;

  usedColors.slice(0, 30).forEach(({ color, count }) => {
    // jsPDF setFillColor expects RGB; parse hex
    const rgb = hexToRgb(color.hex);
    if (rgb) {
      pdf.setFillColor(rgb.r, rgb.g, rgb.b);
      pdf.rect(margin, y - swatch + 2, swatch, swatch, "F");
    }
    const symbol = symbolForColorId(color.id, symbolMap);
    if (symbol) {
      const textColor = rgb ? contrastForRgb(rgb.r, rgb.g, rgb.b) : { r: 0, g: 0, b: 0 };
      pdf.setTextColor(textColor.r, textColor.g, textColor.b);
      pdf.text(symbol, margin + swatch / 2, y, { align: "center" });
    }
    pdf.setTextColor(0, 0, 0);
    pdf.text(
      `${symbol ? `${symbol}  ` : ""}${color.code ? `#${color.code} ` : ""}${color.name}  ${color.hex}  (cells: ${count})`,
      margin + swatch + 8,
      y
    );
    y += 14;
  });

  const symbolCanvas = renderSymbolCanvas({ grid, paletteById, symbolMap, width, height, cellSize });
  pdf.addPage();
  addChartPage(`${titleText} (Symbols Only)`, symbolCanvas);

  pdf.save(`${sanitizeFilename(title || "needlepoint-pattern")}.pdf`);
}

function renderSymbolCanvas(opts: {
  grid: Uint16Array;
  paletteById: Map<number, Color>;
  symbolMap?: Map<number, string>;
  width: number;
  height: number;
  cellSize: number;
}) {
  const { grid, paletteById, symbolMap, width, height, cellSize } = opts;
  const canvas = document.createElement("canvas");
  const canvasW = width * cellSize;
  const canvasH = height * cellSize;
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvasW, canvasH);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const colorId = grid[idx(x, y, width)];
      if (colorId === 0) continue;
      const color = paletteById.get(colorId);
      if (!color) continue;
      const symbol = symbolForColorId(color.id, symbolMap);
      if (!symbol) continue;
      ctx.save();
      ctx.fillStyle = "#000000";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `700 ${Math.max(10, Math.floor(cellSize * 0.7))}px ui-sans-serif, system-ui, sans-serif`;
      ctx.fillText(symbol, x * cellSize + cellSize / 2, y * cellSize + cellSize / 2 + 0.5);
      ctx.restore();
    }
  }

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

  return canvas;
}

function hexToRgb(hex: string) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return null;
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

function contrastForRgb(r: number, g: number, b: number) {
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.6 ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 };
}

function sanitizeFilename(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
