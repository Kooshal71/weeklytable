import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/dal";
import type { Prisma } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

const STATUSES = ["pending_payment", "paid", "fulfilled", "cancelled"] as const;
const PAYMENT_METHODS = ["stripe", "cash"] as const;
const SOURCES = ["web", "whatsapp"] as const;

function formatGbp(pence: number) {
  return `£${(pence / 100).toFixed(2)}`;
}

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    deliveryDate?: string;
    paymentMethod?: string;
    source?: string;
  }>;
}) {
  await requireRole(["owner", "kitchen"]);
  const params = await searchParams;

  const where: Prisma.OrderWhereInput = {};
  if (params.status) where.status = params.status as Prisma.OrderWhereInput["status"];
  if (params.paymentMethod) {
    where.paymentMethod = params.paymentMethod as Prisma.OrderWhereInput["paymentMethod"];
  }
  if (params.source) {
    where.source = params.source as Prisma.OrderWhereInput["source"];
  }
  if (params.deliveryDate) {
    // An order can now span several delivery dates (one per meal) — "filter
    // by date" means "orders with at least one meal on this date".
    where.items = {
      some: { deliveryDate: new Date(`${params.deliveryDate}T00:00:00.000Z`) },
    };
  }

  const orders = await prisma.order.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { items: { orderBy: { deliveryDate: "asc" } } },
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Orders</h1>
        <Link
          href="/admin/orders/upcoming"
          className="text-sm text-neutral-600 underline"
        >
          Upcoming deliveries (printable) →
        </Link>
      </div>

      <form method="GET" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Status
          <select
            name="status"
            defaultValue={params.status ?? ""}
            className="rounded-md border border-neutral-300 px-2 py-1"
          >
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Payment
          <select
            name="paymentMethod"
            defaultValue={params.paymentMethod ?? ""}
            className="rounded-md border border-neutral-300 px-2 py-1"
          >
            <option value="">All</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m === "cash" ? "Cash on delivery" : "Card (Stripe)"}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Placed via
          <select
            name="source"
            defaultValue={params.source ?? ""}
            className="rounded-md border border-neutral-300 px-2 py-1"
          >
            <option value="">All</option>
            {SOURCES.map((src) => (
              <option key={src} value={src}>
                {src === "whatsapp" ? "WhatsApp" : "Website"}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Has a meal on
          <input
            type="date"
            name="deliveryDate"
            defaultValue={params.deliveryDate ?? ""}
            className="rounded-md border border-neutral-300 px-2 py-1"
          />
        </label>
        <button
          type="submit"
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white"
        >
          Filter
        </button>
        {(params.status || params.deliveryDate || params.paymentMethod || params.source) && (
          <Link href="/admin/orders" className="text-sm text-neutral-600 underline">
            Clear
          </Link>
        )}
      </form>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-neutral-700">
            <th className="py-2 pr-4">Placed</th>
            <th className="py-2 pr-4">Delivery dates</th>
            <th className="py-2 pr-4">Plan</th>
            <th className="py-2 pr-4">Payment</th>
            <th className="py-2 pr-4">Meals fulfilled</th>
            <th className="py-2 pr-4">Contact</th>
            <th className="py-2 pr-4">Status</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => {
            const dates = Array.from(
              new Set(
                order.items.map((i) => i.deliveryDate.toISOString().slice(0, 10)),
              ),
            );
            const fulfilledCount = order.items.filter((i) => i.fulfilled).length;
            return (
              <tr key={order.id} className="border-b border-neutral-100">
                <td className="py-2 pr-4">
                  {order.createdAt.toISOString().slice(0, 10)}
                </td>
                <td className="py-2 pr-4">{dates.join(", ")}</td>
                <td className="py-2 pr-4">
                  {order.planLabelSnapshot} ({formatGbp(order.planPriceGbpSnapshot)})
                </td>
                <td className="py-2 pr-4">
                  {order.paymentMethod === "cash" ? "Cash" : "Card"}
                  {order.source === "whatsapp" && (
                    <span className="ml-2 rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-800">
                      WhatsApp
                    </span>
                  )}
                </td>
                <td className="py-2 pr-4">
                  {fulfilledCount}/{order.items.length}
                </td>
                <td className="py-2 pr-4">{order.contactName}</td>
                <td className="py-2 pr-4">
                  <Link
                    href={`/admin/orders/${order.id}`}
                    className="underline hover:text-neutral-900"
                  >
                    {order.status}
                  </Link>
                </td>
              </tr>
            );
          })}
          {orders.length === 0 && (
            <tr>
              <td colSpan={7} className="py-6 text-center text-neutral-700">
                No orders match these filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
