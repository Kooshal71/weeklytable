"use client";

import { useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  getEligibleWindow,
  getWeekday,
  type CutoffConfigLike,
  type WeekdayName,
} from "@/lib/cutoff";
import {
  getDeliveryTimeSlots,
  formatGuaranteeWindow,
  formatTime12h,
  type DeliveryWindowConfigLike,
} from "@/lib/deliveryTime";
import { CATEGORY_LABELS, DIETARY_TAG_LABELS } from "@/lib/dishOptions";
import type { Category, DietaryTag } from "@/generated/prisma/enums";
import { Icon } from "@/components/Icon";
import {
  SUPPORT_PHONE_DISPLAY,
  SUPPORT_PHONE_TEL,
  SUPPORT_PHONE_WHATSAPP,
} from "@/lib/contact";

export type DishView = {
  id: string;
  name: string;
  category: Category;
  dietaryTag: DietaryTag | null;
  description: string;
  imageUrl: string;
  availableDays: WeekdayName[];
};

export type PlanView = {
  id: string;
  label: string;
  mealCount: number;
  priceGbp: number;
  allowExtraMeals: boolean;
};

type SelectedMeal = { dishId: string; date: string; time: string };

const WEEKDAY_SHORT: Record<WeekdayName, string> = {
  sunday: "Sun",
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
};

function formatGbp(pence: number) {
  return `£${(pence / 100).toFixed(2)}`;
}

function formatDayTab(date: string) {
  const [, month, day] = date.split("-").map(Number);
  const weekday = WEEKDAY_SHORT[getWeekday(date)];
  return `${weekday} ${day}/${month}`;
}

// The "1 / 2 / 3" section markers double as progress feedback — once a
// step is satisfied its badge fills sage with a checkmark instead of the
// terracotta number, echoing the step-breadcrumb in the original design.
function StepBadge({ number, done }: { number: number; done: boolean }) {
  return (
    <span
      className={`flex h-7 w-7 items-center justify-center rounded-full font-sans text-sm font-semibold text-white transition-colors ${
        done ? "bg-sage" : "bg-terracotta"
      }`}
    >
      {done ? <Icon name="check" className="text-[16px] leading-none" /> : number}
    </span>
  );
}

export default function MenuBrowser({
  dishes,
  plans,
  cutoffConfig,
}: {
  dishes: DishView[];
  plans: PlanView[];
  cutoffConfig: CutoffConfigLike & DeliveryWindowConfigLike;
}) {
  const eligibleDates = useMemo(
    () => getEligibleWindow(cutoffConfig),
    [cutoffConfig],
  );
  const deliveryTimeSlots = useMemo(
    () => getDeliveryTimeSlots(cutoffConfig),
    [cutoffConfig],
  );

  const [activeDate, setActiveDate] = useState(eligibleDates[0]);
  const [activeTime, setActiveTime] = useState(deliveryTimeSlots[0]);
  const [categoryFilter, setCategoryFilter] = useState<Category | "all">("all");
  const [search, setSearch] = useState("");
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(
    plans[0]?.id ?? null,
  );
  const [selectedMeals, setSelectedMeals] = useState<SelectedMeal[]>([]);
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [postcode, setPostcode] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"stripe" | "cash">("stripe");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const selectedPlan = plans.find((p) => p.id === selectedPlanId) ?? null;
  const mealCount = selectedPlan?.mealCount ?? 0;
  const allowExtraMeals = selectedPlan?.allowExtraMeals ?? false;
  // For open-ended plans, selectedMeals.length can exceed mealCount — the
  // total scales with it rather than staying fixed at the plan's own price.
  const pricePerMealGbp = selectedPlan
    ? Math.round(selectedPlan.priceGbp / selectedPlan.mealCount)
    : 0;
  const totalPriceGbp = selectedPlan
    ? allowExtraMeals
      ? pricePerMealGbp * selectedMeals.length
      : selectedPlan.priceGbp
    : 0;

  // The 3-meal plan is the natural middle option to steer customers toward;
  // fall back to the middle tier by position if that exact size isn't offered.
  const mostPopularPlanId =
    plans.find((p) => p.mealCount === 3)?.id ??
    (plans.length >= 3 ? plans[Math.floor(plans.length / 2)].id : null);

  const activeWeekday = getWeekday(activeDate);

  // Not every dish is cooked every day — hard-filter to what's actually
  // available on the active day before anything else (category/search
  // filters operate on top of this). The server re-enforces this
  // independently, per meal, at order time.
  const dishesForActiveDay = useMemo(
    () => dishes.filter((d) => d.availableDays.includes(activeWeekday)),
    [dishes, activeWeekday],
  );

  const categories = useMemo(() => {
    const seen = new Set(dishesForActiveDay.map((d) => d.category));
    return Array.from(seen);
  }, [dishesForActiveDay]);

  const filteredDishes = dishesForActiveDay.filter((dish) => {
    const matchesCategory =
      categoryFilter === "all" || dish.category === categoryFilter;
    const matchesSearch =
      search.trim() === "" ||
      `${dish.name} ${dish.description}`
        .toLowerCase()
        .includes(search.trim().toLowerCase());
    return matchesCategory && matchesSearch;
  });

  function selectPlan(planId: string) {
    setSelectedPlanId(planId);
    setSelectedMeals([]); // changing tier resets the (now differently-sized) selection
  }

  function toggleMeal(dishId: string, date: string, time: string) {
    setSelectedMeals((current) => {
      const exists = current.some((m) => m.dishId === dishId && m.date === date);
      if (exists) {
        return current.filter((m) => !(m.dishId === dishId && m.date === date));
      }
      if (!allowExtraMeals && current.length >= mealCount) return current; // bounded by the chosen tier
      return [...current, { dishId, date, time }];
    });
  }

  function removeMeal(index: number) {
    setSelectedMeals((current) => current.filter((_, i) => i !== index));
  }

  // Lets a customer adjust one meal's requested time independently after
  // adding it — two meals can already share the same delivery date, so a
  // per-item override (not just the day-level default) is needed.
  function updateMealTime(index: number, time: string) {
    setSelectedMeals((current) =>
      current.map((m, i) => (i === index ? { ...m, time } : m)),
    );
  }

  function dishName(dishId: string) {
    return dishes.find((d) => d.id === dishId)?.name ?? dishId;
  }

  const hasContactDetails =
    contactName.trim() !== "" &&
    contactPhone.trim() !== "" &&
    contactEmail.trim() !== "" &&
    addressLine1.trim() !== "" &&
    city.trim() !== "" &&
    postcode.trim() !== "";

  const mealsSatisfied = allowExtraMeals
    ? selectedMeals.length >= mealCount
    : selectedMeals.length === mealCount;

  const canCheckout = selectedPlan !== null && mealsSatisfied && hasContactDetails;
  // The sticky checkout bar's only other actionable state besides
  // submitting — meals are done but the form below still needs filling in,
  // so there's somewhere useful to scroll to rather than just disabling it.
  const canScrollToCheckoutForm = mealsSatisfied && !hasContactDetails;
  const checkoutSectionRef = useRef<HTMLElement>(null);

  // What's still needed before checkout is possible — shown in the order
  // summary card so the customer doesn't have to scan the whole page to
  // work out what's missing.
  const nextStepMessage = (() => {
    if (!selectedPlan) return "Choose a plan above to get started.";
    if (!mealsSatisfied) {
      const remaining = mealCount - selectedMeals.length;
      return `Select ${remaining} more meal${remaining === 1 ? "" : "s"} to continue.`;
    }
    if (!hasContactDetails) return "Fill in your delivery details to complete your order.";
    if (allowExtraMeals) {
      return `Add more meals anytime — each extra one is ${formatGbp(pricePerMealGbp)}.`;
    }
    return null;
  })();

  async function handleCheckout() {
    if (!selectedPlan) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: selectedPlan.id,
          items: selectedMeals.map((m) => ({
            dishId: m.dishId,
            deliveryDate: m.date,
            deliveryTime: m.time,
          })),
          contactName,
          contactPhone,
          contactEmail,
          addressLine1,
          addressLine2: addressLine2.trim() === "" ? undefined : addressLine2,
          city,
          postcode,
          notes: notes.trim() === "" ? undefined : notes.trim(),
          paymentMethod,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setSubmitError(data.error ?? "Something went wrong. Please try again.");
        setIsSubmitting(false);
        return;
      }

      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else {
        // Cash order — no Stripe redirect. Reuse the same confirmation
        // page by passing the order's own id in place of a Stripe
        // session id (the by-session route accepts either for cash
        // orders — see its comment for why that's safe).
        window.location.href = `/order-confirmed?session_id=${encodeURIComponent(data.orderId)}`;
      }
    } catch {
      setSubmitError("Could not reach the server. Please try again.");
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10 bg-cream p-6 pb-28 font-sans text-espresso antialiased sm:p-8 sm:pb-28">
      <section className="flex flex-col gap-4">
        <h2 className="flex items-center gap-2 font-serif text-2xl font-semibold text-espresso">
          <StepBadge number={1} done={selectedPlan !== null} />
          Choose a plan
        </h2>
        <div className="flex flex-wrap gap-3">
          {plans.map((plan) => {
            const isMostPopular = plan.id === mostPopularPlanId;
            return (
              <button
                key={plan.id}
                type="button"
                onClick={() => selectPlan(plan.id)}
                className={`relative rounded-xl border px-5 py-4 text-left shadow-sm transition active:scale-[0.98] ${
                  plan.id === selectedPlanId
                    ? "border-terracotta bg-terracotta text-white shadow-md"
                    : "border-card-border bg-white hover:-translate-y-0.5 hover:border-terracotta/50 hover:shadow-md"
                } ${isMostPopular ? "mt-2.5" : ""}`}
              >
                {isMostPopular && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-honey px-2.5 py-0.5 text-xs font-semibold text-espresso shadow-sm">
                    Most popular
                  </span>
                )}
                <div className="font-serif text-lg font-medium">{plan.label}</div>
                <div
                  className={`text-sm ${
                    plan.id === selectedPlanId ? "text-white/90" : "text-espresso/85"
                  }`}
                >
                  {plan.allowExtraMeals ? "From " : ""}
                  {formatGbp(plan.priceGbp)}
                  <span className={plan.id === selectedPlanId ? "text-white/70" : "text-espresso/70"}>
                    {" "}
                    ({formatGbp(plan.priceGbp / plan.mealCount)} / meal)
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-serif text-2xl font-semibold text-espresso">
            <StepBadge number={2} done={mealCount > 0 && mealsSatisfied} />
            Pick a meal for each day
          </h2>
          <span className="text-sm text-espresso/75">
            {allowExtraMeals
              ? `${selectedMeals.length} selected (min ${mealCount})`
              : `${selectedMeals.length} of ${mealCount} selected`}
          </span>
        </div>
        <p className="text-sm text-espresso/85">
          Choose which day each meal is delivered — not every dish is made
          every day, so the menu below changes as you switch days.
        </p>

        {selectedMeals.length > 0 && (
          <ul className="flex flex-col gap-2 rounded-xl border border-card-border bg-cream-dim/60 p-4 text-sm">
            {selectedMeals.map((meal, i) => (
              <li
                key={i}
                className="flex flex-col gap-1.5 rounded-lg border border-card-border/60 bg-white/70 px-3 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span>
                    <span className="font-medium text-terracotta">{meal.date}</span>{" "}
                    — {dishName(meal.dishId)}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeMeal(i)}
                    className="text-espresso/70 hover:text-terracotta"
                    aria-label={`Remove ${dishName(meal.dishId)} on ${meal.date}`}
                  >
                    ✕
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-espresso/75">
                  <Icon name="schedule" className="text-[14px] text-terracotta" />
                  <div className="flex flex-wrap gap-1">
                    {deliveryTimeSlots.map((slot) => (
                      <button
                        key={slot}
                        type="button"
                        onClick={() => updateMealTime(i, slot)}
                        className={`rounded-full border px-2 py-0.5 text-xs transition active:scale-95 ${
                          slot === meal.time
                            ? "border-terracotta bg-terracotta text-white"
                            : "border-card-border bg-white text-espresso hover:border-terracotta/50"
                        }`}
                      >
                        {formatTime12h(slot)}
                      </button>
                    ))}
                  </div>
                  <span>Guaranteed {formatGuaranteeWindow(meal.time)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap gap-2 border-b border-card-border pb-4">
          {eligibleDates.map((date) => {
            const count = selectedMeals.filter((m) => m.date === date).length;
            return (
              <button
                key={date}
                type="button"
                onClick={() => setActiveDate(date)}
                className={`relative rounded-full border px-3 py-1.5 text-sm transition active:scale-95 ${
                  date === activeDate
                    ? "border-terracotta bg-terracotta text-white shadow-sm"
                    : "border-card-border bg-white text-espresso hover:border-terracotta/50"
                }`}
              >
                {formatDayTab(date)}
                {count > 0 && (
                  <span
                    className={`ml-1.5 rounded-full px-1.5 text-xs ${
                      date === activeDate ? "bg-white/25" : "bg-terracotta/10 text-terracotta"
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-2">
          <span className="flex items-center gap-1.5 text-sm text-espresso/85">
            <Icon name="schedule" className="text-[16px] text-terracotta" />
            Delivery time for {formatDayTab(activeDate)}:
            <span className="text-xs text-espresso/70">
              (guaranteed {formatGuaranteeWindow(activeTime)})
            </span>
          </span>
          <div className="flex flex-wrap gap-2">
            {deliveryTimeSlots.map((slot) => (
              <button
                key={slot}
                type="button"
                onClick={() => setActiveTime(slot)}
                className={`rounded-full border px-3 py-1 text-sm transition active:scale-95 ${
                  slot === activeTime
                    ? "border-terracotta bg-terracotta text-white shadow-sm"
                    : "border-card-border bg-white text-espresso hover:border-terracotta/50"
                }`}
              >
                {formatTime12h(slot)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setCategoryFilter("all")}
              className={`rounded-full border px-3 py-1 text-sm transition active:scale-95 ${
                categoryFilter === "all"
                  ? "border-sage bg-sage text-white"
                  : "border-card-border bg-white text-espresso hover:border-sage/50"
              }`}
            >
              All
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategoryFilter(cat)}
                className={`rounded-full border px-3 py-1 text-sm transition active:scale-95 ${
                  categoryFilter === cat
                    ? "border-sage bg-sage text-white"
                    : "border-card-border bg-white text-espresso hover:border-sage/50"
                }`}
              >
                {CATEGORY_LABELS[cat]}
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder="Search dishes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="ml-auto rounded-full border border-card-border bg-white px-4 py-1.5 text-sm text-espresso placeholder:text-espresso/60 focus:border-terracotta focus:outline-none focus:ring-2 focus:ring-terracotta/20"
          />
        </div>

        {filteredDishes.length === 0 && (
          <p className="flex items-center gap-2 rounded-xl border border-card-border bg-cream-dim/60 px-4 py-3 text-sm text-espresso/75">
            <Icon name="search_off" className="shrink-0 text-[20px] text-espresso/60" />
            Nothing matches for this day — try a different category, search
            term, or day tab above.
          </p>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
          {filteredDishes.map((dish) => {
            const isSelected = selectedMeals.some(
              (m) => m.dishId === dish.id && m.date === activeDate,
            );
            const isDisabled =
              !isSelected && !allowExtraMeals && selectedMeals.length >= mealCount;
            return (
              <button
                key={dish.id}
                type="button"
                disabled={isDisabled}
                onClick={() => toggleMeal(dish.id, activeDate, activeTime)}
                className={`relative flex flex-col overflow-hidden rounded-xl border bg-white text-left shadow-sm transition active:scale-[0.98] ${
                  isSelected
                    ? "border-terracotta shadow-md ring-2 ring-terracotta"
                    : "border-card-border"
                } ${isDisabled ? "opacity-40" : "hover:-translate-y-0.5 hover:border-terracotta/40 hover:shadow-md"}`}
              >
                {isSelected && (
                  <span className="absolute right-2 top-2 z-10 flex h-6 w-6 scale-100 items-center justify-center rounded-full bg-terracotta text-white shadow-sm transition-transform">
                    <Icon name="check" className="text-[16px] leading-none" />
                  </span>
                )}
                <div className="relative aspect-square w-full bg-cream-dim">
                  <Image
                    src={dish.imageUrl}
                    alt={dish.name}
                    fill
                    className="object-cover"
                  />
                  {dish.dietaryTag && (
                    <span className="absolute left-2 top-2 rounded-full bg-white/95 px-2 py-0.5 text-xs font-medium text-sage shadow-sm">
                      {DIETARY_TAG_LABELS[dish.dietaryTag]}
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-1 p-4">
                  <span className="font-serif text-lg font-medium text-espresso">
                    {dish.name}
                  </span>
                  <p className="text-sm text-espresso/85">{dish.description}</p>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section
        ref={checkoutSectionRef}
        className="flex flex-col gap-4 rounded-xl border border-card-border bg-white p-6 shadow-sm"
      >
        <h2 className="flex items-center gap-2 font-serif text-2xl font-semibold text-espresso">
          <StepBadge number={3} done={canCheckout} />
          Delivery &amp; payment
        </h2>
        <p className="flex items-start gap-1.5 text-sm text-espresso/85">
          <Icon name="schedule" className="mt-0.5 shrink-0 text-[18px] text-terracotta" />
          <span>
            Order by {formatTime12h(cutoffConfig.cutoffTime)} the day before
            delivery (e.g., order by {formatTime12h(cutoffConfig.cutoffTime)}{" "}
            Monday for Tuesday delivery). Choose a delivery time between{" "}
            {formatTime12h(cutoffConfig.deliveryWindowStart)} and{" "}
            {formatTime12h(cutoffConfig.deliveryWindowEnd)} — we guarantee
            your food arrives within 1 hour of the time you request. Dates
            are reserved upon payment.
          </span>
        </p>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.6fr_1fr]">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm text-espresso">
              Name
              <input
                type="text"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                className="rounded-lg border border-card-border bg-cream-dim px-3 py-2 text-espresso focus:border-terracotta focus:outline-none focus:ring-2 focus:ring-terracotta/20"
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-espresso">
              Phone
              <input
                type="tel"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                className="rounded-lg border border-card-border bg-cream-dim px-3 py-2 text-espresso focus:border-terracotta focus:outline-none focus:ring-2 focus:ring-terracotta/20"
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-espresso">
              Email
              <input
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                className="rounded-lg border border-card-border bg-cream-dim px-3 py-2 text-espresso focus:border-terracotta focus:outline-none focus:ring-2 focus:ring-terracotta/20"
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-espresso sm:col-span-2">
              Address line 1
              <input
                type="text"
                value={addressLine1}
                onChange={(e) => setAddressLine1(e.target.value)}
                className="rounded-lg border border-card-border bg-cream-dim px-3 py-2 text-espresso focus:border-terracotta focus:outline-none focus:ring-2 focus:ring-terracotta/20"
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-espresso sm:col-span-2">
              Address line 2
              <input
                type="text"
                value={addressLine2}
                onChange={(e) => setAddressLine2(e.target.value)}
                className="rounded-lg border border-card-border bg-cream-dim px-3 py-2 text-espresso focus:border-terracotta focus:outline-none focus:ring-2 focus:ring-terracotta/20"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-espresso">
              Town/City
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="rounded-lg border border-card-border bg-cream-dim px-3 py-2 text-espresso focus:border-terracotta focus:outline-none focus:ring-2 focus:ring-terracotta/20"
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-espresso">
              Postcode
              <input
                type="text"
                value={postcode}
                onChange={(e) => setPostcode(e.target.value)}
                className="rounded-lg border border-card-border bg-cream-dim px-3 py-2 text-espresso focus:border-terracotta focus:outline-none focus:ring-2 focus:ring-terracotta/20"
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-espresso sm:col-span-2">
              Notes / dietary restrictions (optional)
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="rounded-lg border border-card-border bg-cream-dim px-3 py-2 text-espresso focus:border-terracotta focus:outline-none focus:ring-2 focus:ring-terracotta/20"
                rows={2}
                maxLength={1000}
                placeholder="e.g. nut allergy, no dairy, leave at the door…"
              />
            </label>
            <div className="flex flex-col gap-2 text-sm sm:col-span-2">
              <span className="font-medium text-espresso">Payment method</span>
              <div className="flex flex-col gap-2 sm:flex-row">
                <label
                  className={`flex flex-1 cursor-pointer items-center gap-2 rounded-lg border px-4 py-3 transition ${
                    paymentMethod === "stripe"
                      ? "border-terracotta bg-terracotta/5"
                      : "border-card-border bg-white hover:border-terracotta/40"
                  }`}
                >
                  <input
                    type="radio"
                    name="paymentMethod"
                    checked={paymentMethod === "stripe"}
                    onChange={() => setPaymentMethod("stripe")}
                    className="accent-terracotta"
                  />
                  <Icon name="credit_card" className="text-[18px] text-terracotta" />
                  <span>
                    Pay by card now
                    <span className="block text-xs font-normal text-espresso/70">
                      Visa, Mastercard, Apple Pay
                    </span>
                  </span>
                </label>
                <label
                  className={`flex flex-1 cursor-pointer items-center gap-2 rounded-lg border px-4 py-3 transition ${
                    paymentMethod === "cash"
                      ? "border-terracotta bg-terracotta/5"
                      : "border-card-border bg-white hover:border-terracotta/40"
                  }`}
                >
                  <input
                    type="radio"
                    name="paymentMethod"
                    checked={paymentMethod === "cash"}
                    onChange={() => setPaymentMethod("cash")}
                    className="accent-terracotta"
                  />
                  <Icon name="payments" className="text-[18px] text-terracotta" />
                  Cash on delivery
                </label>
              </div>
            </div>
          </div>

          <div className="flex h-fit flex-col gap-4 rounded-xl border border-card-border bg-cream-dim/60 p-5 lg:sticky lg:top-20">
            <h3 className="font-serif text-lg font-medium text-espresso">
              Order summary
            </h3>

            {selectedPlan ? (
              <dl className="flex flex-col gap-2 text-sm">
                <div className="flex items-center justify-between">
                  <dt className="text-espresso/75">Plan</dt>
                  <dd className="font-medium text-espresso">{selectedPlan.label}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-espresso/75">Meals selected</dt>
                  <dd className="font-medium text-espresso">
                    {allowExtraMeals
                      ? `${selectedMeals.length} (min ${mealCount})`
                      : `${selectedMeals.length} of ${mealCount}`}
                  </dd>
                </div>
                <div className="flex items-center justify-between border-t border-card-border pt-2">
                  <dt className="font-semibold text-espresso">Total</dt>
                  <dd className="font-semibold text-terracotta">
                    {formatGbp(totalPriceGbp)}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-espresso/75">
                Choose a plan above to see your order summary.
              </p>
            )}

            {nextStepMessage && (
              <p className="flex items-start gap-1.5 text-sm text-espresso/75">
                <Icon name="info" className="mt-0.5 shrink-0 text-[16px]" />
                {nextStepMessage}
              </p>
            )}

            {submitError && (
              <p
                className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                role="alert"
              >
                <Icon name="error" className="shrink-0 text-[18px]" />
                {submitError}
              </p>
            )}

            <button
              type="button"
              disabled={!canCheckout || isSubmitting}
              onClick={handleCheckout}
              className={`flex w-full items-center justify-center gap-2 rounded-full px-6 py-3 font-semibold text-white shadow-md transition active:scale-[0.98] ${
                canCheckout && !isSubmitting
                  ? "bg-terracotta hover:bg-terracotta-dark hover:shadow-lg"
                  : "cursor-not-allowed bg-card-border text-espresso/60 shadow-none"
              }`}
            >
              <Icon name="lock" className="text-[18px]" />
              {isSubmitting
                ? paymentMethod === "cash"
                  ? "Placing order…"
                  : "Redirecting to payment…"
                : paymentMethod === "cash"
                  ? `Place order — pay ${selectedPlan ? formatGbp(totalPriceGbp) : ""} cash on delivery`
                  : `Pay ${selectedPlan ? formatGbp(totalPriceGbp) : ""}`}
            </button>

            <p className="flex items-center gap-1.5 text-xs text-espresso/70">
              <Icon name="lock" className="text-[14px]" />
              Secure checkout, encrypted end-to-end.
            </p>

            <div className="flex flex-col gap-1.5 border-t border-card-border pt-3">
              <span className="text-sm text-espresso/75">Need help ordering?</span>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <a
                  href={SUPPORT_PHONE_TEL}
                  className="flex items-center gap-1 text-sm font-medium text-terracotta hover:underline"
                >
                  <Icon name="call" className="text-[16px]" />
                  Call {SUPPORT_PHONE_DISPLAY}
                </a>
                <a
                  href={SUPPORT_PHONE_WHATSAPP}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-sm font-medium text-terracotta hover:underline"
                >
                  <Icon name="chat" className="text-[16px]" />
                  WhatsApp
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-card-border bg-white/95 shadow-[0_-4px_12px_rgba(0,0,0,0.08)] backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-medium text-espresso">
              {selectedPlan
                ? allowExtraMeals
                  ? `${selectedMeals.length} meal${selectedMeals.length === 1 ? "" : "s"} selected (min ${mealCount})`
                  : `${selectedMeals.length} of ${mealCount} meals selected`
                : "Choose a plan to get started"}
            </span>
            {selectedPlan && (
              <span className="text-sm font-semibold text-terracotta">
                {formatGbp(totalPriceGbp)}
              </span>
            )}
          </div>
          <button
            type="button"
            disabled={(!canCheckout && !canScrollToCheckoutForm) || isSubmitting}
            onClick={() => {
              if (canCheckout) {
                handleCheckout();
              } else if (canScrollToCheckoutForm) {
                checkoutSectionRef.current?.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                });
              }
            }}
            className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-5 py-2.5 text-sm font-semibold text-white shadow-md transition active:scale-[0.98] ${
              (canCheckout || canScrollToCheckoutForm) && !isSubmitting
                ? "bg-terracotta hover:bg-terracotta-dark"
                : "cursor-not-allowed bg-card-border text-espresso/60 shadow-none"
            }`}
          >
            <Icon name="lock" className="text-[16px]" />
            {isSubmitting
              ? paymentMethod === "cash"
                ? "Placing order…"
                : "Redirecting…"
              : canCheckout
                ? paymentMethod === "cash"
                  ? "Place order"
                  : `Pay ${formatGbp(totalPriceGbp)}`
                : canScrollToCheckoutForm
                  ? "Continue to checkout ↓"
                  : nextStepMessage ?? "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
