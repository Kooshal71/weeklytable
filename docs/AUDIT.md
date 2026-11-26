# UI/UX audit

A review of every customer and admin page from 24 November 2026, done by reading the code (the site was not checked on a real phone). Tick an item when its fix is merged, and name the PR. IDs match the original audit write-up.

Severity: **H** high, **M** medium, **L** low. Items marked *(phone)* came from reading the layout code and should be confirmed on a real phone first.

## 1. Before promoting the site

- [ ] **C1 (H) Allergen information.** UK rules for food sold online generally require the 14 major allergens to be available before purchase and at delivery. There is no allergen field on dishes (`DishForm.tsx`, schema) and nothing on the menu or order pages. Confirm the exact requirement with an adviser.
- [ ] **C2 (H) Privacy policy.** The site collects names, addresses, phones and emails, and now uses Umami analytics. Add a privacy notice page and link it from the footer.
- [ ] **C3 (H) Terms and refund policy.** Cancellations, late deliveries, what the 1-hour guarantee promises, refunds. Link from the footer.
- [ ] **A4 (H) Delivery area check.** Any UK postcode is accepted, but delivery is Southend-on-Sea only. Check the postcode area on the page and in `api/orders/route.ts`, with a clear "we don't deliver there yet" message.
- [ ] **A1 (H) Order lost after Stripe cancel or Back.** Stripe's cancel link returns to `/order?checkout=cancelled`, and the page starts empty. Save the order in progress in `sessionStorage`, restore it, and show a "payment cancelled, your order is still here" banner.
- [ ] **A2 (H) Errors in developer language.** Server messages like "contactEmail must be a valid email address." reach customers, and only appear in the summary card. Validate fields as the customer goes, show plain-English errors under each field, and reword the server messages.
- [ ] **A3 (H) Checkout form.** No `<form>` element (Enter does nothing, `required` never runs) and no `autocomplete` hints, so phones can't autofill name, phone, email, address or postcode (`MenuBrowser.tsx`, delivery details).
- [ ] **F1 (H) Invalid timezone breaks ordering.** Admin > Settings only checks the timezone isn't empty. A value like "London" saves, then `Intl.DateTimeFormat` throws on `/order`, the order API and Upcoming deliveries. Use a dropdown or validate it (`settings/actions.ts`).

## 2. Mobile pass

- [ ] **D1 (H) Header too wide on phones** *(phone)*. The nav pill doesn't wrap and is about 420px wide at the scaled text size. Use a compact menu under 640px (`(site)/layout.tsx`).
- [ ] **A5 (H) Order bottom bar too wide** *(phone)*. The button is `whitespace-nowrap shrink-0` and shows long messages. Use a short label and move the guidance to the left text.
- [ ] **D2 (H) Contrast.** White on terracotta is 4.23:1 and terracotta text on cream 3.96:1 (AA needs 4.5:1); the per-meal price on the selected plan is 2.86:1. Use `terracotta-dark` (5.90:1). *Done on `/menu` in PR #2; other pages still open.*
- [ ] **A9 (M) Time picker.** Each chosen meal shows 13 small time buttons, plus a second row that only applies to meals added later. Use one dropdown per meal, defaulting to the day's time.
- [ ] **F3 (H) Driver screen on phones** *(phone)*. Upcoming deliveries uses 8-column tables with no horizontal scroll, phones aren't tap-to-call, addresses don't open in Maps, cash paid/unpaid isn't shown, and drivers can't mark a meal delivered. Use a card layout on small screens.

## 3. Order flow polish

- [x] **A6 (M) Changing plan clears picked meals.** Fixed in PR #2: meals are kept, and a smaller fixed plan drops only the most recently added ones.
- [ ] **A7 (M) Default plan.** "Most popular" sits on the 3-meal plan, but the 1-meal plan is preselected, and step 1 shows as done before anything is chosen.
- [ ] **A8 (M) Full plan gives no explanation.** Other dishes fade to 40% with no message. Say "plan full, remove a meal to swap", or let a tap replace the meal for that day.
- [ ] **A10 (M) Raw dates.** The chosen-meals list and confirmation page show "2026-11-25". Use "Wed 25 Nov".
- [ ] **A11 (M) Pay button disabled until valid.** Keep it enabled and, on press, scroll to and highlight the first problem.
- [ ] **A12 (L) Checkout security text.** "Secure checkout, encrypted end-to-end" also shows for cash and isn't accurate. Use "Card payments are handled securely by Stripe."
- [ ] **A13 (M) No order reference on the confirmation page.** Show a short reference customers can quote.
- [ ] **A14 (L) Confirmation help links.** The "couldn't find that order" and "still processing" messages say "contact us" without a phone or WhatsApp link.
- [ ] **A15 (L) Cash confirmation email.** Cash orders don't mention the confirmation email, although one is sent.
- [ ] **A16 (L) What happens next.** Add a short note on the confirmation page (delivery window, have the exact amount ready, etc.).

## 4. Content

- [ ] **B1 (M) Vegan promised but not offered.** The home page says vegan is catered for; the dietary tags are Vegetarian, Gluten-free and High-protein.
- [ ] **B2 (M) How It Works describes missing features.** It mentions a dietary filter on the order page and showing which days dishes are available. Neither exists on `/order` (both are on `/menu` since PR #2).
- [x] **B3 (M) Thin menu page.** Fixed in PR #2: photos, descriptions, availability, filters, prices and Add to order.
- [ ] **B4 (M) Home hero button.** The only hero button is "How it works". Make Order now the main one and add "See the menu".
- [ ] **B5 (L) Hardcoded cutoff example.** "Order by 6 PM Monday for Tuesday delivery" is only right while lead days is 1.

## 5. Accessibility

- [ ] **D3 (M) Toggle state and labels.** Plan cards, day tabs, time buttons and filters need `aria-pressed`; the order-page search box needs a label; dish cards are buttons containing `<p>`. *Done on `/menu` in PR #2; `/order` still open.*
- [ ] **D4 (M) Small tap targets.** The ✕ remove button and the time buttons (about 26px) are under 44px.
- [ ] **D5 (M) Current page in the nav.** Highlight it and set `aria-current`.
- [ ] **D6 (L) Reduced motion.** Hover lifts, press scaling and smooth scrolling have no `motion-reduce:` variants.

## 6. Performance and search

- [ ] **E1 (M) Icon font.** The Material Symbols stylesheet loads every icon and style, blocks rendering, and shows icon names as text until it loads. Add `&icon_names=…` or use inline SVGs (`app/layout.tsx`).
- [ ] **E2 (M) Image sizes.** Dish images on `/order` have no `sizes`, so phones download oversized files. *Done on `/menu` in PR #2.*
- [ ] **E3 (M) Page titles and sharing.** Every page except `/menu` is titled "Weekly Table". Add per-page titles and descriptions, an Open Graph image, `sitemap.xml` and `robots.txt`. *`/menu` done in PR #2.*
- [ ] **E4 (L) Language.** Set `lang="en-GB"`.
- [ ] **E5 (M) 404 and error pages.** There's no `not-found.tsx` or `error.tsx`, so visitors get the plain Next.js pages with no header or way back.

## 7. Admin panel

- [ ] **F2 (H) Admin errors show a crash page.** Server actions throw (e.g. "Delivery window start must be before its end") and there's no error page, so staff lose their input. Return the error and show it next to the field.
- [ ] **F4 (M) Admin nav.** Doesn't wrap on small screens and doesn't highlight the current page.
- [ ] **F5 (M) Orders list.** Raw status names ("pending_payment"), only the status links to the order, dates in UTC (evening orders in summer land on the wrong day), no search, no paging.
- [ ] **F6 (M) Order detail.** No confirmation before Cancel order, raw timestamp, and two different "Mark fulfilled" buttons with no explanation.
- [ ] **F7 (L) Settings.** Confusing help text, maintenance section above the page heading, no "Saved" message.
- [ ] **F8 (L) Users.** Role changes save with no feedback, raw role names, no way to reset an existing user's password.
- [ ] **F9 (M) Dishes.** No photo thumbnails in the list; no allergen or vegan options in the form (see C1, B1).
