# Third-party integrations

Five services. Each section says what it does, how it is wired in the code, how to set it up from scratch, and what breaks if it is wrong. Account owners are in `DEPLOYMENT.md`.

## Neon (Postgres database)

**Does:** stores everything: dishes, plans, orders, admin users, cutoff settings, the maintenance switch, and admin-uploaded dish photos.

**In the code:** `src/lib/prisma.ts` creates one Prisma client with the `@prisma/adapter-pg` driver adapter, reading `DATABASE_URL`. `prisma7.config.ts` points the Prisma CLI (migrations) at the same variable. Generated client output goes to `src/generated/prisma` (gitignored; created by `npm install`).

**Set up from scratch:**
1. Create a Neon project in an EU region (London or Frankfurt, for GDPR).
2. Copy the connection string (with `sslmode=require`) into `DATABASE_URL`.
3. `npx prisma migrate deploy`, then optionally `npm run db:seed`, then create an admin (see README).

**Environments:** production and staging use two separate Neon databases with their own connection strings. Local development should use a third (a Neon branch is the easiest way). Migrations are not run by the deploy, so apply each one by hand to each database.

**If wrong:** the whole site errors. Exception: the maintenance check fails open, so a database outage will not lock everyone onto the maintenance page.

**Limits:** the free tier is 0.5 GB. Uploaded dish photos are about 200 to 400 KB each. The compute scales to zero, so the first request after idle can be slow.

## Stripe (card payments)

**Does:** takes card payment through hosted Stripe Checkout. The site never sees card details.

**In the code:**
- `src/lib/stripe.ts` creates the client from `STRIPE_SECRET_KEY`.
- `POST /api/orders` saves the order as `pending_payment`, then creates a Checkout Session (`mode: "payment"`, currency `gbp`, `metadata.orderId`). Success and cancel URLs use the request origin.
- `POST /api/webhooks/stripe` verifies the signature with `STRIPE_WEBHOOK_SECRET`, handles `checkout.session.completed`, marks the order `paid`, stores the payment intent id and sends the confirmation email.
- Cash orders skip Stripe entirely.

**Set up from scratch:**
1. Create a Stripe account in the business owner's name.
2. Developers > API keys: copy the secret key into `STRIPE_SECRET_KEY` (`sk_test_` for dev and staging, `sk_live_` for production).
3. Developers > Webhooks > Add endpoint: `https://<domain>/api/webhooks/stripe`, event `checkout.session.completed` only. Copy its signing secret into `STRIPE_WEBHOOK_SECRET`.
4. Redeploy so the new variables load.

**Local testing:** install the Stripe CLI, run `stripe listen --forward-to localhost:3000/api/webhooks/stripe`, and use the `whsec_...` it prints as `STRIPE_WEBHOOK_SECRET` in `.env`. Test card `4242 4242 4242 4242`.

**Test and live are fully separate:** keys, webhook endpoints and webhook secrets. When going live, replace all of them together.

**If wrong:** customers pay but orders stay `pending_payment`. Check the delivery attempts under the webhook in the Stripe dashboard, then the signing secret.

## Microsoft 365 (confirmation emails)

**Does:** emails the customer an order confirmation, sent from `info@weeklytable.co.uk`, using the Microsoft Graph `sendMail` API. It uses an app (client-credentials) login rather than a person's password.

**In the code:** `src/lib/mail.ts` gets a token from `login.microsoftonline.com/<tenant>/oauth2/v2.0/token` (cached until a minute before expiry), then POSTs to `graph.microsoft.com/v1.0/users/<sender>/sendMail`. Messages are saved to the sender's Sent Items. A missing variable skips the email with a warning, and a failed send is logged but never blocks the order.

**Set up from scratch (Azure portal, as a tenant admin):**
1. Microsoft Entra ID > App registrations > New registration (single tenant). Note the **Application (client) ID** (`MS365_CLIENT_ID`) and **Directory (tenant) ID** (`MS365_TENANT_ID`).
2. Certificates & secrets > New client secret. Copy the **Value** immediately (`MS365_CLIENT_SECRET`) and note the expiry date.
3. API permissions > Add > Microsoft Graph > **Application permissions** > `Mail.Send` > Grant admin consent.
4. Set `MS365_SENDER_EMAIL` to the mailbox that sends, which must exist and be licensed.
5. Recommended: restrict the app to that one mailbox with an Exchange Online application access policy. Without one, `Mail.Send` lets the app send as any mailbox in the tenant.

**Gotchas:**
- **The current client secret expires on 3 October 2028.** Create its replacement in Azure by early September 2028, update `MS365_CLIENT_SECRET` in Netlify, redeploy, then delete the old secret.
- The client secret expires (the maximum is 24 months). When it does, emails stop silently. Put a reminder in the calendar and create the replacement before expiry.
- Microsoft has temporarily throttled outbound mail from new tenants before. Sends then failed until the limit lifted.
- Failures show in the Netlify function logs as `sendOrderConfirmationEmail: Graph sendMail failed: <status>`.

## WhatsApp (ordering bot and catalogue, Meta Cloud API)

**Does:** lets customers browse every dish in a WhatsApp catalogue and order in the chat on +44 7803 170599. The number runs on the Cloud API only (not in the WhatsApp Business app), so every WhatsApp message is answered by the bot; people reach the team by a normal call or text to the same number. Meta's "coexistence" (app and API on one number) was ruled out: it needs a Meta partner, and Meta lists catalogue and orders as unsupported there.

**How a WhatsApp order works:** the customer taps *Order on WhatsApp* (or types *menu*) and picks a category from a list, which sends that category's dishes as product messages (up to 30 per message). They can also type a dish or ingredient to search, or open the whole catalogue with *See everything*. They add meals to the cart from any of these (2 of a dish = 2 meals; one cart per chat, so it builds up across categories) and send it. The bot matches the meal count to a plan, then asks for a day and time per meal (only days that dish is cooked), name, email, address and notes, shows the total, and offers *Pay by card* (a Stripe Checkout link) or *Cash on delivery*. When Stripe confirms payment, the customer also gets a WhatsApp confirmation. Orders appear in Admin > Orders with a WhatsApp badge and a "Placed via" filter. WhatsApp allows one fixed price per product, so the catalogue shows the full single-meal price and lists the plan rates in each description; the menu message lists them too. The bot quotes the real plan total, with the saving against the full price, before payment.

**Talking to a person:** nobody reads the bot's chats. The bot sends its full welcome at most once a day per chat, and answers any other unprompted message with a short "type *menu*, or call or text us" pointer. *Talk to a person* (or typing *human*) gives the phone number. Customers can type *menu*, *cancel* or *help* at any time.

**In the code:**
- `POST /api/webhooks/whatsapp` checks Meta's `X-Hub-Signature-256` with `WHATSAPP_APP_SECRET`, ignores repeated deliveries, and runs the bot. `GET` on the same URL answers Meta's verification with `WHATSAPP_VERIFY_TOKEN`.
- `src/lib/whatsapp/bot.ts` is the conversation. Each chat's progress is a `WhatsAppConversation` row; drafts expire after 24 hours.
- Orders go through `placeOrder` in `src/lib/orders.ts`, the same checks as the website.
- `src/lib/whatsapp/catalog.ts` copies dishes to the Meta catalogue (`retailer_id` = dish id). It runs after every dish save in the admin and from Admin > Settings > *Sync catalogue now*. Dishes still on the placeholder image are left out (Meta needs a JPEG or PNG). Switched-off dishes are hidden, not deleted.
- `src/lib/whatsapp/client.ts` sends messages. The Graph API version is the `GRAPH_API_VERSION` constant; Meta retires versions after about two years.
- During maintenance mode the bot replies that ordering is paused.

**Set up from scratch (owner, in Meta's tools):**
1. **Business portfolio.** In business.facebook.com, create or use the Weekly Table business portfolio. Start business verification (needed for higher messaging limits).
2. **Meta app.** developers.facebook.com > My Apps > Create app > type *Business*, linked to that portfolio. Add the *WhatsApp* product. Note the **App secret** (App settings > Basic) for `WHATSAPP_APP_SECRET`.
   In the app's use cases, also add *Manage products with Catalog API*; without it the token cannot get `catalog_management`.
3. **Add the number.** It must not be on any WhatsApp app: if it is on the WhatsApp Business app, export any chats worth keeping, then delete the account there (Settings > Account > Delete my account). Calls and texts are unaffected. Then App dashboard > WhatsApp > API Setup > *Add phone number*: display name *Weekly Table* (Meta reviews it, 1 to 3 days), verify by SMS. Note the **Phone number ID** for `WHATSAPP_PHONE_NUMBER_ID` and the **WhatsApp Business Account ID**. Register the number: `POST /{phone-number-id}/register` with `messaging_product=whatsapp` and a 6-digit `pin` (that becomes its two-step PIN). Add a payment method under Billing: Meta charges beyond the free tier (see Costs).
4. **Catalogue.** Commerce Manager > Add catalogue > *Online products* (not a local or restaurant type), owned by the same portfolio. The business email must be confirmed. Link it to the WhatsApp account with `POST /{waba-id}/product_catalogs?catalog_id=...` (the WhatsApp Manager button stays greyed out for some accounts), then turn on the storefront and cart with `POST /{phone-number-id}/whatsapp_commerce_settings?is_catalog_visible=true&is_cart_enabled=true`. Note the **Catalogue ID** for `WHATSAPP_CATALOG_ID`. One catalogue per WhatsApp account.
5. **Permanent token.** Business settings > Users > System users > Add (admin). Assign it the app, the WhatsApp account and the catalogue (full control). Generate a token with `whatsapp_business_messaging`, `whatsapp_business_management` and `catalog_management`, never expiring. That is `WHATSAPP_ACCESS_TOKEN`. A token's scopes are fixed when it is generated, so generate a new one after adding a use case.
6. **Netlify.** Add the four values noted above (`WHATSAPP_APP_SECRET`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_CATALOG_ID`, `WHATSAPP_ACCESS_TOKEN`), plus `WHATSAPP_VERIFY_TOKEN` set to any long random string. Do not set `WHATSAPP_DRY_RUN`. Apply the database migration, then deploy.
7. **Webhook.** App dashboard > WhatsApp > Configuration > Webhook: callback URL `https://weeklytable.co.uk/api/webhooks/whatsapp`, verify token = `WHATSAPP_VERIFY_TOKEN`. Subscribe to the `messages` field. Then subscribe the app to the WhatsApp account with `POST /{waba-id}/subscribed_apps`; without this Meta delivers nothing, and no error shows anywhere. Switch the app to *Live* (needs a privacy policy URL).
8. **Fill the catalogue.** Admin > Settings > WhatsApp > *Sync catalogue now*. Products appear in Commerce Manager within a few minutes, but WhatsApp only shows them once Meta has reviewed each one (`capability_to_review_status` WHATSAPP = APPROVED, typically 30 minutes to a few hours). Any later change to a dish's name, description, price or photo sends it back to review; until then the menu message fails with `131009 Products not found in FB Catalog` and the bot tells the customer the menu is unavailable.
9. **Test** from a personal phone: message the number, open the menu, add meals, *Place order*, and finish the order. Meta's free test number can browse the catalogue but cannot send a cart ("Something went wrong"), so test carts on the real number, or with the simulator below.

**Local testing:** set `WHATSAPP_APP_SECRET` (any value) and `WHATSAPP_DRY_RUN=true` in `.env`, run `npm run dev`, then send fake messages with `npx tsx scripts/whatsapp-simulate.ts text "menu"`, `... reply "date:2026-11-02"` or `... order "<dishId>:2"`. The bot's replies print in the dev server console.

**Costs and limits:** Meta charges per message the business sends; customers' messages are free. The bot only sends service messages (replies within 24 hours of the customer's last message): the first 1,000 a month per number are free, then about £0.016 each in the UK (from 1 October 2026). An order takes roughly 12 to 25 bot messages. Messages the business starts after the 24 hours need a Meta-approved template and cost more; the bot never sends them. Interactive lists show at most 10 options, so times are split across pages. WhatsApp orders are capped at 21 meals (`MAX_MEALS` in `bot.ts`).

**If wrong:**
- Bot silent: check the Netlify function logs for `WhatsApp webhook` errors, that the webhook shows as verified in the Meta app, and that the token has not been revoked. A `401` on send means a bad or expired token.
- `Invalid signature` in logs: `WHATSAPP_APP_SECRET` does not match the app.
- Catalogue empty or stale: see the last sync result in Admin > Settings. Product errors (for example a rejected image) show in Commerce Manager > Catalogue > Issues.
- "Menu isn't available right now": the catalogue is unlinked, or its products are still in Meta's review (see step 8).

## Netlify (hosting)

**Does:** builds and runs the Next.js app (server-rendered pages, API routes, server actions, `src/proxy.ts`) and serves the domain over HTTPS.

**In the code:** nothing Netlify-specific. There is no `netlify.toml`; the Next.js runtime is auto-detected. The runtime filesystem is read-only, which is why admin photo uploads go to the database and not to disk.

**Set up from scratch:**
1. New site > Import from Git > pick the repo, production branch `main`, build command `npm run build`.
2. Site configuration > Environment variables: add everything in `.env.example` (except `ADMIN_*`).
3. Domain management > add `weeklytable.co.uk` and follow its DNS instructions at GoDaddy.
4. Keep branch deploys and deploy previews off unless wanted; they cost credits.

**Gotchas:**
- Environment variable changes only apply to the next deploy.
- On the free plan a deploy costs about 15 of roughly 300 monthly credits. When credits run out, builds are skipped (the message reads "Skipped due to account credit usage exceeded") and the site keeps running the last good deploy.
- The maintenance switch lives in the database, so it works even when no deploy is possible.

## Domain (GoDaddy)

weeklytable.co.uk is registered there. Only DNS records need to change when the host changes: the root domain and `www` point to Netlify, and the Microsoft 365 mail records (MX, SPF, DKIM, and the verification TXT) must be left untouched or email stops.
