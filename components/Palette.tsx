"use client";

import React, { useMemo, useState } from "react";
import type { Color } from "../lib/grid";

type Props = {
  palette: Color[];
  extractedIds?: number[];
  showExtractedFilter?: boolean;
  activeColorId: number;
  onSelect: (id: number) => void;
  remapSourceId?: number | null;
  onRemapSelect?: (id: number) => void;
  onAddColor: (name: string, hex: string) => void;
};

export default function Palette({
  palette,
  extractedIds,
  showExtractedFilter = true,
  activeColorId,
  onSelect,
  remapSourceId,
  onRemapSelect,
  onAddColor,
}: Props) {
  const [newHex, setNewHex] = useState("#c9b08b");
  const [newName, setNewName] = useState("Custom");
  const [activeFamily, setActiveFamily] = useState("All");
  const [query, setQuery] = useState("");
  const sortedPalette = useMemo(() => {
    const toHsv = (hex: string) => {
      const value = hex.replace("#", "");
      const r = parseInt(value.slice(0, 2), 16) / 255;
      const g = parseInt(value.slice(2, 4), 16) / 255;
      const b = parseInt(value.slice(4, 6), 16) / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const delta = max - min;
      let h = 0;
      if (delta) {
        if (max === r) h = ((g - b) / delta) % 6;
        else if (max === g) h = (b - r) / delta + 2;
        else h = (r - g) / delta + 4;
        h = Math.round(h * 60);
        if (h < 0) h += 360;
      }
      const s = max === 0 ? 0 : delta / max;
      const v = max;
      return { h, s, v };
    };
    return [...palette].sort((a, b) => {
      const ahsv = toHsv(a.hex);
      const bhsv = toHsv(b.hex);
      if (ahsv.h !== bhsv.h) return ahsv.h - bhsv.h;
      if (ahsv.s !== bhsv.s) return ahsv.s - bhsv.s;
      return ahsv.v - bhsv.v;
    });
  }, [palette]);
  const families = useMemo(() => {
    const set = new Set<string>();
    palette.forEach((c) => {
      if (c.family) set.add(c.family);
    });
    set.delete("Extracted");
    const order = [
      "All",
      "Red",
      "Pink",
      "Orange",
      "Yellow",
      "Green",
      "Blue",
      "Purple",
      "Brown",
      "Beige",
      "Gray",
      "White",
      "Black",
      "Custom",
    ];
    const rest = Array.from(set).filter((f) => !order.includes(f)).sort();
    return ["All", ...order.filter((f) => f !== "All" && set.has(f)), ...rest];
  }, [palette]);
  const extractedSet = useMemo(() => new Set(extractedIds ?? []), [extractedIds]);
  const hasExtracted = extractedSet.size > 0;
  const filteredPalette = useMemo(() => {
    const familyFiltered =
      activeFamily === "Extracted"
        ? sortedPalette.filter((c) => extractedSet.has(c.id))
        : activeFamily === "All"
          ? sortedPalette
          : sortedPalette.filter((c) => c.family === activeFamily);
    const q = query.trim().toLowerCase();
    if (!q) return familyFiltered;
    return familyFiltered.filter((c) => {
      const name = c.name.toLowerCase();
      const code = (c.code ?? "").toLowerCase();
      return name.includes(q) || code.includes(q) || `#${code}`.includes(q);
    });
  }, [sortedPalette, activeFamily, query, extractedSet]);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div>
        <div style={{ display: "grid", gap: 8, marginBottom: 8 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or #DMC"
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid var(--panel-border)",
              background: "transparent",
              color: "var(--foreground)",
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, opacity: 0.7 }}>Family</span>
            <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
              <select
                value={activeFamily === "Extracted" ? "All" : activeFamily}
                onChange={(e) => setActiveFamily(e.target.value)}
                style={{
                  padding: "6px 28px 6px 10px",
                  borderRadius: 8,
                  border: "none",
                  background: "#f3f3f3",
                  color: "var(--foreground)",
                  fontWeight: 600,
                  appearance: "none",
                  WebkitAppearance: "none",
                  MozAppearance: "none",
                }}
              >
                {families.map((family) => (
                  <option key={family} value={family}>
                    {family}
                  </option>
                ))}
              </select>
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  right: 8,
                  fontSize: 12,
                  opacity: 0.6,
                  pointerEvents: "none",
                }}
              >
                ▾
              </span>
            </div>
            {showExtractedFilter && hasExtracted && (
              <button
                type="button"
                onClick={() => setActiveFamily(activeFamily === "Extracted" ? "All" : "Extracted")}
                style={{
                  padding: "6px 8px",
                  borderRadius: 8,
                  border: activeFamily === "Extracted" ? "1px solid #c26d9a" : "none",
                  background: activeFamily === "Extracted" ? "rgb(255 224 237)" : "#f3f3f3",
                  color: activeFamily === "Extracted" ? "#a84a7b" : "var(--foreground)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  textAlign: "center",
                }}
              >
                <span style={{ display: "block", lineHeight: 1.1, textAlign: "center" }}>
                  <span style={{ display: "block" }}>Image</span>
                  <span style={{ display: "block" }}>Colors</span>
                </span>
              </button>
            )}
          </div>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(42px, 1fr))",
            gap: 8,
            maxHeight: 220,
            overflowY: "auto",
            paddingRight: 4,
            overscrollBehavior: "contain",
          }}
        >
          {filteredPalette.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                if (remapSourceId != null && onRemapSelect) {
                  onRemapSelect(c.id);
                  return;
                }
                onSelect(c.id);
              }}
              style={{
                display: "grid",
                gap: 4,
                justifyItems: "center",
                padding: 4,
                borderRadius: 8,
                border:
                  remapSourceId === c.id
                    ? "2px solid var(--foreground)"
                    : c.id === activeColorId
                    ? "2px solid var(--foreground)"
                    : "1px solid rgba(255,255,255,0.4)",
                background: "transparent",
                cursor: "pointer",
              }}
              aria-label={`Select ${c.name}`}
              title={`${c.name} (${c.code ?? c.hex})`}
            >
              <span
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 6,
                  background: c.hex,
                  display: "inline-block",
                  boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.15)",
                }}
              />
              <span style={{ fontSize: 10, opacity: 0.75, lineHeight: 1 }}>{c.code ?? ""}</span>
            </button>
          ))}
        </div>
      </div>

      {false && (
      <div>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Add color</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="color"
            value={newHex}
            onChange={(e) => setNewHex(e.target.value)}
            style={{ width: 34, height: 34, borderRadius:8 }}
            aria-label="Pick color"
          />
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Name"
            style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.2)" }}
          />
          <button
            onClick={() => onAddColor(newName || "Custom", newHex)}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid var(--foreground)",
              background: "var(--foreground)",
              color: "var(--background)",
              cursor: "pointer",
            }}
          >
            Add
          </button>
        </div>
      </div>
      )}
    </div>
  );
}
