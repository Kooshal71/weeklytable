# Weekly Table

A meal-delivery ordering site for weeklytable.co.uk. Customers pick a plan (a number of meals), choose a dish and a delivery day/time slot for each meal, and pay once by card (Stripe Checkout) or choose cash. There are no customer accounts. An owner-run admin panel manages orders, the menu, plans, delivery settings and staff logins.

## Stack

- Next.js 16 (App Router, TypeScript) and Tailwind CSS 3
- Postgres on Neon, accessed through Prisma 7 (`@prisma/adapter-pg`)
- Stripe Checkout and a webhook for card payments
- Microsoft 365 Graph API for order confirmation emails
- Hosting on Netlify (free plan, credit-based)

> **Read this first:** this Next.js version has breaking changes from older releases. `AGENTS.md` tells coding agents to read the guides in `node_modules/next/dist/docs/` before changing framework-level code. Notably, `src/proxy.ts` replaces `middleware.ts`.

## Run it on a new machine

Requirements: Node.js 20+ and npm, and a Postgres database (a free Neon project is fine).

```bash
git clone <repo-url> weeklytable && cd weeklytable
npm install            # also runs `prisma generate` (postinstall)
cp .env.example .env   # then fill in the values, see below
npx prisma migrate deploy      # create the tables in your database
npm run db:seed                # optional: starter dishes, plans, cutoff config
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='choose-a-long-one' \
  npx tsx prisma/create-admin.ts   # create the first owner login
npm run dev            # http://localhost:3000, admin at /admin
```

Use a **separate database for local work**. Never point `.env` at the production database: the maintenance switch, orders and dish edits are all live data.

Useful checks before pushing: `npx tsc --noEmit`, `npm run lint`, `npm run build`.

## Environment variables

Documented in `.env.example`. Summary:

| Variable | Needed for |
| --- | --- |
| `DATABASE_URL` | Neon connection string (pooled is fine) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Card payments. Use `sk_test_` keys locally |
| `SESSION_SECRET` | Signing admin session cookies. Any long random string. Changing it logs everyone out |
| `MAINTENANCE_BYPASS_SECRET` | Lets you preview the site during maintenance via `/?preview=<secret>` |
| `MAINTENANCE_MODE` | Leave empty. If `true` it forces maintenance on and overrides the admin switch |
| `MS365_TENANT_ID`, `MS365_CLIENT_ID`, `MS365_CLIENT_SECRET`, `MS365_SENDER_EMAIL` | Confirmation emails. If any is missing, emails are skipped without error |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_ROLE` | Only for `prisma/create-admin.ts`, passed on the command line |

There is no site-URL variable. Stripe return URLs use the origin of the incoming request, so the app works on any domain.

## How things work

- **Ordering flow:** `src/components/MenuBrowser.tsx` (client) builds the order. `POST /api/orders` validates everything again on the server (day availability, cutoff, plan size, address, time slot) and either creates a Stripe Checkout session or a cash order.
- **Payment confirmation:** Stripe calls `POST /api/webhooks/stripe` (event `checkout.session.completed`), which marks the order paid and sends the confirmation email.
- **Cutoff and delivery window:** one `CutoffConfig` row, edited in Admin > Settings. Logic in `src/lib/cutoff.ts` and `src/lib/deliveryTime.ts`.
- **Addresses:** structured UK fields (line 1, line 2, city, postcode), validated in `src/lib/address.ts`.
- **Admin:** `/admin`, with roles `owner` (everything), `kitchen` (orders and the upcoming report), `delivery` (upcoming report only). Sessions are signed JWT cookies. `src/proxy.ts` is an optimistic check, and every server action re-checks via `src/lib/dal.ts` (`requireRole`).
- **Dish photos:** shipped photos live in `public/dishes/`. Photos uploaded in the admin are stored in Postgres (`DishImage`) and served from `/api/dish-images/<id>`, because Netlify's filesystem is read-only. The browser shrinks photos before upload, and the server checks the real file type.
- **Maintenance mode:** the owner switch in Admin > Settings is stored in the `SiteSetting` table and takes effect within seconds, with no redeploy. `/admin` and `/api` are never gated, so the owner can always switch it off. Read in `src/proxy.ts` through `src/lib/siteSettings.ts`.
- **Code layout:** pages in `src/app/(site)/`, admin in `src/app/admin/`, API routes in `src/app/api/`, shared logic in `src/lib/`, schema and migrations in `prisma/`.

## Database changes

1. Edit `prisma/schema.prisma`.
2. `npx prisma migrate dev --name what_changed` against your **local/dev** database.
3. Commit the new folder in `prisma/migrations/`.
4. Apply it to each real database with `npx prisma migrate deploy` (with that database's `DATABASE_URL`). Deploying does **not** run migrations automatically.
5. Run `npx prisma generate` if types look stale (it also runs on `npm install`).

Production and staging used two separate Neon databases. A migration that adds a required column will fail if existing rows have no value, so add it as optional or with a default.

## Deploying

- `docs/INTEGRATIONS.md`: Neon, Stripe, Microsoft 365 and Netlify setup from scratch, with gotchas.
- `docs/DEPLOYMENT.md`: where everything lives and the account hand-over checklist.
- `docs/OPERATIONS.md`: day-to-day admin tasks and troubleshooting.
- `docs/OPEN_ITEMS.md`: known loose ends and what is still to do.

Workflow rule: test locally and push to `main` only when a milestone is done. Every push to `main` costs Netlify build credits.
