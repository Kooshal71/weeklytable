import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/dal";
import { setOrderStatus, markOrderPaidCash, toggleOrderItemFulfilled } from "../actions";
import { formatGuaranteeWindow, formatTime12h } from "@/lib/deliveryTime";
import { formatDeliveryAddress } from "@/lib/address";

export const dynamic = "force-dynamic";

function formatGbp(pence: number) {
  return `£${(pence / 100).toFixed(2)}`;
}

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireRole(["owner", "kitchen"]);
  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      items: { orderBy: { deliveryDate: "asc" } },
      plan: true,
    },
  });

  if (!order) notFound();

  const isOwner = session.role === "owner";
  const canMarkFulfilled = isOwner && order.status === "paid";
  const canCancel =
    isOwner && (order.status === "pending_payment" || order.status === "paid");
  const canMarkPaidCash =
    isOwner && order.paymentMethod === "cash" && order.status === "pending_payment";

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <Link href="/admin/orders" className="text-sm text-neutral-600 underline">
        ← Back to orders
      </Link>

      <h1 className="text-2xl font-semibold">Order</h1>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-neutral-700">Status</dt>
          <dd className="font-medium">{order.status}</dd>
        </div>
        <div>
          <dt className="text-neutral-700">Plan</dt>
          <dd>
            {order.planLabelSnapshot} ({formatGbp(order.planPriceGbpSnapshot)})
          </dd>
        </div>
        <div>
          <dt className="text-neutral-700">Payment method</dt>
          <dd className="capitalize">
            {order.paymentMethod === "cash" ? "Cash on delivery" : "Card (Stripe)"}
          </dd>
        </div>
        <div>
          <dt className="text-neutral-700">Placed</dt>
          <dd>
            {order.createdAt.toISOString()}
            {order.source === "whatsapp" ? " via WhatsApp" : " on the website"}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-neutral-700">Contact</dt>
          <dd>
            {order.contactName} · {order.contactPhone} · {order.contactEmail}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-neutral-700">Delivery address</dt>
          <dd>{formatDeliveryAddress(order)}</dd>
        </div>
        {order.notes && (
          <div className="col-span-2">
            <dt className="text-neutral-700">Notes</dt>
            <dd>{order.notes}</dd>
          </div>
        )}
        <div className="col-span-2">
          <dt className="text-neutral-700">Meals</dt>
          <dd>
            <ul className="flex flex-col gap-1">
              {order.items.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-2">
                  <span>
                    <span className="font-medium">
                      {item.deliveryDate.toISOString().slice(0, 10)}
                    </span>{" "}
                    — {item.dishNameSnapshot}
                    {item.deliveryTime && (
                      <span className="block text-xs text-neutral-700">
                        Requested {formatTime12h(item.deliveryTime)} · guaranteed{" "}
                        {formatGuaranteeWindow(item.deliveryTime)}
                      </span>
                    )}
                  </span>
                  <form
                    action={async () => {
                      "use server";
                      await toggleOrderItemFulfilled(item.id, !item.fulfilled);
                    }}
                  >
                    <button
                      type="submit"
                      className={
                        item.fulfilled
                          ? "rounded-md border border-green-300 px-2 py-1 text-xs font-medium text-green-700"
                          : "rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-600"
                      }
                    >
                      {item.fulfilled ? "✓ Fulfilled" : "Mark fulfilled"}
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </dd>
        </div>
        {order.paymentMethod === "stripe" && (
          <div className="col-span-2">
            <dt className="text-neutral-700">Stripe</dt>
            <dd className="break-all text-xs text-neutral-700">
              Session: {order.stripeCheckoutSessionId}
              <br />
              Payment intent: {order.stripePaymentIntentId ?? "—"}
            </dd>
          </div>
        )}
      </dl>

      <div className="flex gap-3 border-t border-neutral-200 pt-4">
        {canMarkPaidCash && (
          <form
            action={async () => {
              "use server";
              await markOrderPaidCash(order.id);
            }}
          >
            <button
              type="submit"
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
            >
              Mark paid (cash received)
            </button>
          </form>
        )}
        {canMarkFulfilled && (
          <form
            action={async () => {
              "use server";
              await setOrderStatus(order.id, "fulfilled");
            }}
          >
            <button
              type="submit"
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
            >
              Mark fulfilled
            </button>
          </form>
        )}
        {canCancel && (
          <form
            action={async () => {
              "use server";
              await setOrderStatus(order.id, "cancelled");
            }}
          >
            <button
              type="submit"
              className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700"
            >
              Cancel order
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
