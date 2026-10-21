import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/dal";
import { setMaintenanceMode, updateCutoffConfig } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  await requireRole(["owner"]);
  const config = await prisma.cutoffConfig.findUniqueOrThrow({
    where: { id: "default" },
  });

  const siteSetting = await prisma.siteSetting.findUnique({
    where: { id: "default" },
  });
  const maintenanceOn = siteSetting?.maintenanceMode ?? false;
  const forcedByEnv = process.env.MAINTENANCE_MODE === "true";

  return (
    <div className="flex flex-col gap-4">
      <section className="flex max-w-md flex-col gap-2 rounded-md border border-neutral-300 p-4">
        <h2 className="text-lg font-semibold">Maintenance mode</h2>
        <p className="text-sm text-neutral-600">
          While on, customers see a &ldquo;back soon&rdquo; page instead of the
          site. This admin area keeps working, so you can always switch it back
          off here. Changes apply within a few seconds.
        </p>
        <p className="text-sm font-medium">
          Currently: {maintenanceOn ? "ON (site hidden from customers)" : "OFF (site is live)"}
        </p>
        {forcedByEnv && (
          <p className="text-sm text-red-700">
            The MAINTENANCE_MODE environment variable is set to true, which
            keeps the site in maintenance regardless of this switch.
          </p>
        )}
        <form action={setMaintenanceMode}>
          <input type="hidden" name="enabled" value={maintenanceOn ? "false" : "true"} />
          <button
            type="submit"
            className="w-fit rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
          >
            {maintenanceOn ? "Turn maintenance OFF" : "Turn maintenance ON"}
          </button>
        </form>
      </section>

      <h1 className="text-2xl font-semibold">Order &amp; delivery settings</h1>
      <p className="max-w-md text-sm text-neutral-600">
        Orders for a given delivery date must be placed at least this many
        days ahead, by this time of day (in the given timezone) on the day
        before the cutoff window closes. The delivery window controls which
        time slots customers can request (30-minute increments) — we
        guarantee delivery within 1 hour of the requested time.
      </p>

      <form action={updateCutoffConfig} className="flex max-w-xs flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Lead days
          <input
            type="number"
            name="leadDays"
            min={1}
            defaultValue={config.leadDays}
            className="rounded-md border border-neutral-300 px-3 py-2"
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Cutoff time (24h)
          <input
            type="time"
            name="cutoffTime"
            defaultValue={config.cutoffTime}
            className="rounded-md border border-neutral-300 px-3 py-2"
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Timezone
          <input
            type="text"
            name="timezone"
            defaultValue={config.timezone}
            className="rounded-md border border-neutral-300 px-3 py-2"
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Delivery window start (24h)
          <input
            type="time"
            name="deliveryWindowStart"
            defaultValue={config.deliveryWindowStart}
            className="rounded-md border border-neutral-300 px-3 py-2"
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Delivery window end (24h)
          <input
            type="time"
            name="deliveryWindowEnd"
            defaultValue={config.deliveryWindowEnd}
            className="rounded-md border border-neutral-300 px-3 py-2"
            required
          />
        </label>
        <button
          type="submit"
          className="mt-2 w-fit rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
        >
          Save
        </button>
      </form>
    </div>
  );
}
