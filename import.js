#!/usr/bin/env node
/**
 * wialon-import-geofences.js
 *
 * Bulk-create circular geofences in Wialon from a CSV file.
 *
 * CSV format (header required):
 *   name,latitude,longitude
 *   Warehouse A,60.1699,24.9384
 *   Depot North,60.2055,24.6559
 *
 * Optional 4th column "radius" (meters) — defaults to RADIUS_DEFAULT below if omitted.
 *
 * Usage:
 *   node wialon-import-geofences.js <csv-file> --token=<wialon-token> --resource=<resourceId> [--url=<base-url>]
 *
 * Requires Node 18+ (uses global fetch).
 * Example Command:
 * node wialon-import-geofences.js Book1.csv --token=ABC123 --resource=29982789 
 * Token can be created using the following URL: https://hosting.wialon.com/login.html?access_type=1024
 */

const fs = require("fs");
const path = require("path");

// ---------- Config ----------
const RADIUS_DEFAULT = 100; // meters, used if CSV has no radius column
const ZONE_OPACITY_PERCENT = 70; // 0-100, applied to the geofence fill/outline color
const ZONE_RGB = { r: 0xc9, g: 0x91, b: 0xe4 }; // same pink/purple used previously

function argbColor(r, g, b, opacityPercent) {
  const alpha = Math.round((opacityPercent / 100) * 255);
  return alpha * 16777216 + r * 65536 + g * 256 + b; // avoids 32-bit signed bitwise overflow
}

const ZONE_COLOR = argbColor(ZONE_RGB.r, ZONE_RGB.g, ZONE_RGB.b, ZONE_OPACITY_PERCENT);
const BATCH_CHUNK_SIZE = 100; // zones per core/batch request
const DEFAULT_BASE_URL = "https://hst-api.wialon.com/wialon/ajax.html";

// ---------- Arg parsing ----------
function parseArgs(argv) {
  const args = { _: [] };
  for (const raw of argv) {
    if (raw.startsWith("--")) {
      const [key, ...rest] = raw.slice(2).split("=");
      args[key] = rest.length ? rest.join("=") : true;
    } else {
      args._.push(raw);
    }
  }
  return args;
}

// ---------- Minimal CSV parser (handles quoted fields, commas in quotes) ----------
function parseCsv(text) {
  const rows = [];
  let row = [];
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

function loadZonesFromCsv(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const rows = parseCsv(raw);
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

  const zones = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every((v) => v.trim() === "")) continue;

    const name = (r[idxName] || "").trim();
    const lat = parseFloat(r[idxLat]);
    const lng = parseFloat(r[idxLng]);
    const radius =
      idxRadius !== -1 && r[idxRadius] && !isNaN(parseFloat(r[idxRadius]))
        ? parseFloat(r[idxRadius])
        : RADIUS_DEFAULT;

    if (!name) {
      console.warn(`Row ${i + 1}: missing name, skipping`);
      continue;
    }
    if (isNaN(lat) || isNaN(lng)) {
      console.warn(`Row ${i + 1} (${name}): invalid lat/lng, skipping`);
      continue;
    }

    zones.push({ name, lat, lng, radius });
  }

  return zones;
}

// ---------- Wialon API helpers ----------
function buildZoneCall(resourceId, zone) {
  return {
    svc: "resource/update_zone",
    params: {
      itemId: resourceId,
      id: 0,
      callMode: "create",
      n: zone.name,
      d: "",
      t: 3, // 1=line, 2=polygon, 3=circle
      w: zone.radius, // radius in meters (also required at top level, not just inside p[])
      f: 48, // 0x10 (16) mandatory for radius/width to apply + 0x20 (32) show shape on map
      c: ZONE_COLOR,
      min: 0,
      max: 18,
      p: [{ x: zone.lng, y: zone.lat, r: zone.radius }],
    },
  };
}

async function wialonRequest(baseUrl, svc, params) {
  const body = new URLSearchParams();
  body.set("svc", svc);
  body.set("params", JSON.stringify(params));

  const res = await fetch(baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(
      `Wialon returned non-JSON response (HTTP ${res.status}). First 300 chars: ${text.slice(0, 300)}`
    );
  }
}

async function login(baseUrl, token) {
  const data = await wialonRequest(baseUrl, "token/login", { token });
  if (!data || !data.eid) {
    throw new Error(`Login failed: ${JSON.stringify(data)}`);
  }
  return data.eid; // session id
}

async function sendBatch(baseUrl, sid, calls) {
  const body = new URLSearchParams();
  body.set("svc", "core/batch");
  body.set("params", JSON.stringify({ params: calls, flags: 0 }));
  body.set("sid", sid);

  const res = await fetch(baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(
      `Wialon returned non-JSON response (HTTP ${res.status}). First 300 chars: ${text.slice(0, 300)}`
    );
  }
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

// ---------- Main ----------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const csvPath = args._[0];
  const token = args.token;
  const resourceId = args.resource ? Number(args.resource) : null;
  const baseUrl = args.url || DEFAULT_BASE_URL;

  if (!csvPath || !token || !resourceId) {
    console.error(
      "Usage: node wialon-import-geofences.js <csv-file> --token=<token> --resource=<resourceId> [--url=<base-url>]"
    );
    process.exit(1);
  }

  const fullPath = path.resolve(csvPath);
  console.log(`Reading zones from ${fullPath}...`);
  const zones = loadZonesFromCsv(fullPath);
  console.log(`Parsed ${zones.length} valid rows.`);

  if (zones.length === 0) {
    console.log("Nothing to import.");
    return;
  }

  console.log("Logging in to Wialon...");
  const sid = await login(baseUrl, token);
  console.log("Logged in, session:", sid);

  const calls = zones.map((z) => buildZoneCall(resourceId, z));
  const batches = chunk(calls, BATCH_CHUNK_SIZE);

  let created = 0;
  let failed = 0;

  for (let b = 0; b < batches.length; b++) {
    console.log(`Sending batch ${b + 1}/${batches.length} (${batches[b].length} zones)...`);
    const result = await sendBatch(baseUrl, sid, batches[b]);

    if (!Array.isArray(result)) {
      console.error("Unexpected batch response:", JSON.stringify(result));
      failed += batches[b].length;
      continue;
    }

    result.forEach((r, idx) => {
      const zoneName = batches[b][idx].params.n;
      // Success response is [zoneId, zoneDataObject]; error response is {"error": <code>}
      if (Array.isArray(r) && typeof r[0] === "number") {
        created++;
      } else {
        failed++;
        console.warn(`Failed to create zone "${zoneName}":`, JSON.stringify(r));
      }
    });
  }

  console.log(`\nDone. Created: ${created}, Failed: ${failed}, Total: ${zones.length}`);
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
