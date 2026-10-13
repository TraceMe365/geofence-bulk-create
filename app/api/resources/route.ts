import { login, logout, searchResources, DEFAULT_BASE_URL } from "@/lib/wialon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ResourcesRequestBody {
  token?: string;
  baseUrl?: string;
}

export async function POST(req: Request) {
  let body: ResourcesRequestBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  const baseUrl = typeof body.baseUrl === "string" && body.baseUrl.trim() ? body.baseUrl.trim() : DEFAULT_BASE_URL;

  if (!token) {
    return Response.json({ error: "Missing token." }, { status: 400 });
  }

  try {
    const sid = await login(baseUrl, token);
    try {
      const resources = await searchResources(baseUrl, sid);
      return Response.json({ resources });
    } finally {
      await logout(baseUrl, sid);
    }
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
