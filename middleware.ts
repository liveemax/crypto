import { NextRequest, NextResponse } from "next/server";

import { ADMIN_SESSION_COOKIE, verifyAdminSession } from "./src/lib/admin-auth";

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  if (!pathname.startsWith("/admin") && !pathname.startsWith("/api/admin")) {
    const requestHeaders = new Headers(request.headers);
    const locale = pathname.match(/^\/(ru|en)(?:\/|$)/)?.[1] ?? "ru";
    requestHeaders.set("x-site-locale", locale);
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  if (pathname === "/admin/login") return NextResponse.next();

  const password = process.env.ADMIN_PASSWORD;
  const authenticated =
    password !== undefined &&
    (await verifyAdminSession(request.cookies.get(ADMIN_SESSION_COOKIE)?.value, password));

  if (authenticated) return NextResponse.next();

  if (pathname.startsWith("/api/admin")) {
    return NextResponse.json({ message: "Требуется авторизация." }, { status: 401 });
  }

  const loginUrl = new URL("/admin/login", request.url);
  loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
