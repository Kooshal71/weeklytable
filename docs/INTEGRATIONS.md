# Third-party integrations

Four services. Each section says what it does, how it is wired in the code, how to set it up from scratch, and what breaks if it is wrong. Account owners are in `DEPLOYMENT.md`.

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
