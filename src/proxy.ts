import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/session";

const MAINTENANCE_BYPASS_COOKIE = "maintenance_bypass";
const STATUS_CACHE_MS = 5_000;
const STATUS_FAILURE_CACHE_MS = 2_000;
const STATUS_TIMEOUT_MS = 3_000;

let statusCache: { value: boolean; expiresAt: number } | null = null;

// The proxy runs as a Netlify Edge Function, where the pg driver behind
// Prisma can't load, so it must not import @/lib/prisma (directly or via
// @/lib/siteSettings). It asks /api/site-status instead. Fail-open like
// isMaintenanceOn(): if the status can't be fetched, the site stays reachable.
async function isMaintenanceOn(req: NextRequest): Promise<boolean> {
  if (process.env.MAINTENANCE_MODE === "true") return true;

  const now = Date.now();
  if (statusCache && statusCache.expiresAt > now) return statusCache.value;

  try {
    const res = await fetch(new URL("/api/site-status", req.url), {
      cache: "no-store",
      signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const { maintenance } = (await res.json()) as { maintenance?: boolean };
    const value = maintenance === true;
    statusCache = { value, expiresAt: now + STATUS_CACHE_MS };
    return value;
  } catch (err) {
    console.error("proxy: could not fetch /api/site-status, treating maintenance as off:", err);
    statusCache = { value: false, expiresAt: now + STATUS_FAILURE_CACHE_MS };
    return false;
  }
}

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

  if (isMaintenanceGatedPath(pathname) && !hasBypassCookie && (await isMaintenanceOn(req))) {
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
