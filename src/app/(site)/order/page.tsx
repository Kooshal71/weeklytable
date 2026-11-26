import { prisma } from "@/lib/prisma";
import MenuBrowser from "@/components/MenuBrowser";
import type { WeekdayName } from "@/lib/cutoff";

const WEEKDAY_NAMES: readonly WeekdayName[] = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
];

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

// Menu content is admin-editable (dishes, plans, cutoff config) and must
// reflect changes immediately without a redeploy — never statically cache
// this page.
export const dynamic = "force-dynamic";

// `?dish=<id>&day=<weekday>` comes from "Add to order" on the menu page: the
// dish is pre-added on its first available date (on `day` if it's cooked
// then). Anything unknown is ignored, and the server re-validates the whole
// order at checkout regardless.
export default async function OrderPage({
  searchParams,
}: {
  searchParams: Promise<{ dish?: string | string[]; day?: string | string[] }>;
}) {
  const params = await searchParams;
  const initialDishId = firstParam(params.dish) ?? null;
  const dayParam = firstParam(params.day);
  const initialDay = WEEKDAY_NAMES.find((d) => d === dayParam) ?? null;

  const [dishes, plans, cutoffConfig] = await Promise.all([
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
      orderBy: { sortOrder: "asc" },
      select: { id: true, label: true, mealCount: true, priceGbp: true, allowExtraMeals: true },
    }),
    prisma.cutoffConfig.findUniqueOrThrow({ where: { id: "default" } }),
  ]);

  return (
    <>
      <header className="border-b border-card-border px-6 py-10 text-center sm:py-14">
        <h1 className="font-serif text-4xl font-medium text-espresso sm:text-5xl">
          Choose your week
        </h1>
        <p className="mx-auto mt-3 max-w-md text-espresso/70">
          Pick a plan, choose your meals, and tell us when you&apos;d like
          them delivered.
        </p>
      </header>

      <MenuBrowser
        dishes={dishes}
        plans={plans}
        initialDishId={initialDishId}
        initialDay={initialDay}
        cutoffConfig={{
          leadDays: cutoffConfig.leadDays,
          cutoffTime: cutoffConfig.cutoffTime,
          timezone: cutoffConfig.timezone,
          deliveryWindowStart: cutoffConfig.deliveryWindowStart,
          deliveryWindowEnd: cutoffConfig.deliveryWindowEnd,
        }}
      />
    </>
  );
}
