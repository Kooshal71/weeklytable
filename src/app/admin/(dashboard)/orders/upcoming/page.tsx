import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/dal";
import { getDateWindow, getWeekday } from "@/lib/cutoff";
import { formatTime12h } from "@/lib/deliveryTime";
import { formatDeliveryAddress } from "@/lib/address";
import PrintButton from "@/components/admin/PrintButton";

export const dynamic = "force-dynamic";

const REPORT_DAYS = 14;

function formatShortDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const monthName = new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(
    "en-GB",
    { month: "short", timeZone: "UTC" },
  );
  return `${day} ${monthName} ${year}`;
}

function formatDayHeading(date: string) {
  const weekday = getWeekday(date);
  const label = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  return `${label}, ${formatShortDate(date)}`;
}

export default async function UpcomingOrdersPage() {
  const session = await requireRole(["owner", "kitchen", "delivery"]);
  const cutoffConfig = await prisma.cutoffConfig.findUniqueOrThrow({
    where: { id: "default" },
  });

  const window = getDateWindow(cutoffConfig.timezone, REPORT_DAYS);
  const thisWeek = window.slice(0, 7);
  const nextWeek = window.slice(7, 14);

  const rangeStart = new Date(`${window[0]}T00:00:00.000Z`);
  const rangeEnd = new Date(`${window[window.length - 1]}T00:00:00.000Z`);

  const items = await prisma.orderItem.findMany({
    where: {
      deliveryDate: { gte: rangeStart, lte: rangeEnd },
      order: {
        status: { not: "cancelled" },
        NOT: { status: "pending_payment", paymentMethod: "stripe" },
      },
    },
    orderBy: [{ deliveryDate: "asc" }, { deliveryTime: "asc" }],
    include: {
      order: {
        select: {
          contactName: true,
          contactPhone: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          postcode: true,
          paymentMethod: true,
          status: true,
          notes: true,
        },
      },
    },
  });

  const itemsByDate = new Map<string, typeof items>();
  for (const item of items) {
    const key = item.deliveryDate.toISOString().slice(0, 10);
    const existing = itemsByDate.get(key);
    if (existing) existing.push(item);
    else itemsByDate.set(key, [item]);
  }

  function renderWeek(label: string, dates: string[]) {
    return (
      <section className="flex flex-col gap-6">
        <h2 className="font-semibold text-lg text-neutral-900 print:text-base">
          {label} ({formatShortDate(dates[0])} –{" "}
          {formatShortDate(dates[dates.length - 1])})
        </h2>
        {dates.map((date) => {
          const dayItems = itemsByDate.get(date) ?? [];
          const prepCounts = new Map<string, number>();
          for (const item of dayItems) {
            prepCounts.set(
              item.dishNameSnapshot,
              (prepCounts.get(item.dishNameSnapshot) ?? 0) + 1,
            );
          }
          const sortedByTime = [...dayItems].sort((a, b) =>
            (a.deliveryTime ?? "").localeCompare(b.deliveryTime ?? ""),
          );

          return (
            <div
              key={date}
              className="break-inside-avoid rounded-lg border border-neutral-200 p-4 print:border-neutral-400"
            >
              <h3 className="font-medium text-neutral-900">
                {formatDayHeading(date)}
              </h3>

              {dayItems.length === 0 ? (
                <p className="mt-2 text-sm text-neutral-700">
                  No deliveries scheduled.
                </p>
              ) : (
                <>
                  <p className="mt-2 text-sm text-neutral-700">
                    <span className="font-medium">Prep: </span>
                    {Array.from(prepCounts.entries())
                      .map(([dish, count]) => `${dish} ×${count}`)
                      .join(", ")}
                  </p>

                  <table className="mt-3 w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-neutral-200 text-left text-neutral-700">
                        <th className="py-1.5 pr-3">Time</th>
                        <th className="py-1.5 pr-3">Dish</th>
                        <th className="py-1.5 pr-3">Customer</th>
                        <th className="py-1.5 pr-3">Phone</th>
                        <th className="py-1.5 pr-3">Address</th>
                        <th className="py-1.5 pr-3">Payment</th>
                        <th className="py-1.5 pr-3">Notes</th>
                        <th className="py-1.5 pr-3">Done</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedByTime.map((item) => (
                        <tr
                          key={item.id}
                          className={`border-b border-neutral-100 ${item.fulfilled ? "text-neutral-600" : ""}`}
                        >
                          <td className="py-1.5 pr-3 whitespace-nowrap">
                            {item.deliveryTime
                              ? formatTime12h(item.deliveryTime)
                              : "—"}
                          </td>
                          <td className="py-1.5 pr-3">
                            {item.dishNameSnapshot}
                          </td>
                          <td className="py-1.5 pr-3">
                            {item.order.contactName}
                          </td>
                          <td className="py-1.5 pr-3 whitespace-nowrap">
                            {item.order.contactPhone}
                          </td>
                          <td className="py-1.5 pr-3">
                            {formatDeliveryAddress(item.order)}
                          </td>
                          <td className="py-1.5 pr-3 whitespace-nowrap">
                            {item.order.paymentMethod === "cash"
                              ? "Cash"
                              : "Card"}
                          </td>
                          <td className="py-1.5 pr-3">
                            {item.order.notes ?? ""}
                          </td>
                          <td className="py-1.5 pr-3">
                            {item.fulfilled ? "✓" : ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          );
        })}
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-semibold">Upcoming deliveries</h1>
          {session.role !== "delivery" && (
            <Link
              href="/admin/orders"
              className="text-sm text-neutral-600 underline"
            >
              ← Back to all orders
            </Link>
          )}
        </div>
        <PrintButton />
      </div>

      {renderWeek("This week", thisWeek)}
      {renderWeek("Next week", nextWeek)}
    </div>
  );
}
