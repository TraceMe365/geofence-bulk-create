import { buildZoneCall, chunk, login, sendBatch, DEFAULT_BASE_URL } from "@/lib/wialon";
import type { Zone, BatchEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_ZONES = 5000;
const MAX_BATCH_SIZE = 500;

interface ImportRequestBody {
  token?: string;
  resourceId?: number;
  baseUrl?: string;
  color?: number;
  batchSize?: number;
  zones?: Zone[];
}

function isZone(value: unknown): value is Zone {
  if (!value || typeof value !== "object") return false;
  const z = value as Record<string, unknown>;
  return (
    typeof z.name === "string" &&
    z.name.trim() !== "" &&
    typeof z.lat === "number" &&
    typeof z.lng === "number" &&
    typeof z.radius === "number"
  );
}

export async function POST(req: Request) {
  let body: ImportRequestBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  const resourceId = Number(body.resourceId);
  const baseUrl = typeof body.baseUrl === "string" && body.baseUrl.trim() ? body.baseUrl.trim() : DEFAULT_BASE_URL;
  const color = typeof body.color === "number" ? body.color : 0xb291e4c9;
  const batchSize = Math.min(Math.max(Number(body.batchSize) || 100, 1), MAX_BATCH_SIZE);
  const zones = Array.isArray(body.zones) ? body.zones.filter(isZone) : [];

  if (!token) {
    return Response.json({ error: "Missing token." }, { status: 400 });
  }
  if (!resourceId || Number.isNaN(resourceId)) {
    return Response.json({ error: "Missing or invalid resourceId." }, { status: 400 });
  }
  if (zones.length === 0) return Response.json({ error: "No valid zones provided." }, { status: 400 });
  if (zones.length > MAX_ZONES) {
    return Response.json({ error: `Too many zones (max ${MAX_ZONES} per request).` }, { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: BatchEvent) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));

      try {
        send({ type: "status", message: "Logging in to Wialon..." });
        const sid = await login(baseUrl, token);
        send({ type: "status", message: "Logged in." });

        const calls = zones.map((z) => buildZoneCall(resourceId, z, color));
        const batches = chunk(calls, batchSize);

        let created = 0;
        let failed = 0;
        const failures: { name: string; error: unknown }[] = [];

        for (let b = 0; b < batches.length; b++) {
          const result = await sendBatch(baseUrl, sid, batches[b]);
          let batchCreated = 0;
          let batchFailed = 0;

          if (!Array.isArray(result)) {
            batchFailed = batches[b].length;
            failed += batchFailed;
            failures.push({ name: "(batch)", error: result });
          } else {
            result.forEach((r, idx) => {
              const zoneName = batches[b][idx].params.n;
              if (Array.isArray(r) && typeof r[0] === "number") {
                created++;
                batchCreated++;
              } else {
                failed++;
                batchFailed++;
                failures.push({ name: zoneName, error: r });
              }
            });
          }

          send({
            type: "batch",
            batchIndex: b + 1,
            totalBatches: batches.length,
            batchCreated,
            batchFailed,
            createdSoFar: created,
            failedSoFar: failed,
          });
        }

        send({ type: "done", created, failed, total: zones.length, failures });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
