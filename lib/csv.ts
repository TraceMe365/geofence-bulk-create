import type { Zone } from "./types";

// Minimal CSV parser (handles quoted fields, commas in quotes) — same logic as import.js
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (c === '"' && next === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && next === "\n") i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += c;
      }
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0].trim() !== ""));
}

export function csvToZones(
  text: string,
  defaultRadius: number
): { zones: Zone[]; warnings: string[] } {
  const rows = parseCsv(text);
  const warnings: string[] = [];

  if (rows.length === 0) {
    throw new Error("CSV is empty.");
  }

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idxName = header.indexOf("name");
  const idxLat = header.indexOf("latitude");
  const idxLng = header.indexOf("longitude");
  const idxRadius = header.indexOf("radius");

  if (idxName === -1 || idxLat === -1 || idxLng === -1) {
    throw new Error(
      `CSV header must include name,latitude,longitude. Found: ${header.join(", ")}`
    );
  }

  const zones: Zone[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every((v) => v.trim() === "")) continue;

    const name = (r[idxName] || "").trim();
    const lat = parseFloat(r[idxLat]);
    const lng = parseFloat(r[idxLng]);
    const radius =
      idxRadius !== -1 && r[idxRadius] && !isNaN(parseFloat(r[idxRadius]))
        ? parseFloat(r[idxRadius])
        : defaultRadius;

    if (!name) {
      warnings.push(`Row ${i + 1}: missing name, skipping`);
      continue;
    }
    if (isNaN(lat) || isNaN(lng)) {
      warnings.push(`Row ${i + 1} (${name}): invalid lat/lng, skipping`);
      continue;
    }

    zones.push({ name, lat, lng, radius });
  }

  return { zones, warnings };
}
