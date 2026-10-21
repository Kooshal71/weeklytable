# Day-to-day operations

## Admin login

- First owner: `ADMIN_EMAIL=... ADMIN_PASSWORD=... npx tsx prisma/create-admin.ts` against the right `DATABASE_URL`.
- Re-running with the same email **resets that account's password** (and role if `ADMIN_ROLE` is set).
- After that, the owner adds and deactivates staff at Admin > Users. Accounts are never deleted, only deactivated.

## Maintenance mode

Admin > Settings > Maintenance mode (owner only). Takes effect in seconds, no deploy. To preview the real site while it is on, open `https://<domain>/?preview=<MAINTENANCE_BYPASS_SECRET>` once; it sets a 24 hour cookie for that browser.

## Dish photos

- Owner: Admin > Dishes > edit > choose a photo. No file means the existing photo is kept.
- Bulk photos: add files to `public/dishes/`, then point each dish at `/dishes/<file>.jpg`. `scripts/apply-batch2-photos.sql` is an example of the SQL for that. Run it only after the deploy that ships the image files.

## Orders

Admin > Orders shows each order and its per-meal delivery date and time. Cash orders are marked paid by hand. Each meal can be ticked off as fulfilled. The upcoming-deliveries report (under Orders) gives the delivery list.

## Troubleshooting

- **Site stuck on the maintenance page:** check Admin > Settings, and check `MAINTENANCE_MODE` is not set to `true` in Netlify.
- **Card payment taken but order still pending:** the Stripe webhook is failing. Check the endpoint URL and `STRIPE_WEBHOOK_SECRET` and look at the delivery attempts in the Stripe dashboard.
- **No confirmation emails:** one of the four `MS365_*` variables is missing, or the client secret has expired.
- **Deploy skipped "account credit usage exceeded":** Netlify credits are used up. Wait for the cycle to reset or upgrade the plan.
- **Prisma types look wrong after pulling:** `npx prisma generate`.
