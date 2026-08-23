import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { researchAdminApi, researchApi, type ApiResult } from "../../../../contract/client";
import { ADMIN_SESSION_COOKIE, verifyAdminSession } from "../../../../lib/admin-auth";

interface Context { params: { path: string[] } }

async function handle(request: NextRequest, context: Context): Promise<NextResponse> {
  const password = process.env.ADMIN_PASSWORD;
  if (!password || !(await verifyAdminSession(cookies().get(ADMIN_SESSION_COOKIE)?.value, password))) {
    return NextResponse.json({ message: "Требуется авторизация." }, { status: 401 });
  }

  const path = `/api/v1/${context.params.path.map(encodeURIComponent).join("/")}`;
  const query = Object.fromEntries(request.nextUrl.searchParams);
  const method = request.method as "GET" | "POST" | "PUT" | "DELETE";
  const body = method === "GET" || method === "DELETE" ? undefined : await request.json();
  const deletesProtocol = method === "DELETE" && /^\/api\/v1\/protocols\/[^/]+$/.test(path);
  const call = deletesProtocol ? researchAdminApi : researchApi;
  const result = await call<unknown>(path, { method, query, body });
  return response(result);
}

function response(result: ApiResult<unknown>): NextResponse {
  if (result.ok) {
    return result.status === 204
      ? new NextResponse(null, { status: 204 })
      : NextResponse.json(result.data, { status: result.status });
  }
  return NextResponse.json({ message: result.message }, { status: result.status ?? 502 });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
