import { getZones, login, logout, DEFAULT_BASE_URL } from "@/lib/wialon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ZonesRequestBody {
  token?: string;
  resourceId?: number;
  baseUrl?: string;
}

export async function POST(req: Request) {
  let body: ZonesRequestBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  const resourceId = Number(body.resourceId);
  const baseUrl = typeof body.baseUrl === "string" && body.baseUrl.trim() ? body.baseUrl.trim() : DEFAULT_BASE_URL;

  if (!token) return Response.json({ error: "Missing token." }, { status: 400 });
  if (!resourceId || Number.isNaN(resourceId)) {
    return Response.json({ error: "Missing or invalid resourceId." }, { status: 400 });
  }

  try {
    const sid = await login(baseUrl, token);
    try {
      const zones = await getZones(baseUrl, sid, resourceId);
      return Response.json({ zones });
    } finally {
      await logout(baseUrl, sid);
    }
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
