import { prisma } from "@/lib/prisma";
import { Icon } from "@/components/Icon";
import { formatTime12h } from "@/lib/deliveryTime";
import {
  SUPPORT_PHONE_DISPLAY,
  SUPPORT_PHONE_TEL,
  SUPPORT_PHONE_WHATSAPP,
  SUPPORT_EMAIL_DISPLAY,
  SUPPORT_EMAIL_MAILTO,
} from "@/lib/contact";

// Delivery hours must always match live CutoffConfig — never hardcode a
// second copy of these values, or they'll drift the way the checkout copy
// once silently did.
export const dynamic = "force-dynamic";

export default async function ContactPage() {
  const cutoffConfig = await prisma.cutoffConfig.findUniqueOrThrow({
    where: { id: "default" },
  });

  return (
    <>
      <header className="border-b border-card-border px-6 py-14 text-center sm:py-20">
        <h1 className="font-serif text-4xl font-medium text-espresso sm:text-5xl">
          Get in touch
        </h1>
        <p className="mx-auto mt-3 max-w-md text-espresso/85">
          Questions about an order, a delivery, or the menu? We're happy to
          help.
        </p>
      </header>

      <section className="mx-auto max-w-3xl px-6 py-16 sm:py-20">
        <div className="grid gap-6 sm:grid-cols-2">
          <a
            href={SUPPORT_PHONE_TEL}
            className="flex flex-col gap-3 rounded-xl border border-card-border bg-white p-6 shadow-sm transition hover:border-terracotta hover:shadow-md"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-sage-light text-sage">
              <Icon name="call" className="text-[22px]" />
            </span>
            <div>
              <h2 className="font-serif text-lg font-medium text-espresso">
                Call us
              </h2>
              <p className="mt-1 text-espresso/85">{SUPPORT_PHONE_DISPLAY}</p>
            </div>
          </a>

          <a
            href={SUPPORT_PHONE_WHATSAPP}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col gap-3 rounded-xl border border-card-border bg-white p-6 shadow-sm transition hover:border-terracotta hover:shadow-md"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-sage-light text-sage">
              <Icon name="chat" className="text-[22px]" />
            </span>
            <div>
              <h2 className="font-serif text-lg font-medium text-espresso">
                WhatsApp
              </h2>
              <p className="mt-1 text-espresso/85">{SUPPORT_PHONE_DISPLAY}</p>
            </div>
          </a>

          <a
            href={SUPPORT_EMAIL_MAILTO}
            className="flex flex-col gap-3 rounded-xl border border-card-border bg-white p-6 shadow-sm transition hover:border-terracotta hover:shadow-md"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-sage-light text-sage">
              <Icon name="mail" className="text-[22px]" />
            </span>
            <div>
              <h2 className="font-serif text-lg font-medium text-espresso">
                Email us
              </h2>
              <p className="mt-1 text-espresso/85">{SUPPORT_EMAIL_DISPLAY}</p>
            </div>
          </a>
        </div>

        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <div className="rounded-xl border border-card-border bg-white p-6 shadow-sm">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sage-light text-sage">
                <Icon name="schedule" className="text-[22px]" />
              </span>
              <div>
                <h2 className="font-serif text-lg font-medium text-espresso">
                  Delivery hours
                </h2>
                <p className="mt-1 text-espresso/85">
                  Every day, between {formatTime12h(cutoffConfig.deliveryWindowStart)} and{" "}
                  {formatTime12h(cutoffConfig.deliveryWindowEnd)}. Choose your
                  exact time slot when you order.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-card-border bg-white p-6 shadow-sm">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sage-light text-sage">
                <Icon name="location_on" className="text-[22px]" />
              </span>
              <div>
                <h2 className="font-serif text-lg font-medium text-espresso">
                  Delivery area
                </h2>
                <p className="mt-1 text-espresso/85">
                  We currently deliver across Southend-on-Sea, 7 days a week.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
