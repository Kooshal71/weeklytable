import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/session";
import { isMaintenanceOn } from "@/lib/siteSettings";

const MAINTENANCE_BYPASS_COOKIE = "maintenance_bypass";

// /admin is excluded because it has its own session gate (and is where the
// owner switches maintenance back off), and /api is excluded because Stripe's
// webhook calls (and our own bypassed testing) need to keep working while the
// public site is gated.
function isMaintenanceGatedPath(pathname: string) {
  return (
    pathname !== "/maintenance" &&
    !pathname.startsWith("/admin") &&
    !pathname.startsWith("/api")
  );
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // A visitor already holding the bypass cookie skips the maintenance check
  // entirely, so previewing never costs a settings lookup.
  const hasBypassCookie = req.cookies.get(MAINTENANCE_BYPASS_COOKIE)?.value === "1";

  if (isMaintenanceGatedPath(pathname) && !hasBypassCookie && (await isMaintenanceOn())) {
    const bypassSecret = process.env.MAINTENANCE_BYPASS_SECRET;
    const previewParam = req.nextUrl.searchParams.get("preview");
    const hasValidPreview = Boolean(bypassSecret) && previewParam === bypassSecret;

    if (!hasValidPreview) {
      return NextResponse.redirect(new URL("/maintenance", req.url));
    }

    const res = NextResponse.next();
    res.cookies.set(MAINTENANCE_BYPASS_COOKIE, "1", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24,
    });
    return res;
  }

  // Optimistic check only (cookie-signature verification, no DB read) — per
  // Next.js's own guidance, Proxy pre-filters and redirects unauthenticated
  // requests, but every Server Action/Route Handler under /admin also calls
  // requireAdminSession() (src/lib/dal.ts) as the authoritative check. Proxy
  // alone is not a full authorization solution.
  if (pathname.startsWith("/admin")) {
    const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    const session = token ? await verifySessionToken(token) : null;

    const isLoginPage = pathname === "/admin/login";

    if (!session && !isLoginPage) {
      const loginUrl = new URL("/admin/login", req.url);
      return NextResponse.redirect(loginUrl);
    }

    if (session && isLoginPage) {
      return NextResponse.redirect(new URL("/admin", req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
