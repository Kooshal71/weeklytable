# Open items

Known loose ends as of 21 October 2026. Delete a line when it is done.

## Before real customers arrive

- **Admin password reset.** The original owner password was not recorded. Reset it with `ADMIN_EMAIL=... ADMIN_PASSWORD=... npx tsx prisma/create-admin.ts` against the production `DATABASE_URL` (re-running with the same email resets the password), then store it in a password manager.
- **Test order in production.** A paid test order (id starting `202e7772`) exists in the production database. Refund it in Stripe if it was a live charge, and delete the order (and its items) from the database so it does not appear in the owner's reports.
- **Dish photos.** 31 active dishes still show the placeholder image. The owner can add them from Admin > Dishes. The 24 prepared batch-2 photos ship in `public/dishes/` and are applied with `scripts/apply-batch2-photos.sql` after the deploy (see `DEPLOYMENT.md`, Release checklist).

## Clean-up

- **Old Vercel project and webhook.** The site was first deployed on Vercel. Delete the Vercel project and its test Stripe webhook endpoint once the new Netlify site is confirmed working.
- **Accounts owned by the developer's family member.** The GitHub repo, Neon database and Netlify site were created under a personal account that is not the business owner's. Hand-over steps are in `DEPLOYMENT.md`. Rotate secrets afterwards.

## Optional hardening

- **Admin login rate limit.** `/api/admin/login` has no attempt limit. Add one (for example per IP and per email) before the admin is widely shared.
- **Audit log.** There is no record of who changed a dish, plan or setting. Orders and settings edits are not attributed to a user.

## Environments

- **Staging has no hosting.** The `staging` git branch and the staging Neon database still exist, but Netlify only builds `main` (to save credits). Test locally against the staging database or a Neon branch instead, never against production.
- **Deploy limits.** On the Netlify free plan, builds are skipped when monthly credits run out. The cycle resets on 3 November 2026. Changes can still be made to the live site through the admin, including the maintenance switch.
