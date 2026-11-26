import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import MenuList from "@/components/MenuList";
import { Icon } from "@/components/Icon";

export const metadata: Metadata = {
  title: "Menu · Weekly Table",
  description:
    "Browse Weekly Table's homemade dishes — British classics, Italian, Indian, Mexican, Pan-Asian and healthy bowls — delivered hot across Southend-on-Sea.",
};

// A browsable, read-only menu — no ordering here (that's /order). Must stay
// live, same as the order page, since dishes and plans change via the admin
// panel.
export const dynamic = "force-dynamic";

function formatGbp(pence: number) {
  return `£${(pence / 100).toFixed(2)}`;
}

export default async function MenuPage() {
  const [dishes, plans] = await Promise.all([
    prisma.dish.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        category: true,
        dietaryTag: true,
        description: true,
        imageUrl: true,
        availableDays: true,
      },
    }),
    prisma.plan.findMany({
      where: { isActive: true },
      select: { mealCount: true, priceGbp: true },
    }),
  ]);

  // Same per-meal rounding the order page and the order API use, so the
  // "from" price shown here is never lower than anything actually charged.
  const lowestPricePerMeal = plans.length
    ? Math.min(...plans.map((p) => Math.round(p.priceGbp / p.mealCount)))
    : null;

  return (
    <>
      <header className="border-b border-card-border px-6 py-12 text-center sm:py-16">
        <p className="text-sm font-semibold uppercase tracking-wide text-terracotta-dark">
          Homemade, delivered hot
        </p>
        <h1 className="mt-2 font-serif text-4xl font-medium text-espresso sm:text-5xl">
          Our menu
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-espresso/85">
          {dishes.length} dishes, from proper British classics to bowls and
          world favourites. Not everything is cooked every day — filter by day
          to see what&apos;s on when you want it.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-3">
          <Link
            href="/order"
            data-umami-event="cta-order"
            data-umami-event-location="menu-header"
            className="rounded-full bg-terracotta-dark px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-espresso hover:shadow-md"
          >
            Start your order
          </Link>
          {lowestPricePerMeal !== null && (
            <span className="flex items-center gap-1.5 text-sm font-medium text-espresso/85">
              <Icon name="sell" className="text-[18px] text-sage" />
              Meals from {formatGbp(lowestPricePerMeal)} each
            </span>
          )}
        </div>
      </header>

      <MenuList dishes={dishes} />

      <section className="border-t border-card-border bg-cream-dim/40">
        <div className="mx-auto flex max-w-3xl flex-col items-center px-6 py-14 text-center sm:py-16">
          <h2 className="font-serif text-3xl font-medium text-espresso">
            Found something you fancy?
          </h2>
          <p className="mt-3 max-w-md text-espresso/85">
            Pick a plan, choose a meal for each day, and tell us what time
            you&apos;d like it. No subscription — order only the weeks you
            want.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link
              href="/order"
              data-umami-event="cta-order"
              data-umami-event-location="menu-bottom"
              className="rounded-full bg-terracotta-dark px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-espresso hover:shadow-md"
            >
              Order now
            </Link>
            <Link
              href="/how-it-works"
              data-umami-event="cta-how-it-works"
              data-umami-event-location="menu-bottom"
              className="rounded-full border border-card-border bg-white px-6 py-3 text-base font-semibold text-espresso transition hover:border-terracotta-dark hover:text-terracotta-dark"
            >
              How it works
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
