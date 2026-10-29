import { prisma } from "@/lib/prisma";
import { getEligibleWindow, getWeekday } from "@/lib/cutoff";
import { formatGuaranteeWindow, formatTime12h, getDeliveryTimeSlots } from "@/lib/deliveryTime";
import { UK_POSTCODE_RE, formatDeliveryAddress } from "@/lib/address";
import { SUPPORT_PHONE_DISPLAY } from "@/lib/contact";
import { isMaintenanceOn } from "@/lib/siteSettings";
import {
  EMAIL_RE,
  MAX_NOTES_LENGTH,
  placeOrder,
  planAcceptsMealCount,
  planSavingGbp,
  quoteOrderGbp,
  type PaymentMethodInput,
} from "@/lib/orders";
import {
  MAX_LIST_ROWS,
  sendWhatsAppMessage,
  type ListRow,
  type OutgoingMessage,
} from "@/lib/whatsapp/client";
import type { Prisma } from "@/generated/prisma/client";

// The WhatsApp ordering bot: one conversation row per chat, advanced one
// inbound message at a time. Mirrors the website's flow (plan, a dish plus
// day and time slot per meal, contact and address, then card or cash) and
// hands the finished order to placeOrder, which re-validates everything
// exactly as POST /api/orders does.
//
// Dishes are chosen from the WhatsApp catalogue cart (see catalog.ts);
// cart quantity = number of that meal. Everything else is picked from
// interactive buttons and lists, whose reply ids are prefixed by step
// ("plan:", "date:", ...) so a tap on an old message is recognised as stale.

export type InboundMessage = {
  id: string;
  from: string; // customer's wa_id, digits only
  profileName?: string;
} & (
  | { kind: "text"; text: string }
  | { kind: "reply"; replyId: string }
  | { kind: "order"; items: { retailerId: string; quantity: number }[] }
  | { kind: "other" }
);

type Step =
  | "idle"
  | "awaiting_cart"
  | "choose_plan"
  | "choose_date"
  | "choose_time"
  | "same_for_rest"
  | "name"
  | "email"
  | "address1"
  | "address2"
  | "city"
  | "postcode"
  | "notes"
  | "confirm";

type Draft = {
  dishIds?: string[]; // one entry per meal
  planId?: string;
  dates?: string[]; // per meal, "YYYY-MM-DD"
  times?: string[]; // per meal, "HH:MM"
  mealIndex?: number;
  timePage?: number;
  // Set by "same time, pick days": every later meal reuses this slot.
  fixedTime?: string;
  contactName?: string;
  contactEmail?: string;
  addressLine1?: string;
  addressLine2?: string | null;
  city?: string;
  postcode?: string;
  notes?: string | null;
};

type Conversation = { step: Step; draft: Draft; profileName: string | null };

const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const HUMAN_HANDOFF_MS = 24 * 60 * 60 * 1000;
const WELCOME_THROTTLE_MS = 24 * 60 * 60 * 1000;
const MAX_MEALS = 21;
// One list row is kept back for the "Later times" pager.
const TIME_PAGE_SIZE = MAX_LIST_ROWS - 1;

const ORDER_WORDS = new Set(["menu", "order", "start", "restart", "order food"]);
const CANCEL_WORDS = new Set(["cancel", "stop order"]);
const HELP_WORDS = new Set(["help", "how it works"]);
const HUMAN_WORDS = new Set(["human", "person", "agent", "talk to a person"]);

function formatGbp(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

/** "£40.00 (you save £10.00)", or just the total when there is no saving. */
function formatTotal(total: number, saving: number): string {
  return saving > 0 ? `${formatGbp(total)} (you save ${formatGbp(saving)})` : formatGbp(total);
}

function formatDateShort(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function welcomeMessage(profileName: string | null): OutgoingMessage {
  return {
    kind: "buttons",
    body:
      `Hi${profileName ? ` ${profileName}` : ""}! Welcome to Weekly Table 🍽️\n\n` +
      "Home-cooked meals delivered on the days you choose. You can order right here in WhatsApp, " +
      "or at weeklytable.co.uk.",
    buttons: [
      { id: "menu:browse", title: "Order on WhatsApp" },
      { id: "menu:how", title: "How it works" },
      { id: "menu:human", title: "Talk to a person" },
    ],
  };
}

const TALK_TO_A_PERSON =
  "This chat is our automated ordering assistant, so messages here aren't read by the team. " +
  `To speak to someone, please call or text us on ${SUPPORT_PHONE_DISPLAY}.`;

const HOW_IT_WORKS =
  "How it works:\n" +
  "1. Open the menu and add the meals you want to your cart (add 2 of a dish for 2 meals).\n" +
  "2. Send the cart. We'll match it to a weekly plan and show the price.\n" +
  "3. Pick a delivery day and time for each meal.\n" +
  "4. Give us your address, then pay by card or choose cash on delivery.\n\n" +
  "Type *menu* to start, or *cancel* at any time to start over.";

/** Handles one inbound WhatsApp message end to end: loads the chat's
 * state, works out the replies, saves the new state, sends the replies. */
export async function handleWhatsAppMessage(message: InboundMessage, origin: string): Promise<void> {
  const now = new Date();
  const row = await prisma.whatsAppConversation.findUnique({ where: { waId: message.from } });

  const profileName = message.profileName ?? row?.profileName ?? null;
  const expired = row ? now.getTime() - row.updatedAt.getTime() > DRAFT_TTL_MS : false;
  const conversation: Conversation = {
    step: row && !expired ? (row.step as Step) : "idle",
    draft: row && !expired ? (row.draft as Draft) : {},
    profileName,
  };

  const text = message.kind === "text" ? message.text.trim() : "";
  const word = text.toLowerCase();
  const replyId = message.kind === "reply" ? message.replyId : "";

  const wantsBot =
    ORDER_WORDS.has(word) || replyId.startsWith("menu:") || message.kind === "order";
  let humanUntil = row?.humanUntil ?? null;
  if (humanUntil && humanUntil > now) {
    // A person is handling this chat; only an explicit request brings the bot back.
    if (!wantsBot) return;
    humanUntil = null;
  }

  let lastWelcomeAt = row?.lastWelcomeAt ?? null;
  const replies: OutgoingMessage[] = [];
  let next: Conversation = conversation;

  if (HUMAN_WORDS.has(word) || replyId === "menu:human") {
    // Nobody reads this chat: the number runs on the Cloud API only, so
    // people are reached by a normal phone call or text.
    replies.push({ kind: "text", body: TALK_TO_A_PERSON });
  } else if (CANCEL_WORDS.has(word)) {
    next = { ...conversation, step: "idle", draft: {} };
    replies.push({ kind: "text", body: "Order cancelled. Type *menu* whenever you want to start again." });
  } else if (HELP_WORDS.has(word) || replyId === "menu:how") {
    replies.push({ kind: "text", body: HOW_IT_WORKS });
  } else if (ORDER_WORDS.has(word) || replyId === "menu:browse") {
    next = await startOrder(conversation, replies);
  } else if (message.kind === "order") {
    next = await receiveCart(conversation, message.items, replies);
  } else if (conversation.step === "idle") {
    // Unprompted chat: the full welcome once a day at most, a short pointer
    // otherwise. Nobody else answers here, so never stay silent.
    if (!lastWelcomeAt || now.getTime() - lastWelcomeAt.getTime() > WELCOME_THROTTLE_MS) {
      replies.push(welcomeMessage(profileName));
      lastWelcomeAt = now;
    } else {
      replies.push({
        kind: "text",
        body: `Type *menu* to order. ${TALK_TO_A_PERSON}`,
      });
    }
  } else {
    next = await advance(conversation, { text, replyId }, message.from, origin, replies);
  }

  await prisma.whatsAppConversation.upsert({
    where: { waId: message.from },
    update: {
      step: next.step,
      draft: next.draft as Prisma.InputJsonObject,
      profileName,
      humanUntil,
      lastWelcomeAt,
    },
    create: {
      waId: message.from,
      step: next.step,
      draft: next.draft as Prisma.InputJsonObject,
      profileName,
      humanUntil,
      lastWelcomeAt,
    },
  });

  for (const reply of replies) {
    const sent = await sendWhatsAppMessage(message.from, reply);
    // Meta refuses the catalogue message when no catalogue is linked or it
    // is under review. Never leave the customer with silence.
    if (!sent && reply.kind === "catalog") {
      await sendWhatsAppMessage(message.from, {
        kind: "text",
        body:
          "Sorry, our WhatsApp menu isn't available right now. You can order at weeklytable.co.uk, " +
          `or call us on ${SUPPORT_PHONE_DISPLAY}.`,
      });
      await prisma.whatsAppConversation.update({
        where: { waId: message.from },
        data: { step: "idle", draft: {} },
      });
    }
  }
}

/** The owner replied from the WhatsApp Business app on the same number
 * (coexistence): keep the bot quiet in that chat for a while. */
export async function pauseBotForChat(waId: string): Promise<void> {
  const humanUntil = new Date(Date.now() + HUMAN_HANDOFF_MS);
  await prisma.whatsAppConversation.upsert({
    where: { waId },
    update: { humanUntil },
    create: { waId, humanUntil },
  });
}

/** The per-meal price at each plan size, with neighbouring sizes at the
 * same rate merged: "• 1 or 2 meals: £11 each", "• 5 or more: £9 each". */
function planPriceLines(plans: { mealCount: number; priceGbp: number; allowExtraMeals: boolean }[]): string {
  const groups: { from: number; to: number; open: boolean; rate: number }[] = [];
  for (const p of [...plans].sort((a, b) => a.mealCount - b.mealCount)) {
    const rate = Math.round(p.priceGbp / p.mealCount);
    const last = groups.at(-1);
    if (last && !last.open && last.rate === rate && last.to + 1 === p.mealCount) {
      last.to = p.mealCount;
      last.open = p.allowExtraMeals;
    } else {
      groups.push({ from: p.mealCount, to: p.mealCount, open: p.allowExtraMeals, rate });
    }
  }
  return groups
    .map((g) => {
      const size = g.open
        ? `${g.from} or more`
        : g.from === g.to
          ? `${g.from} meal${g.from === 1 ? "" : "s"}`
          : g.to === g.from + 1
            ? `${g.from} or ${g.to} meals`
            : `${g.from} to ${g.to} meals`;
      const each = g.open || g.to > 1 ? " each" : "";
      return `• ${size}: ${formatGbp(g.rate).replace(/\.00$/, "")}${each}`;
    })
    .join("\n");
}

async function startOrder(conversation: Conversation, replies: OutgoingMessage[]): Promise<Conversation> {
  if (await isMaintenanceOn()) {
    replies.push({
      kind: "text",
      body: `Ordering is paused for a short while. Please try again later, or call us on ${SUPPORT_PHONE_DISPLAY}.`,
    });
    return { ...conversation, step: "idle", draft: {} };
  }
  const [thumbnail, plans] = await Promise.all([
    prisma.dish.findFirst({
      where: { isActive: true, NOT: { imageUrl: { endsWith: ".svg" } } },
      orderBy: { name: "asc" },
      select: { id: true },
    }),
    prisma.plan.findMany({ where: { isActive: true } }),
  ]);
  const prices = planPriceLines(plans);
  replies.push({
    kind: "catalog",
    body:
      "Here's this week's menu. Add the meals you want to your cart (2 of a dish = 2 meals), then tap *Send* in the cart." +
      (prices
        ? `\n\n💷 *The more you order, the less each meal costs:*\n${prices}\n\n` +
          "The menu shows the 1-meal price. Your discount is applied when you send your cart."
        : ""),
    thumbnailRetailerId: thumbnail?.id,
  });
  return { ...conversation, step: "awaiting_cart", draft: {} };
}

async function receiveCart(
  conversation: Conversation,
  cart: { retailerId: string; quantity: number }[],
  replies: OutgoingMessage[],
): Promise<Conversation> {
  if (await isMaintenanceOn()) {
    replies.push({ kind: "text", body: "Ordering is paused for a short while. Please try again later." });
    return { ...conversation, step: "idle", draft: {} };
  }

  const dishIds = cart.flatMap((item) =>
    Array.from({ length: Math.max(0, Math.floor(item.quantity)) }, () => item.retailerId),
  );
  const resend = { ...conversation, step: "awaiting_cart" as const, draft: {} };
  if (dishIds.length === 0) {
    replies.push({ kind: "text", body: "Your cart looks empty. Add some meals and send it again." });
    return resend;
  }
  if (dishIds.length > MAX_MEALS) {
    replies.push({
      kind: "text",
      body: `That's ${dishIds.length} meals. We can take up to ${MAX_MEALS} per order on WhatsApp, please send a smaller cart or order at weeklytable.co.uk.`,
    });
    return resend;
  }

  const uniqueIds = Array.from(new Set(dishIds));
  const dishes = await prisma.dish.findMany({
    where: { id: { in: uniqueIds }, isActive: true },
    select: { id: true },
  });
  if (dishes.length !== uniqueIds.length) {
    replies.push({
      kind: "text",
      body: "Some meals in that cart are no longer on the menu. Please remove them and send the cart again.",
    });
    return resend;
  }

  const plans = await prisma.plan.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });
  const matching = plans.filter((p) => planAcceptsMealCount(p, dishIds.length));
  const meals = `${dishIds.length} meal${dishIds.length === 1 ? "" : "s"}`;

  if (matching.length === 0) {
    const sizes = plans
      .map(
        (p) =>
          `• ${p.label}: ${p.allowExtraMeals ? `${p.mealCount} or more meals` : `${p.mealCount} meal${p.mealCount === 1 ? "" : "s"}`}`,
      )
      .join("\n");
    replies.push({
      kind: "text",
      body: `You've picked ${meals}, which doesn't match one of our plans:\n${sizes}\n\nPlease adjust your cart and send it again.`,
    });
    return resend;
  }

  const draft: Draft = { dishIds };
  const nameById = new Map(
    (await prisma.dish.findMany({ where: { id: { in: uniqueIds } }, select: { id: true, name: true } })).map(
      (d) => [d.id, d.name],
    ),
  );
  const mealList = dishIds.map((id, i) => `${i + 1}. ${nameById.get(id) ?? "Meal"}`).join("\n");
  if (matching.length === 1) {
    const plan = matching[0];
    replies.push({
      kind: "text",
      body: `Great, ${meals} on the *${plan.label}* plan: ${formatTotal(quoteOrderGbp(plan, dishIds.length), planSavingGbp(plan, dishIds.length, plans))} in total.\n\n${mealList}\n\nNow let's pick a day and time for each meal.`,
    });
    return beginMeal({ ...conversation, draft: { ...draft, planId: plan.id, dates: [], times: [] } }, 0, replies);
  }

  replies.push({
    kind: "list",
    body: `You've picked ${meals}:\n${mealList}\n\nWhich plan would you like?`,
    buttonLabel: "Choose plan",
    rows: matching.map((p) => ({
      id: `plan:${p.id}`,
      title: p.label,
      description: `${formatGbp(quoteOrderGbp(p, dishIds.length))} total`,
    })),
  });
  return { ...conversation, step: "choose_plan", draft };
}

async function cutoffConfig() {
  return prisma.cutoffConfig.findUniqueOrThrow({ where: { id: "default" } });
}

/** Dates in the current orderable window on which `dishId` is cooked. */
async function datesForDish(dishId: string): Promise<string[]> {
  const [config, dish] = await Promise.all([
    cutoffConfig(),
    prisma.dish.findUnique({ where: { id: dishId }, select: { availableDays: true } }),
  ]);
  if (!dish) return [];
  return getEligibleWindow(config).filter((date) => dish.availableDays.includes(getWeekday(date)));
}

/** "Katsu Curry Bowl", or "Katsu Curry Bowl (2nd of 2)" when the same
 * dish is in the order more than once, so repeats don't look like a glitch. */
async function mealLabel(dishIds: string[], index: number): Promise<string> {
  const name = await dishName(dishIds[index]);
  const total = dishIds.filter((id) => id === dishIds[index]).length;
  if (total === 1) return name;
  const nth = dishIds.slice(0, index + 1).filter((id) => id === dishIds[index]).length;
  const ordinal = ["1st", "2nd", "3rd"][nth - 1] ?? `${nth}th`;
  return `${name} (${ordinal} of ${total})`;
}

async function dishName(dishId: string): Promise<string> {
  const dish = await prisma.dish.findUnique({ where: { id: dishId }, select: { name: true } });
  return dish?.name ?? "this meal";
}

/** Asks for meal `index`'s delivery day, or moves on to contact details
 * once every meal has a day and time. */
async function beginMeal(conversation: Conversation, index: number, replies: OutgoingMessage[]): Promise<Conversation> {
  const draft = conversation.draft;
  const dishIds = draft.dishIds ?? [];
  // Meals already scheduled by a shortcut are skipped.
  while (index < dishIds.length && draft.dates?.[index] && draft.times?.[index]) index++;
  if (index >= dishIds.length) {
    return askName({ ...conversation, draft: { ...draft, mealIndex: index } }, replies);
  }

  const dates = await datesForDish(dishIds[index]);
  const name = await mealLabel(dishIds, index);
  if (dates.length === 0) {
    replies.push({
      kind: "text",
      body: `Sorry, ${name} isn't available on any day we can still deliver this week. Please swap it in your cart and send it again.`,
    });
    return { ...conversation, step: "awaiting_cart", draft: {} };
  }

  replies.push({
    kind: "list",
    body: `Meal ${index + 1} of ${dishIds.length}: *${name}*. Which day should we deliver it?`,
    buttonLabel: "Choose day",
    rows: dates.slice(0, MAX_LIST_ROWS).map((date) => ({ id: `date:${date}`, title: formatDateShort(date) })),
  });
  return { ...conversation, step: "choose_date", draft: { ...draft, mealIndex: index } };
}

async function askTime(conversation: Conversation, page: number, replies: OutgoingMessage[]): Promise<Conversation> {
  const slots = getDeliveryTimeSlots(await cutoffConfig());
  const pageCount = Math.max(1, Math.ceil(slots.length / TIME_PAGE_SIZE));
  const safePage = slots.length <= MAX_LIST_ROWS ? 0 : page % pageCount;
  const visible = slots.length <= MAX_LIST_ROWS ? slots : slots.slice(safePage * TIME_PAGE_SIZE, (safePage + 1) * TIME_PAGE_SIZE);

  const rows: ListRow[] = visible.map((slot) => ({
    id: `time:${slot}`,
    title: formatTime12h(slot),
    description: `Arrives ${formatGuaranteeWindow(slot)}`,
  }));
  if (slots.length > MAX_LIST_ROWS) {
    const last = safePage === pageCount - 1;
    rows.push({ id: `timepage:${last ? 0 : safePage + 1}`, title: last ? "Earlier times…" : "Later times…" });
  }

  const index = conversation.draft.mealIndex ?? 0;
  const date = conversation.draft.dates?.[index];
  replies.push({
    kind: "list",
    body: `What time on ${date ? formatDateShort(date) : "that day"}? We deliver within an hour of the time you pick.`,
    buttonLabel: "Choose time",
    rows,
  });
  return { ...conversation, step: "choose_time", draft: { ...conversation.draft, timePage: safePage } };
}

/** Records meal `index`'s slot, then offers shortcuts for the rest. */
async function afterTimeChosen(conversation: Conversation, replies: OutgoingMessage[]): Promise<Conversation> {
  const index = conversation.draft.mealIndex ?? 0;
  const total = conversation.draft.dishIds?.length ?? 0;
  if (index === 0 && total > 1) {
    replies.push({
      kind: "buttons",
      body: `Want the same for your other ${total - 1} meal${total - 1 === 1 ? "" : "s"}?`,
      buttons: [
        { id: "same:all", title: "Same day & time" },
        { id: "same:time", title: "Same time, pick days" },
        { id: "same:none", title: "Pick each one" },
      ],
    });
    return { ...conversation, step: "same_for_rest" };
  }
  return beginMeal(conversation, index + 1, replies);
}

async function applySameForRest(
  conversation: Conversation,
  choice: string,
  replies: OutgoingMessage[],
): Promise<Conversation> {
  const draft = conversation.draft;
  const dishIds = draft.dishIds ?? [];
  const firstDate = draft.dates?.[0];
  const firstTime = draft.times?.[0];
  if (!firstDate || !firstTime) return beginMeal(conversation, 0, replies);

  if (choice === "time") {
    return beginMeal({ ...conversation, draft: { ...draft, fixedTime: firstTime } }, 1, replies);
  }
  if (choice === "all") {
    const dates = [...(draft.dates ?? [])];
    const times = [...(draft.times ?? [])];
    const unavailable: string[] = [];
    for (let i = 1; i < dishIds.length; i++) {
      if ((await datesForDish(dishIds[i])).includes(firstDate)) {
        dates[i] = firstDate;
        times[i] = firstTime;
      } else {
        unavailable.push(await dishName(dishIds[i]));
      }
    }
    if (unavailable.length > 0) {
      const names = Array.from(new Set(unavailable));
      const scheduled = dates.filter(Boolean).length;
      replies.push({
        kind: "text",
        body:
          (scheduled > 1
            ? `Done: ${scheduled} meals are set for ${formatDateShort(firstDate)} at ${formatTime12h(firstTime)}.\n\n`
            : "") +
          `${names.join(", ")} ${names.length === 1 ? "isn't" : "aren't"} cooked on ${getWeekday(firstDate).replace(/^./, (c) => c.toUpperCase())}s, ` +
          `so please pick another day (same time, ${formatTime12h(firstTime)}).`,
      });
      return beginMeal({ ...conversation, draft: { ...draft, dates, times, fixedTime: firstTime } }, 1, replies);
    }
    return beginMeal({ ...conversation, draft: { ...draft, dates, times } }, dishIds.length, replies);
  }
  return beginMeal(conversation, 1, replies);
}

function askName(conversation: Conversation, replies: OutgoingMessage[]): Conversation {
  if (conversation.profileName) {
    replies.push({
      kind: "buttons",
      body: "All meals scheduled ✅\n\nWhat name should the order be under? Tap below or type a different name.",
      buttons: [{ id: "name:profile", title: `Use ${conversation.profileName}` }],
    });
  } else {
    replies.push({ kind: "text", body: "All meals scheduled ✅\n\nWhat name should the order be under?" });
  }
  return { ...conversation, step: "name" };
}

const skipButton = (body: string): OutgoingMessage => ({
  kind: "buttons",
  body,
  buttons: [{ id: "skip", title: "Skip" }],
});

async function summary(conversation: Conversation): Promise<string> {
  const d = conversation.draft;
  const dishIds = d.dishIds ?? [];
  const [plan, plans, dishes] = await Promise.all([
    prisma.plan.findUnique({ where: { id: d.planId ?? "" } }),
    prisma.plan.findMany({ where: { isActive: true } }),
    prisma.dish.findMany({ where: { id: { in: dishIds } }, select: { id: true, name: true } }),
  ]);
  const nameById = new Map(dishes.map((x) => [x.id, x.name]));
  const lines = dishIds
    .map((id, i) => ({ name: nameById.get(id) ?? "Meal", date: d.dates?.[i] ?? "", time: d.times?.[i] ?? "" }))
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
    .map((m) => `• ${m.name}, ${formatDateShort(m.date)} at ${formatTime12h(m.time)}`);
  const address = formatDeliveryAddress({
    addressLine1: d.addressLine1 ?? "",
    addressLine2: d.addressLine2 ?? null,
    city: d.city ?? "",
    postcode: d.postcode ?? "",
  });
  return [
    `*Your order: ${plan?.label ?? "plan"}*`,
    ...lines,
    "",
    `Total: *${plan ? formatTotal(quoteOrderGbp(plan, dishIds.length), planSavingGbp(plan, dishIds.length, plans)) : "?"}*`,
    `Name: ${d.contactName}`,
    `Email: ${d.contactEmail}`,
    `Address: ${address}`,
    ...(d.notes ? [`Notes: ${d.notes}`] : []),
  ].join("\n");
}

async function askConfirm(conversation: Conversation, replies: OutgoingMessage[]): Promise<Conversation> {
  replies.push({
    kind: "buttons",
    body: `${await summary(conversation)}\n\nHow would you like to pay?`,
    buttons: [
      { id: "pay:stripe", title: "Pay by card" },
      { id: "pay:cash", title: "Cash on delivery" },
      { id: "pay:cancel", title: "Cancel" },
    ],
  });
  return { ...conversation, step: "confirm" };
}

async function submit(
  conversation: Conversation,
  paymentMethod: PaymentMethodInput,
  waId: string,
  origin: string,
  replies: OutgoingMessage[],
): Promise<Conversation> {
  if (await isMaintenanceOn()) {
    replies.push({ kind: "text", body: "Ordering is paused for a short while. Please try again later." });
    return conversation;
  }

  const d = conversation.draft;
  const dishIds = d.dishIds ?? [];
  const result = await placeOrder(
    {
      planId: d.planId ?? "",
      items: dishIds.map((dishId, i) => ({
        dishId,
        deliveryDate: d.dates?.[i] ?? "",
        deliveryTime: d.times?.[i] ?? "",
      })),
      contactName: d.contactName ?? "",
      contactPhone: `+${waId}`,
      contactEmail: d.contactEmail ?? "",
      addressLine1: d.addressLine1 ?? "",
      addressLine2: d.addressLine2 ?? null,
      city: d.city ?? "",
      postcode: d.postcode ?? "",
      paymentMethod,
      notes: d.notes ?? null,
    },
    { origin, source: "whatsapp" },
  );

  if (!result.ok) {
    if (result.status === 502) {
      replies.push({
        kind: "text",
        body: "Sorry, we couldn't start the card payment. Please tap *Pay by card* again, or choose cash on delivery.",
      });
      return conversation;
    }
    // Dishes or plan changed under us: the cart has to be rebuilt.
    // Anything else (a day passed its cutoff, a time slot changed) only
    // needs the days and times picking again.
    if (/dish|plan|meal/i.test(result.error) && !/not available for delivery on/i.test(result.error)) {
      replies.push({ kind: "text", body: `${result.error}\n\nPlease send your cart again.` });
      return { ...conversation, step: "awaiting_cart", draft: {} };
    }
    replies.push({ kind: "text", body: `${result.error.replace(" — please refresh and choose again.", ".")} Let's pick the days again.` });
    return beginMeal({ ...conversation, draft: { ...d, dates: [], times: [], fixedTime: undefined } }, 0, replies);
  }

  const ref = result.orderId.slice(0, 8).toUpperCase();
  if (result.checkoutUrl) {
    replies.push({
      kind: "cta_url",
      body: `Order ${ref} is reserved. Tap below to pay securely by card. We'll confirm here as soon as payment goes through.`,
      label: "Pay now",
      url: result.checkoutUrl,
    });
  } else {
    replies.push({
      kind: "text",
      body: `Thank you! Order ${ref} is confirmed. Please have cash ready on delivery. We've emailed you the details.`,
    });
  }
  return { ...conversation, step: "idle", draft: {} };
}

/** Handles input for an order already in progress. */
async function advance(
  conversation: Conversation,
  input: { text: string; replyId: string },
  waId: string,
  origin: string,
  replies: OutgoingMessage[],
): Promise<Conversation> {
  const { text, replyId } = input;
  const d = conversation.draft;
  const colon = replyId.indexOf(":");
  const prefix = colon === -1 ? replyId : replyId.slice(0, colon);
  const value = colon === -1 ? "" : replyId.slice(colon + 1);

  switch (conversation.step) {
    case "awaiting_cart":
      replies.push({
        kind: "text",
        body: "Add meals to your cart from the menu above, then tap *Send* in the cart. Type *menu* to see it again.",
      });
      return conversation;

    case "choose_plan": {
      if (prefix === "plan") {
        const plan = await prisma.plan.findUnique({ where: { id: value } });
        const count = d.dishIds?.length ?? 0;
        if (plan && plan.isActive && planAcceptsMealCount(plan, count)) {
          return beginMeal({ ...conversation, draft: { ...d, planId: plan.id, dates: [], times: [] } }, 0, replies);
        }
      }
      replies.push({ kind: "text", body: "Please choose a plan from the list above." });
      return conversation;
    }

    case "choose_date": {
      const index = d.mealIndex ?? 0;
      if (prefix === "date" && (await datesForDish(d.dishIds?.[index] ?? "")).includes(value)) {
        const dates = [...(d.dates ?? [])];
        dates[index] = value;
        if (d.fixedTime) {
          const times = [...(d.times ?? [])];
          times[index] = d.fixedTime;
          return afterTimeChosen({ ...conversation, draft: { ...d, dates, times } }, replies);
        }
        return askTime({ ...conversation, draft: { ...d, dates } }, 0, replies);
      }
      replies.push({ kind: "text", body: "Please choose a day from the list above." });
      return conversation;
    }

    case "choose_time": {
      if (prefix === "timepage") return askTime(conversation, Number(value) || 0, replies);
      const index = d.mealIndex ?? 0;
      if (prefix === "time" && getDeliveryTimeSlots(await cutoffConfig()).includes(value)) {
        const times = [...(d.times ?? [])];
        times[index] = value;
        return afterTimeChosen({ ...conversation, draft: { ...d, times } }, replies);
      }
      replies.push({ kind: "text", body: "Please choose a time from the list above." });
      return conversation;
    }

    case "same_for_rest":
      if (prefix === "same") return applySameForRest(conversation, value, replies);
      replies.push({ kind: "text", body: "Please tap one of the options above." });
      return conversation;

    case "name": {
      const name = replyId === "name:profile" ? conversation.profileName ?? "" : text;
      if (name.trim() === "") {
        replies.push({ kind: "text", body: "Please type the name for the order." });
        return conversation;
      }
      replies.push({ kind: "text", body: "Thanks! What's your email address? We'll send your confirmation there." });
      return { ...conversation, step: "email", draft: { ...d, contactName: name.trim() } };
    }

    case "email":
      if (!EMAIL_RE.test(text)) {
        replies.push({ kind: "text", body: "That doesn't look like an email address. Please try again." });
        return conversation;
      }
      replies.push({ kind: "text", body: "Delivery address: what's the first line (house number and street)?" });
      return { ...conversation, step: "address1", draft: { ...d, contactEmail: text } };

    case "address1":
      if (text === "") {
        replies.push({ kind: "text", body: "Please type the first line of your address." });
        return conversation;
      }
      replies.push(skipButton("Second address line (flat, building)? Type it, or tap Skip."));
      return { ...conversation, step: "address2", draft: { ...d, addressLine1: text } };

    case "address2":
      replies.push({ kind: "text", body: "Town or city?" });
      return {
        ...conversation,
        step: "city",
        draft: { ...d, addressLine2: replyId === "skip" || text === "" ? null : text },
      };

    case "city":
      if (text === "") {
        replies.push({ kind: "text", body: "Please type your town or city." });
        return conversation;
      }
      replies.push({ kind: "text", body: "And your postcode?" });
      return { ...conversation, step: "postcode", draft: { ...d, city: text } };

    case "postcode":
      if (!UK_POSTCODE_RE.test(text)) {
        replies.push({ kind: "text", body: "That doesn't look like a UK postcode. Please try again (e.g. SW1A 1AA)." });
        return conversation;
      }
      replies.push(skipButton("Any notes for the kitchen or driver (allergies, door code)? Type them, or tap Skip."));
      return { ...conversation, step: "notes", draft: { ...d, postcode: text.toUpperCase() } };

    case "notes":
      if (text.length > MAX_NOTES_LENGTH) {
        replies.push({ kind: "text", body: `Please keep notes under ${MAX_NOTES_LENGTH} characters.` });
        return conversation;
      }
      return askConfirm(
        { ...conversation, draft: { ...d, notes: replyId === "skip" || text === "" ? null : text } },
        replies,
      );

    case "confirm":
      if (replyId === "pay:stripe" || replyId === "pay:cash") {
        return submit(conversation, value as PaymentMethodInput, waId, origin, replies);
      }
      if (replyId === "pay:cancel") {
        replies.push({ kind: "text", body: "Order cancelled. Type *menu* whenever you want to start again." });
        return { ...conversation, step: "idle", draft: {} };
      }
      return askConfirm(conversation, replies);

    default:
      return conversation;
  }
}

/** Called by the Stripe webhook once a WhatsApp order is paid. The customer
 * has just been chatting, so this lands inside WhatsApp's 24-hour reply
 * window and needs no pre-approved template. */
export async function notifyWhatsAppOrderPaid(order: {
  id: string;
  contactPhone: string;
  planLabelSnapshot: string;
  planPriceGbpSnapshot: number;
  items: { dishNameSnapshot: string; deliveryDate: Date; deliveryTime: string | null }[];
}): Promise<void> {
  const to = order.contactPhone.replace(/\D/g, "");
  if (!to) return;
  const lines = [...order.items]
    .sort((a, b) => a.deliveryDate.getTime() - b.deliveryDate.getTime())
    .map((item) => {
      const date = formatDateShort(item.deliveryDate.toISOString().slice(0, 10));
      return `• ${item.dishNameSnapshot}, ${date}${item.deliveryTime ? ` at ${formatTime12h(item.deliveryTime)}` : ""}`;
    });
  await sendWhatsAppMessage(to, {
    kind: "text",
    body:
      `Payment received, thank you! Order ${order.id.slice(0, 8).toUpperCase()} is confirmed ✅\n\n` +
      `*${order.planLabelSnapshot}* (${formatGbp(order.planPriceGbpSnapshot)})\n${lines.join("\n")}\n\n` +
      "We've emailed you the details too. Type *menu* to order again.",
  });
}
