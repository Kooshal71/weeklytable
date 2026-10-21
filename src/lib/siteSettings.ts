import { prisma } from "@/lib/prisma";

const CACHE_MS = 5_000;
const FAILURE_CACHE_MS = 2_000;

let cache: { value: boolean; expiresAt: number } | null = null;

// Maintenance is on if the MAINTENANCE_MODE env var forces it (needs a
// redeploy to change) OR the admin-controlled DB switch is on (instant).
// Cached briefly so the proxy isn't querying the database on every request,
// and fail-open: if the database can't be read, the site stays reachable
// rather than locking every customer out.
export async function isMaintenanceOn(): Promise<boolean> {
  if (process.env.MAINTENANCE_MODE === "true") return true;

  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.value;

  try {
    const row = await prisma.siteSetting.findUnique({
      where: { id: "default" },
      select: { maintenanceMode: true },
    });
    const value = row?.maintenanceMode ?? false;
    cache = { value, expiresAt: now + CACHE_MS };
    return value;
  } catch (err) {
    console.error("isMaintenanceOn: could not read SiteSetting, treating as off:", err);
    cache = { value: false, expiresAt: now + FAILURE_CACHE_MS };
    return false;
  }
}
