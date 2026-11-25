import Link from "next/link";
import { Icon } from "@/components/Icon";
import { DELIVERY_GUARANTEE_MINUTES } from "@/lib/deliveryTime";

const STEPS = [
  {
    icon: "restaurant_menu",
    title: "Browse the menu",
    body: "Look through the week's dishes, filter by category or dietary tag, and see which days each one is available.",
  },
  {
    icon: "grid_view",
    title: "Pick a plan",
    body: "Choose how many meals you want for the week — the more meals, the lower the price per meal.",
  },
  {
    icon: "event",
    title: "Choose a day and time per meal",
    body: "Assign each meal to a delivery day, then set the time you'd like it to arrive.",
  },
  {
    icon: "credit_card",
    title: "Pay however suits you",
    body: "Pay by card at checkout, or choose cash on delivery — no account or subscription required.",
  },
  {
    icon: "delivery_dining",
    title: "We deliver, on time",
    body: `Every meal arrives within a guaranteed ${DELIVERY_GUARANTEE_MINUTES}-minute window of the time you picked.`,
  },
] as const;

export default function HowItWorksPage() {
  return (
    <>
      <header className="border-b border-card-border px-6 py-14 text-center sm:py-20">
        <h1 className="font-serif text-4xl font-medium text-espresso sm:text-5xl">
          How it works
        </h1>
        <p className="mx-auto mt-3 max-w-md text-espresso/85">
          Five steps from browsing the menu to a hot meal on your doorstep.
        </p>
      </header>

      <section className="mx-auto max-w-3xl px-6 py-16 sm:py-20">
        <ol className="flex flex-col gap-8">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex gap-5">
              <div className="flex flex-col items-center">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-terracotta text-white">
                  <Icon name={step.icon} className="text-[22px]" />
                </span>
                {index < STEPS.length - 1 && (
                  <span
                    aria-hidden="true"
                    className="mt-2 w-px flex-1 bg-card-border"
                  />
                )}
              </div>
              <div className="pb-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-terracotta">
                  Step {index + 1}
                </p>
                <h2 className="mt-1 font-serif text-xl font-medium text-espresso">
                  {step.title}
                </h2>
                <p className="mt-2 text-espresso/85">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-4 text-center">
          <Link
            href="/order"
            data-umami-event="cta-order"
            data-umami-event-location="how-it-works"
            className="inline-block rounded-full bg-terracotta px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-terracotta-dark hover:shadow-md"
          >
            Start your order
          </Link>
        </div>
      </section>
    </>
  );
}
