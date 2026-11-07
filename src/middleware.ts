import { NextResponse, type NextRequest } from "next/server";

/**
 * Publishes the request path as a header.
 *
 * Server layouts cannot read the current pathname, and the MFA gate needs it
 * to let the security page itself through while blocking everything else.
 * Deliberately does no database work: middleware runs on every request, and
 * the actual policy check belongs in the layout where the session is resolved.
 */
export function middleware(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set("x-tb-pathname", request.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: [
    // Everything except static assets and the cron endpoints.
    "/((?!_next/static|_next/image|favicon.ico|api/cron).*)",
  ],
};
