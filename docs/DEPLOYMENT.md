# Deployment and hand-over

## Where everything lives

| Piece | Service | Notes |
| --- | --- | --- |
| Code | GitHub | `main` is production |
| Hosting | Netlify | Builds `main` only. Staging auto-builds are off to save credits |
| Database | Neon Postgres (EU) | Separate production and staging databases |
| Payments | Stripe | Owned by the business owner |
| Domain and DNS | GoDaddy | weeklytable.co.uk, owned by the business owner |
| Email | Microsoft 365 | `info@weeklytable.co.uk`, sent through the Graph API |

## Netlify settings

- Build command `npm run build`, Node 20 or newer, framework auto-detected as Next.js. There is no `netlify.toml`.
- Set the environment variables from `.env.example` for the production context. After any change to environment variables, **trigger a new deploy**; they are not picked up by running deploys.
- Free plan: about 300 credits per cycle and about 15 per production deploy. Out of credits means builds are skipped until the cycle resets. Batch changes into one push.

## Stripe

1. Dashboard > Developers > Webhooks > add endpoint `https://<domain>/api/webhooks/stripe`, event `checkout.session.completed`.
2. Copy the endpoint's signing secret into `STRIPE_WEBHOOK_SECRET`.
3. Live keys (`sk_live_`) go in `STRIPE_SECRET_KEY`. Redeploy afterwards.
4. After switching from test to live keys, purge test `Order` and `OrderItem` rows, but keep `Dish`, `Plan`, `CutoffConfig` and `AdminUser`.

## Moving to a new GitHub or Netlify account

Do the work while the old site keeps serving the domain, then cut over.

1. Transfer the repo on GitHub (Settings > Danger Zone), or have the new owner fork and push.
2. In the new Netlify account choose "Import from Git", pick the repo, set production branch `main`.
3. Copy every environment variable across (see the table in `README.md`). Neon can stay where it is; only `DATABASE_URL` is needed.
4. Deploy and test fully on the temporary `*.netlify.app` URL. Do not place live card orders there: the Stripe webhook still points at the old site.
5. Add the custom domain in the new Netlify site and update DNS at GoDaddy to the records Netlify shows. Wait for HTTPS to be issued.
6. In Stripe, point the webhook at the domain (or create a new endpoint and update `STRIPE_WEBHOOK_SECRET`), then redeploy.
7. Place one small real order end to end, check the confirmation email and the admin order, and refund it.
8. Rotate secrets the old account holder has seen: `SESSION_SECRET`, `STRIPE_WEBHOOK_SECRET`, the Neon password, and the Microsoft 365 client secret. Redeploy after.
9. Optionally move the Neon project to the new owner later. It only needs a new `DATABASE_URL` and a redeploy.

## Microsoft 365 email

Azure app registration with the `Mail.Send` application permission, scoped to the sender mailbox. Client secrets expire; note the expiry date when creating one, and renew before then or emails silently stop (the app logs the failure but still takes orders).

## Release checklist

Run through this for every push to `main`. Each push costs Netlify credits, so batch changes and test locally first.

**Before pushing**
1. `npx tsc --noEmit`, `npm run lint` and `npm run build` all pass.
2. If the change includes a schema migration, apply it to the production database **before** the deploy (`npx prisma migrate deploy` with the production `DATABASE_URL`), so the new code never meets missing tables. Make migrations backward compatible (optional columns or defaults).
3. Check `MAINTENANCE_MODE` is empty in Netlify. If it is `true` it overrides the admin maintenance switch.
4. Any new environment variable is added in Netlify first. Variable changes only take effect on the next deploy.

**After the deploy is live**
1. Run any SQL that depends on the deployed files, for example `scripts/apply-batch2-photos.sql`. Running it earlier points dishes at image files that do not exist yet, so they show broken images.
2. Smoke test on the live admin: sign in, upload a photo on a dish and check it appears on `/order`, then switch maintenance on and off in Admin > Settings. Use `/?preview=<MAINTENANCE_BYPASS_SECRET>` to view the site while maintenance is on.
3. Open `/order` and `/menu` and check the dishes and photos.

**After a Stripe, domain or email change**
Place one small real order end to end, check the confirmation email and the admin order, and refund it.
