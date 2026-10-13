import type { Zone } from "./types";

export const DEFAULT_BASE_URL = "https://hst-api.wialon.com/wialon/ajax.html";

export function argbColor(r: number, g: number, b: number, opacityPercent: number): number {
  const alpha = Math.round((opacityPercent / 100) * 255);
  return alpha * 16777216 + r * 65536 + g * 256 + b; // avoids 32-bit signed bitwise overflow
}

export function buildZoneCall(resourceId: number, zone: Zone, color: number) {
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
      c: color,
      min: 0,
      max: 18,
      p: [{ x: zone.lng, y: zone.lat, r: zone.radius }],
    },
  };
}

async function postForm(baseUrl: string, body: URLSearchParams): Promise<unknown> {
  const res = await fetch(baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `Wialon returned non-JSON response (HTTP ${res.status}). First 300 chars: ${text.slice(0, 300)}`
    );
  }
}

export async function login(baseUrl: string, token: string): Promise<string> {
  const body = new URLSearchParams();
  body.set("svc", "token/login");
  body.set("params", JSON.stringify({ token }));

  const data = (await postForm(baseUrl, body)) as { eid?: string; error?: number; reason?: string };
  if (!data || !data.eid) {
    throw new Error(`Login failed: ${JSON.stringify(data)}`);
  }
  return data.eid;
}

export async function sendBatch(
  baseUrl: string,
  sid: string,
  calls: ReturnType<typeof buildZoneCall>[]
): Promise<unknown> {
  const body = new URLSearchParams();
  body.set("svc", "core/batch");
  body.set("params", JSON.stringify({ params: calls, flags: 0 }));
  body.set("sid", sid);
  return postForm(baseUrl, body);
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}
