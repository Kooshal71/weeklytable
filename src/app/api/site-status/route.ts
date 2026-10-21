import { NextResponse } from "next/server";
import { isMaintenanceOn } from "@/lib/siteSettings";

// Read by src/proxy.ts. The proxy runs as a Netlify Edge Function, which
// can't load the pg driver, so it asks this (Node) route instead of
// querying the database itself.
export async function GET() {
  return NextResponse.json(
    { maintenance: await isMaintenanceOn() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
