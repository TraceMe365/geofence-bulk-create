import type { Zone } from "./types";

export const DEFAULT_BASE_URL = "https://hst-api.wialon.com/wialon/ajax.html";
export const DEFAULT_LOGIN_URL = "https://hosting.wialon.com/login.html";

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

export interface ResourceOption {
  id: number;
  name: string;
}

export async function searchResources(baseUrl: string, sid: string): Promise<ResourceOption[]> {
  const body = new URLSearchParams();
  body.set("svc", "core/search_items");
  body.set(
    "params",
    JSON.stringify({
      spec: { itemsType: "avl_resource", propName: "sys_name", propValueMask: "*", sortType: "sys_name" },
      force: 1,
      flags: 1,
      from: 0,
      to: 0xffffffff,
    })
  );
  body.set("sid", sid);

  const data = (await postForm(baseUrl, body)) as { items?: { id: number; nm: string }[]; error?: number };
  if (!data || !Array.isArray(data.items)) {
    throw new Error(`Failed to load resources: ${JSON.stringify(data)}`);
  }
  return data.items.map((item) => ({ id: item.id, name: item.nm }));
}

export interface GeofenceRecord {
  id: number;
  name: string;
  type: number;
  lat: number | null;
  lng: number | null;
  radius: number | null;
}

export async function getZones(baseUrl: string, sid: string, resourceId: number): Promise<GeofenceRecord[]> {
  const body = new URLSearchParams();
  body.set("svc", "resource/get_zone_data");
  body.set("params", JSON.stringify({ itemId: resourceId, flags: 0x1c }));
  body.set("sid", sid);

  const data = (await postForm(baseUrl, body)) as
    | { n: string; id: number; t: number; w?: number; p?: { x: number; y: number; r?: number }[]; b?: { cen_x: number; cen_y: number } }[]
    | { error?: number };

  if (!Array.isArray(data)) {
    throw new Error(`Failed to load geofences: ${JSON.stringify(data)}`);
  }

  return data.map((z) => {
    const point = z.p && z.p.length > 0 ? z.p[0] : null;
    const lng = point ? point.x : z.b ? z.b.cen_x : null;
    const lat = point ? point.y : z.b ? z.b.cen_y : null;
    const radius = point && typeof point.r === "number" ? point.r : typeof z.w === "number" ? z.w : null;
    return { id: z.id, name: z.n, type: z.t, lat, lng, radius };
  });
}

export async function logout(baseUrl: string, sid: string): Promise<void> {
  const body = new URLSearchParams();
  body.set("svc", "core/logout");
  body.set("params", "{}");
  body.set("sid", sid);
  await postForm(baseUrl, body).catch(() => undefined);
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
