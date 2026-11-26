import Script from "next/script";

// Umami (cookieless analytics, no consent banner needed). Rendered only in
// the customer-facing (site) layout, so the admin panel and the maintenance
// page are never tracked. Without NEXT_PUBLIC_UMAMI_WEBSITE_ID (local dev,
// by default) nothing loads at all. Page views, including client-side
// navigations, are tracked by the script itself; custom events go through
// src/lib/analytics.ts or data-umami-event attributes on links.

// Umami ignores visits on any other hostname, so localhost and Netlify's
// *.netlify.app URLs never pollute the real numbers even with the ID set.
const TRACKED_DOMAINS = "weeklytable.co.uk,www.weeklytable.co.uk";

export default function Analytics() {
  const websiteId = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;
  if (!websiteId) return null;

  return (
    <Script
      src="https://cloud.umami.is/script.js"
      data-website-id={websiteId}
      data-domains={TRACKED_DOMAINS}
      strategy="afterInteractive"
    />
  );
}
