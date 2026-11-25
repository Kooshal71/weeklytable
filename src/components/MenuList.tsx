"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import {
  CATEGORY_LABELS,
  CATEGORY_VALUES,
  DIETARY_TAG_LABELS,
} from "@/lib/dishOptions";
import type { Category, DietaryTag } from "@/generated/prisma/enums";
import type { WeekdayName } from "@/lib/cutoff";
import { Icon } from "@/components/Icon";
import { track } from "@/lib/analytics";

type DishView = {
  id: string;
  name: string;
  category: Category;
  dietaryTag: DietaryTag | null;
  description: string;
  imageUrl: string;
  availableDays: WeekdayName[];
};

// Display order for days — Monday first, the way a UK week is read.
const DAYS: { value: WeekdayName; short: string }[] = [
  { value: "monday", short: "Mon" },
  { value: "tuesday", short: "Tue" },
  { value: "wednesday", short: "Wed" },
  { value: "thursday", short: "Thu" },
  { value: "friday", short: "Fri" },
  { value: "saturday", short: "Sat" },
  { value: "sunday", short: "Sun" },
];

const MIN_DISHES_FOR_DIETARY_FILTER = 2;

// Wait until the visitor stops typing before recording a search, so one
// search is one event rather than one per keystroke.
const SEARCH_TRACK_DELAY_MS = 1200;

function formatAvailability(days: WeekdayName[]) {
  if (days.length === 7) return "Every day";
  return DAYS.filter((d) => days.includes(d.value))
    .map((d) => d.short)
    .join(" · ");
}

function categoryAnchor(category: Category) {
  return `category-${category}`;
}

function Chip({
  pressed,
  onClick,
  tone,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  tone: "terracotta" | "sage";
  children: React.ReactNode;
}) {
  const on =
    tone === "terracotta"
      ? "border-terracotta-dark bg-terracotta-dark text-white"
      : "border-sage bg-sage text-white";
  const off =
    tone === "terracotta"
      ? "border-card-border bg-white text-espresso hover:border-terracotta-dark/60"
      : "border-card-border bg-white text-espresso hover:border-sage/60";
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`min-h-[40px] rounded-full border px-4 text-sm font-medium transition motion-safe:active:scale-95 ${pressed ? on : off}`}
    >
      {children}
    </button>
  );
}

export default function MenuList({ dishes }: { dishes: DishView[] }) {
  const [dayFilter, setDayFilter] = useState<WeekdayName | "all">("all");
  const [dietaryFilter, setDietaryFilter] = useState<DietaryTag | "all">("all");
  const [search, setSearch] = useState("");

  // A filter that only ever narrows to one dish isn't worth the space, so a
  // tag earns a chip once enough dishes carry it. The tags themselves stay in
  // the schema and the admin form, and chips reappear as dishes get tagged.
  const dietaryTags = useMemo(() => {
    const counts = new Map<DietaryTag, number>();
    for (const d of dishes) {
      if (d.dietaryTag) counts.set(d.dietaryTag, (counts.get(d.dietaryTag) ?? 0) + 1);
    }
    return Array.from(counts)
      .filter(([, count]) => count >= MIN_DISHES_FOR_DIETARY_FILTER)
      .map(([tag]) => tag);
  }, [dishes]);

  const query = search.trim().toLowerCase();
  const filteredDishes = dishes.filter((dish) => {
    if (dayFilter !== "all" && !dish.availableDays.includes(dayFilter)) return false;
    if (dietaryFilter !== "all" && dish.dietaryTag !== dietaryFilter) return false;
    if (query && !`${dish.name} ${dish.description}`.toLowerCase().includes(query)) {
      return false;
    }
    return true;
  });

  // Grouped in the admin's category order (classics first), skipping any
  // category the current filters have emptied out.
  const sections = CATEGORY_VALUES.map((category) => ({
    category,
    dishes: filteredDishes.filter((d) => d.category === category),
  })).filter((s) => s.dishes.length > 0);

  const hasFilters = dayFilter !== "all" || dietaryFilter !== "all" || query !== "";
  const resultCount = filteredDishes.length;

  // Records what people look for and whether we have it — searches that
  // return 0 results are the most useful signal for what to add to the menu.
  useEffect(() => {
    if (query.length < 2) return;
    const timer = setTimeout(() => {
      track("menu-search", { term: query.slice(0, 50), results: resultCount });
    }, SEARCH_TRACK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query, resultCount]);

  function chooseDay(day: WeekdayName | "all") {
    setDayFilter(day);
    track("menu-filter-day", { day });
  }

  function chooseDiet(tag: DietaryTag | "all") {
    setDietaryFilter(tag);
    track("menu-filter-diet", { diet: tag });
  }

  function clearFilters() {
    setDayFilter("all");
    setDietaryFilter("all");
    setSearch("");
    track("menu-clear-filters");
  }

  return (
    <section className="mx-auto max-w-6xl px-6 py-10 sm:py-14">
      <div className="flex flex-col gap-5 rounded-2xl border border-card-border bg-white/70 p-5 shadow-sm">
        <label className="relative block">
          <span className="sr-only">Search dishes</span>
          <Icon
            name="search"
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[20px] text-espresso/60"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search dishes, e.g. curry, pie, salmon…"
            className="w-full rounded-full border border-card-border bg-cream-dim py-3 pl-11 pr-4 text-espresso placeholder:text-espresso/60 focus:border-terracotta-dark focus:outline-none focus:ring-2 focus:ring-terracotta-dark/20"
          />
        </label>

        <div className="flex flex-col gap-2">
          <span id="menu-day-filter" className="text-sm font-semibold text-espresso">
            Available on
          </span>
          <div role="group" aria-labelledby="menu-day-filter" className="flex flex-wrap gap-2">
            <Chip tone="terracotta" pressed={dayFilter === "all"} onClick={() => chooseDay("all")}>
              Any day
            </Chip>
            {DAYS.map((day) => (
              <Chip
                key={day.value}
                tone="terracotta"
                pressed={dayFilter === day.value}
                onClick={() => chooseDay(day.value)}
              >
                {day.short}
              </Chip>
            ))}
          </div>
        </div>

        {dietaryTags.length > 0 && (
          <div className="flex flex-col gap-2">
            <span id="menu-diet-filter" className="text-sm font-semibold text-espresso">
              Dietary
            </span>
            <div role="group" aria-labelledby="menu-diet-filter" className="flex flex-wrap gap-2">
              <Chip tone="sage" pressed={dietaryFilter === "all"} onClick={() => chooseDiet("all")}>
                All dishes
              </Chip>
              {dietaryTags.map((tag) => (
                <Chip
                  key={tag}
                  tone="sage"
                  pressed={dietaryFilter === tag}
                  onClick={() => chooseDiet(tag)}
                >
                  {DIETARY_TAG_LABELS[tag]}
                </Chip>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p aria-live="polite" className="text-sm text-espresso/85">
          Showing {filteredDishes.length} of {dishes.length} dishes
        </p>
        {hasFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="min-h-[40px] text-sm font-semibold text-terracotta-dark underline-offset-4 hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {sections.length > 1 && (
        <nav aria-label="Jump to a category" className="mt-4 flex flex-wrap gap-2">
          {sections.map((s) => (
            <a
              key={s.category}
              href={`#${categoryAnchor(s.category)}`}
              onClick={() => track("menu-category-jump", { category: s.category })}
              className="rounded-full bg-cream-dim px-3 py-1.5 text-sm text-espresso transition hover:bg-terracotta-dark/10 hover:text-terracotta-dark"
            >
              {CATEGORY_LABELS[s.category]}{" "}
              <span className="text-espresso/70">({s.dishes.length})</span>
            </a>
          ))}
        </nav>
      )}

      {sections.length === 0 ? (
        <div className="mt-10 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-card-border px-6 py-12 text-center">
          <Icon name="search_off" className="text-[32px] text-espresso/60" />
          <p className="text-espresso/85">No dishes match these filters.</p>
          <button
            type="button"
            onClick={clearFilters}
            className="rounded-full border border-card-border bg-white px-5 py-2 text-sm font-semibold text-espresso transition hover:border-terracotta-dark hover:text-terracotta-dark"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-12">
          {sections.map((section) => (
            <section
              key={section.category}
              id={categoryAnchor(section.category)}
              aria-labelledby={`${categoryAnchor(section.category)}-heading`}
              className="scroll-mt-28"
            >
              <h2
                id={`${categoryAnchor(section.category)}-heading`}
                className="flex items-baseline gap-2 border-b border-card-border pb-3 font-serif text-2xl font-medium text-espresso sm:text-3xl"
              >
                {CATEGORY_LABELS[section.category]}
                <span className="font-sans text-sm font-normal text-espresso/70">
                  {section.dishes.length} {section.dishes.length === 1 ? "dish" : "dishes"}
                </span>
              </h2>
              <ul className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {section.dishes.map((dish) => (
                  <li
                    key={dish.id}
                    className="flex flex-col overflow-hidden rounded-2xl border border-card-border bg-white shadow-sm"
                  >
                    <div className="relative aspect-[4/3] w-full bg-cream-dim">
                      <Image
                        src={dish.imageUrl}
                        alt={dish.name}
                        fill
                        sizes="(min-width: 1024px) 360px, (min-width: 640px) 50vw, 100vw"
                        className="object-cover"
                      />
                      {dish.dietaryTag && (
                        <span className="absolute left-3 top-3 rounded-full bg-white/95 px-2.5 py-0.5 text-xs font-semibold text-sage shadow-sm">
                          {DIETARY_TAG_LABELS[dish.dietaryTag]}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-1 flex-col gap-2 p-5">
                      <h3 className="font-serif text-xl font-medium text-espresso">
                        {dish.name}
                      </h3>
                      <p className="text-sm text-espresso/85">{dish.description}</p>
                      <p className="mt-auto flex items-center gap-1.5 pt-2 text-sm text-espresso/85">
                        <Icon name="calendar_month" className="text-[18px] text-sage" />
                        <span className="sr-only">Available: </span>
                        {formatAvailability(dish.availableDays)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
