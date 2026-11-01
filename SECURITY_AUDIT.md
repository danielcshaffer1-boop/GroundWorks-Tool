# GroundWorks Inventory: Security Audit

Audit date: 2026-11-01. Scope: the whole repository (`inventory-tracker`), plus read-only requests against production (`https://www.groundworksinventory.dev` and the Supabase REST/Auth endpoints). **No project files were changed and nothing was fixed.** This document is the only file added.

How it was done: four read-only reviewers split the codebase (auth/RLS, API routes and webhooks, dependencies/config/secrets, client code and business logic). I then merged their reports, dropped duplicates, and re-tested the claims that mattered against production with throwaway accounts, which I deleted afterwards. Each finding says whether I reproduced it myself or whether it rests on code reading alone.

## Bottom line

**One Critical issue is live on production right now, and I reproduced it.** Any person who signs up for a free account can give themselves the Pro plan, and can overwrite the Stripe customer and subscription ids on their shop, by sending one request with the public anon key and their own session. No payment is involved and no server code runs. The cause is a single migration line that does not do what it claims (SEC-01). I checked the data: today the only shop on Pro is the Demo Shop, and there are two accounts in total, so **no abuse has happened yet**. The fix is a SQL migration that you have to run in the Supabase SQL Editor.

After that, the most important items are: the SMS abuse path (SEC-02), upgrading Next.js to 16.4.3 (SEC-03), and a few Supabase Auth dashboard settings (SEC-04, SEC-05). Everything else is Medium or lower.

## Status after approval (2026-11-01)

**Deployed to production** (commit `0ea5d6e`, smoke-tested): SEC-03 (Next.js 16.4.3, `npm audit` reports 0 vulnerabilities), the application side of SEC-02 (US/Canada-only numbers, cap of 5, plain-text item names), SEC-06 (atomic PIN counter; wording), SEC-07 (demo login and Pro tier restored by the nightly reset; verified the demo still signs in), SEC-08, SEC-09 (Square sync cooldown; webhook and cron paths skip the auth proxy), SEC-11 (headers and CSP, verified live), SEC-12, SEC-14, SEC-15 (`server-only`), SEC-16, SEC-17, SEC-18, SEC-19, SEC-20, and the "reset password signs out other devices" part of SEC-04/05.

**Database migrations applied to production and verified (2026-11-01):**
- `supabase/016_shops_lockdown.sql` closes **SEC-01**. Before: `has_column_privilege('authenticated','public.shops','tier','UPDATE')` returned true. After, with a throwaway signed-in user: PATCH of `tier`, `subscription_status`, `stripe_customer_id` and `name` returns 403; `display_mode` and `expiration_alert_days` still save; inserting a shop is refused; signup still creates a shop. Test accounts were deleted.
- `supabase/017_security_hardening.sql` is the database half of SEC-02, SEC-13 and SEC-15. Verified live: a duplicate number is rejected, non-US and malformed numbers are rejected, the sixth recipient is rejected, an 81-character item name and a negative count are rejected, alert days of 0 are rejected, a blank sign-up shop name falls back to the email prefix, signed-in users can no longer read the server-only tables, and anonymous requests can no longer read `items` or `shops`.

**Supabase Auth settings changed and verified (2026-11-01):** "Secure email change", "Secure password change" and "Require current password when updating" are on, and the minimum password length is 8. Verified on production: a session alone can no longer change the password (`current_password_required`); the correct current password works; the emailed-link password-reset flow still works; a 6-character password is rejected at sign-up; the demo login is unaffected. The redirect-URL allow-list contains only the shop's own domains. Rate limits are at Supabase's defaults.

**Decisions made:** the owner PIN is a guard against accidental changes (not a server-side lock). A failed card payment no longer locks a shop out: the plan is kept while Stripe retries (`past_due`) and ends when Stripe cancels or marks the subscription unpaid. Alerts go to US/Canada numbers only.

**Still open, and why:**
- **"Confirm email" is deliberately still off (SEC-05).** Custom SMTP is not configured, so Supabase's built-in mailer is in use, which is heavily rate-limited and not meant for real customers. Turning confirmation on now could stop real people from receiving their confirmation link and block sign-ups. Set up custom SMTP first (for example Resend with a verified sender domain), then turn it on. The sign-up screen already handles the "check your email" step. The same limitation affects password-reset emails.
- **CAPTCHA on sign-up (SEC-05)** needs a Cloudflare Turnstile or hCaptcha site key from you.
- **Twilio (checked 2026-11-01, no change needed):** Geo Permissions already allow only the United States and Canada (two boxes of 237 checked). The account is pay-as-you-go with a prepaid balance (about $13.70) and auto-recharge off, so the balance itself caps any abuse; a low-balance email alert is already on at $5. The inbound-message webhook uses the `www` address. Turning auto-recharge on would remove that cap; if you do, add a spend alert first.
- **GitHub (done 2026-11-01):** secret scanning and push protection were already on; I turned on the dependency graph, Dependabot alerts and malware alerts. Dependabot security updates (automatic pull requests) are left off. The repository is still public.
- SEC-06 real server-side PIN lock (decided: not needed), SEC-10 privacy-policy opt-in wording, admin MFA (SEC-17), and the per-item alert cooldown (SEC-02).

**Later the same day (admin two-step, alert cooldown, no customer email):**
- **Admin two-step verification (SEC-17), live and verified.** `set-tier` and `delete-shop` now require a TOTP-verified session (Supabase "aal2"); the Admin screen has an enrol/verify panel. Verified on production with throwaway users: an admin with only a password gets 403; after enrolling an authenticator and entering a valid code the same action succeeds; a non-admin gets 403. Admin accounts also can't be deleted from the Admin screen, and set/delete actions are written to the server log. **The first time you open the Admin screen you must scan the QR code with an authenticator app; until you do, plan changes and shop deletion are locked.** If the authenticator is ever lost, an admin's factor can be removed in the Supabase dashboard (Authentication > Users).
- **Alert cooldown and daily cap (SEC-02), live and verified (migration 018).** A repeat of the same or a milder status for an item is not texted again within 2 hours; an escalation (Low, then Critical) always goes out; each shop is capped at 40 alert events per day. A send that reached nobody doesn't count. Verified on production: first crossing sends, a repeat inside the window is skipped, an escalation sends, and the daily cap blocks. (The test used Twilio's `+15005550006`; Twilio accepted two requests, both ended `undelivered` (30006) with no price, so nothing was delivered or charged.)
- **No customer email.** GroundWorks sends customers only text messages, so: the privacy policy no longer says policy changes are sent by email; the sign-in screen's "Forgot password?" now says to contact you instead of promising an emailed reset link (the old reset code is kept, unused). Consequences: "Confirm email" (SEC-05) stays off on purpose and no custom email service is needed; a forgotten password is reset by hand. Stripe's own receipt emails are a Stripe setting (Dashboard > Settings > Customer emails) and can be switched off there if you don't want them.

Original note, from before approval: I was **waiting for approval before fixing anything**.

## Summary table

| ID | Severity | Title | Location | Reproduced by me |
|---|---|---|---|---|
| SEC-01 | **Critical** | Any signed-in user can edit `shops.tier` and Stripe columns (the column `REVOKE` is a no-op) | `supabase/005_paid_tiers.sql:40`, `supabase/002_auth_and_shops_rls.sql:50-53` | **Yes, on production** |
| SEC-02 | **High** | SMS pumping and phishing relay through unvalidated, uncapped `alert_recipients` and free-text item names | `supabase/007_restock_alerts.sql`, `src/lib/shop-data.ts:267-276`, `src/app/api/alerts/item-updated/route.ts:73-113`, `src/app/api/alerts/expiring-batches/route.ts:97-133` | No (code reading; reachable via SEC-01) |
| SEC-03 | **High** | Next.js 16.3.3 has known advisories, two critical (fixed in 16.4.1+); `sharp` and `source-map-js` also flagged | `package.json:14,23` | Yes (`npm audit`); exploitability not shown |
| SEC-04 | Medium | A bare session can change the account password (and probably email) with no re-authentication; this defeats the owner-PIN password check | Supabase Auth settings; `src/app/api/owner-pin/route.ts:33-40,83-96` | Password change: **yes**. Email change: no (inconclusive) |
| SEC-05 | Medium | Email confirmation is off; sign-up is open with no CAPTCHA | live `/auth/v1/settings`; `src/components/InventoryTracker.tsx:2909-2925` | Settings read live; exploit not run |
| SEC-06 | Medium | The owner PIN is only a screen lock: nothing on the server enforces it, the attempt counter races, and a barista can lock the owner out | `src/app/api/owner-pin/route.ts:33-97`, `src/components/InventoryTracker.tsx:3736-3800` | No |
| SEC-07 | Medium | The shared demo account can be broken or vandalised by any visitor | `src/lib/demo.ts:12-14`, `src/lib/demo-seed.ts:87-199` | No (would mutate production) |
| SEC-08 | Medium | Stripe checkout and webhook allow duplicate, stale, and out-of-order subscription states | `src/app/api/stripe/checkout/route.ts:34-73`, `src/app/api/stripe/webhook/route.ts:37-96` | No |
| SEC-09 | Medium | No rate limiting or spend controls on any route | `src/app/api/**`, `vercel.json` | No |
| SEC-10 | Medium | The privacy policy promises a double opt-in and consent records that the code does not implement | `src/app/privacy/page.tsx:75-80,113-116`, `src/components/InventoryTracker.tsx:2661-2682` | No (legal/compliance risk) |
| SEC-11 | Low | No Content-Security-Policy or other security headers; `X-Powered-By` exposed; auth cookies readable by JS | `next.config.ts:14-21` | Yes (response headers checked) |
| SEC-12 | Low | Expiry-text cron has no tier check, and has batching/duplicate-send flaws | `src/app/api/alerts/expiring-batches/route.ts:47-148` | No |
| SEC-13 | Low | No database-level limits on text length or numbers | `supabase/schema.sql:24-34,54-63`, `005`, `010` | No |
| SEC-14 | Low | Prototype-key lookups and unbounded numbers in Square/CSV code can stall a shop's sync or drop deductions | `src/lib/square.ts:269,284,305`, `src/lib/sales-import.ts:381`, `src/components/InventoryTracker.tsx:2283` | No (reproduced the JS behaviour in Node only) |
| SEC-15 | Low | `anon` and `authenticated` hold table grants on server-only tables; no `server-only` guard | `supabase/013`, `014`, `015`, `src/lib/supabase/admin.ts` | Anon grants: yes (live reads returned 200) |
| SEC-16 | Low | Secret comparisons use `!==`, not constant time | `src/app/api/alerts/item-updated/route.ts:35`, `expiring-batches:37`, `demo/reset:11`, `square/cron:13`, `square/callback:22` | n/a |
| SEC-17 | Low | Admin routes: no MFA, no audit trail, no self-delete guard | `src/app/api/admin/set-tier/route.ts`, `delete-shop/route.ts` | No |
| SEC-18 | Low | Internal error text returned to the browser | `src/lib/square.ts:451-454`, `src/app/api/stripe/webhook/route.ts:28`, `src/app/api/square/status/route.ts` | No |
| SEC-19 | Low | Quadratic regex in CSV import can freeze the importer's own tab | `src/lib/sales-import.ts:343` | Timing measured by the reviewer in Node |
| SEC-20 | Low | Return URLs are built from the request host; `window.location.href = data.url` has no allow-list | `src/app/api/stripe/checkout/route.ts:51,84-85`, `portal/route.ts:40-45`, `square/connect/route.ts:17`, `InventoryTracker.tsx:2329,3866,4948` | Not exploitable as found |
| SEC-21 | Info | Public GitHub repo; live Stripe key in local `.env.local`; trigger URL uses the apex domain; misc. hardening | various | n/a |

Severity here is my own, after de-duplicating. The four reviewers disagreed on a few ratings; where they did, I used the lower one unless I could show an exploit.

---

## Findings

### SEC-01 — Critical — Any signed-in user can change `shops.tier` and the Stripe columns

**Reproduced on production by me.**

**Where:** `supabase/005_paid_tiers.sql:34-41` (the `revoke update (tier, stripe_customer_id, stripe_subscription_id, subscription_status) on shops from authenticated;` line), together with the update policy in `supabase/002_auth_and_shops_rls.sql:50-53`. The comment in `src/lib/shop-data.ts:246-249` repeats the wrong assumption.

**What is wrong.** In Postgres, `REVOKE UPDATE (column)` only removes a grant made on that specific column. If the role holds a table-wide `UPDATE` grant, the column revoke has no effect. Supabase gives `authenticated` and `anon` table-wide privileges on every new table in `public` by default, so the line in migration 005 does nothing. The row-level policy "Shop owners can update their own shop" lets a user update their own row and does not restrict columns. The browser talks to Supabase directly, so the policy and the grants are the only gate. The whole billing model ("only the Stripe webhook writes `tier`") depends on this.

**Exploit I ran.** I created a throwaway user, signed in, and sent `PATCH /rest/v1/shops?id=eq.<own id>` with the anon key and the user's token, setting `tier` to `pro`, `subscription_status` to `active` and `stripe_customer_id` to a fake value. All returned HTTP 200 and the values stuck. I then deleted the user and the shop row.

**Impact.**
- Free Pro forever: every table policy for `items`, `batches`, `alert_recipients`, `order_marks`, `menu_items`, `ingredients` and `requireProOwner` (all Square routes) reads `shops.tier`.
- Skips the $200 setup fee: checkout treats a shop with a `stripe_customer_id` as already set up.
- Setting `stripe_customer_id` to someone else's `cus_…` id would make `/api/stripe/portal` open that customer's billing portal. An attacker needs the victim's id, which is random but appears in Stripe emails, dashboards and logs. I did not test this.
- Setting `stripe_subscription_id` plus an active status makes the admin delete-shop guard refuse to delete the shop.
- A demo visitor can set the Demo Shop to `none`; the nightly reset does not repair that.

**Has it been abused?** Not that I can find. Production has two auth users (yours and the demo owner) and one shop; the only non-`none` tier is the Demo Shop (Pro, null Stripe fields, which is legitimate).

**Fix (migration `016`, run in the Supabase SQL Editor).** I checked which columns the client actually updates: only `display_mode` and `expiration_alert_days` (`src/lib/shop-data.ts:242,288`). The `updated_at` trigger runs as table owner logic and is not affected by column grants.

```sql
-- 1. Remove the table-wide grant and give back only what the app needs.
revoke update on public.shops from authenticated, anon;
grant  update (display_mode, expiration_alert_days) on public.shops to authenticated;
revoke insert, delete, truncate on public.shops from authenticated, anon;

-- 2. Belt and braces: reject changes to protected columns from client roles
--    even if a grant regresses later. Must stay SECURITY INVOKER.
create or replace function public.shops_protect_columns() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') and (
        new.id                     is distinct from old.id
     or new.tier                   is distinct from old.tier
     or new.stripe_customer_id     is distinct from old.stripe_customer_id
     or new.stripe_subscription_id is distinct from old.stripe_subscription_id
     or new.subscription_status    is distinct from old.subscription_status) then
    raise exception 'protected column' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger shops_protect_columns before update on public.shops
  for each row execute function public.shops_protect_columns();
```

**How I will verify after you run it** (with a throwaway user, then delete it): `PATCH tier` returns an error; `PATCH display_mode` and `expiration_alert_days` still succeed; the app's settings screens still save; the Stripe webhook and admin set-tier still work (they use the service role).

Also run these two read-only checks in the SQL Editor before and after, to confirm the live state independently of my test:

```sql
select has_column_privilege('authenticated','public.shops','tier','UPDATE');   -- true = vulnerable
select id, name, tier, subscription_status, stripe_customer_id, stripe_subscription_id
  from shops where tier <> 'none' and (stripe_subscription_id is null or stripe_customer_id is null);
```

---

### SEC-02 — High — SMS pumping and phishing relay through `alert_recipients` and item names

**Where:**
- `supabase/007_restock_alerts.sql:7-35`: `phone` is plain text, with no format check, no uniqueness, and no cap per shop.
- `src/lib/shop-data.ts:267-276`: the browser inserts straight into the table.
- `src/lib/phone.ts` and `src/components/InventoryTracker.tsx:2661-2682`: number normalisation and the consent checkbox exist only in the UI.
- `src/app/api/alerts/item-updated/route.ts:73-113` and `expiring-batches/route.ts:97-133`: `Promise.all` over every recipient, no cap, no cooldown; the item name and unit (unbounded text) go into the message body (`:98-100`, `:128-131`).

**What is wrong.** Anyone with a Standard/Pro account can bypass the UI and insert any number of recipients, including other people's numbers, premium-rate numbers and international numbers. No one verifies that a number's owner agreed. Each time an item's count crosses to a worse status, the database trigger calls the alert route, which sends one text per recipient from your registered number. The text includes the item name, which the account holder controls without any length limit.

**Exploit (not run; I will not send SMS from production).** Via SEC-01 this needs no payment at all.
1. Insert hundreds of `alert_recipients` rows (victims' numbers, or numbers in expensive destinations).
2. Rename an item to `URGENT: your bank account is locked, verify at <link>` and set its threshold above its count.
3. Update the count down, up, down, up. Every downward crossing sends one SMS per recipient, with the attacker's text, from your 10DLC number.

The harm is Twilio charges (especially to high-cost destinations), carrier filtering or suspension of your campaign, and spam to third parties that carries your name. Replying STOP removes the row for that number, which limits repeat harassment but not the first message. The demo shop is correctly excluded from sending.

**Fix.**
```sql
alter table alert_recipients
  add constraint alert_recipients_e164 check (phone ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$');  -- US/CA only; widen deliberately
create unique index alert_recipients_shop_phone_uq on alert_recipients (shop_id, phone);

create function public.cap_recipients() returns trigger language plpgsql set search_path = '' as $$
begin
  if (select count(*) from public.alert_recipients where shop_id = new.shop_id) >= 5 then
    raise exception 'recipient limit reached';
  end if;
  return new;
end $$;
create trigger alert_recipients_cap before insert on alert_recipients
  for each row execute function public.cap_recipients();

alter table items
  add constraint items_name_len check (char_length(name) between 1 and 80),
  add constraint items_unit_len check (char_length(unit) between 1 and 30);
```
Application side, in both alert routes: clean the interpolated text and limit recipients.
```ts
const clean = (s: string, n: number) =>
  s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/https?:\/\/\S+|www\.\S+/gi, "[link]").slice(0, n);
// body uses clean(record.name, 40); iterate recipients.slice(0, 5)
```
Add a per-item cooldown (for example `items.last_alert_at`, skip if under 6 hours) and a per-shop daily message ceiling. **Outside the code:** in the Twilio console, enable only US/Canada under Messaging → Settings → Geo Permissions and set a spend alert. That single setting stops international pumping regardless of any code bug. Longer term, move "add a recipient" behind a server route that sends a "reply YES to confirm" text (see SEC-10) and stop granting the browser write access to this table.

---

### SEC-03 — High — Next.js 16.3.3 has known advisories

**Reproduced:** I ran `npm audit --omit=dev` myself today: 1 critical (`next`), 2 high (`sharp`, `source-map-js`). Installed `next` is 16.3.3.

**Where:** `package.json:14` (`"next": "16.3.3"`) and `:23` (`"eslint-config-next": "16.3.3"`).

**Advisories (from `npm audit` and the reviewer's detail):**

| Advisory | Severity | Affected | Fixed in |
|---|---|---|---|
| GHSA-2464-fhr4-w9xw, remote code execution in the Image Optimization API (via `sharp`/librsvg on glibc Linux) | critical | 16.0.0 – 16.4.0 | 16.4.1 |
| GHSA-673q-mjm6-r5xr, RCE in `use cache` functions returning typed arrays | critical | 16.0.0 – 16.4.0 | 16.4.1 |
| GHSA-p3m5-59mp-jv5r, denial of service via Server Actions | high | 16.0.0 – 16.4.0 | 16.4.1 |
| GHSA-cjq9-62q9-8jv4, SSRF in Image Optimization | high | below 16.3.8 | 16.3.8 |
| GHSA-vcvr-r3jv-pc5j, RCE in `next/og` `ImageResponse` | critical | 16.2.0 – below 16.3.6 | 16.3.6 |
| Six further moderate/low items (cache poisoning, `use cache` leaks, metadata-image disclosure, dev-server disclosure) | moderate/low | below 16.3.8 | 16.3.8 |

**Is it exploitable here? Probably not, but I cannot prove that offline.** The code does not use `"use server"`, `"use cache"`, `cacheComponents`, `next/og`, `ImageResponse` or `images.remotePatterns`, and `public/` has no SVG files, so most of these preconditions are absent. The exposure that remains is `/_next/image`, which is live and unauthenticated (it returned 200 for a local image). On Vercel the optimiser normally runs on Vercel's side rather than your bundled `sharp`, but I could not confirm that. Given a patch-level upgrade, I would rate this as "do it now" rather than argue about reachability.

**Fix.** `npm audit` reports a non-major fix:
```
npm install next@16.4.3 eslint-config-next@16.4.3 --save-exact
npm update sharp source-map-js
npm run build
npm audit --omit=dev
```
Confirm `sharp` resolves to 0.35.5 or later in `package-lock.json`; if it does not, add `"overrides": {"sharp": "^0.35.5"}`. This repo's `AGENTS.md` warns that this Next.js version differs from older ones, so I will read the bundled docs in `node_modules/next/dist/docs/` for any breaking changes between 16.3.3 and 16.4.3 before building, then smoke-test the app and guides. Do not run `npm audit fix --force`: it proposes a bogus `eslint@4` downgrade. The remaining audit items (`brace-expansion`, `minimatch`, `js-yaml`, `zod`) are dev-only and are not shipped.

---

### SEC-04 — Medium — A session alone can change the password (and probably the email)

**Password change reproduced by me; email change not confirmed.**

**Where:** Supabase Auth configuration (not code), plus `src/app/api/owner-pin/route.ts:33-40,83-96` which relies on a password check.

**What is wrong.** `PUT /auth/v1/user` changes the account password with only an access token unless the dashboard option "Secure password change" is on. I tested it: a throwaway user's session changed its own password with no old password, and the new password then worked for login. This means anyone holding a logged-in phone or browser (a barista on the shared tablet) can take over the account, and it also defeats the owner-PIN's "enter the account password" check, because the barista can first set a password they know and then use it to remove or replace the PIN.

**Email change:** my test was inconclusive. Supabase rejected `example.com` addresses as invalid (`email_address_invalid`), so the request never reached the confirmation logic. With `mailer_autoconfirm` on (SEC-05) a real address may be applied without confirmation. I have not verified it and will not claim it.

**Fix (Daniel, in the Supabase dashboard):** Authentication → Providers → Email: turn on "Secure password change" and "Secure email change" (and keep "Double confirm email changes"). Code side: after the reset-password flow call `supabase.auth.signOut({ scope: "others" })`. For the PIN check, prefer `reauthenticate()` or a per-user attempt counter over `signInWithPassword` (see SEC-06).

---

### SEC-05 — Medium — Email confirmation is off; open sign-up with no CAPTCHA

**Evidence (live):** `GET /auth/v1/settings` returned `mailer_autoconfirm: true`, `disable_signup: false`.

**What is wrong.**
- No one proves they own the email. An attacker can register `victim@theirshop.com` first with their own password. When the victim later tries to sign up they see "already registered", use Forgot Password, and reset it, but the attacker's earlier session stays valid (`updateUser({password})` does not revoke other sessions), so the attacker keeps seeing the victim's inventory, billing state and Square link.
- Sign-up returns "User already registered" for existing emails, which lets anyone test which emails have accounts.
- Stripe's `customer_email` (`src/app/api/stripe/checkout/route.ts:70`) is unverified.
- Free accounts can be mass-created; I found no CAPTCHA or app-level throttle.

**Exploit not run** (it needs a second real mailbox).

**Fix (dashboard):** turn on "Confirm email"; enable CAPTCHA (Cloudflare Turnstile or hCaptcha) on sign-up and password recovery; keep Supabase's per-IP limits on. Code: `signOut({ scope: "others" })` after password reset. Note that turning on confirmation changes the sign-up flow for real users (they must click a link), so we should test it once end to end before leaving it on.

---

### SEC-06 — Medium — The owner PIN is a screen lock, not a security boundary

**Where:** `src/app/api/owner-pin/route.ts:33-97`; `src/components/InventoryTracker.tsx:3736-3800` (unlock state is plain React state), `:3758-3773` (fails open).

**What is wrong.**
1. **Nothing server-side checks the PIN.** `verify` returns `{ ok: true }` and issues no token. A signed-in barista session can still, directly from the browser console, edit and delete items, edit batches, add or remove alert numbers, change shop settings, call `POST /api/stripe/portal` (open the billing portal and cancel the subscription), and call `/api/square/disconnect`, `/sizes`, `/modifiers`, `/unmatched`, `/sync`. The owner guide says the password "keeps them from" taking over; as built, SEC-04 shows it does not.
2. **The attempt counter races.** It reads `failed_attempts`, runs scrypt, then writes `attempts + 1` (`:54-80`). Many parallel verifies all read 0, so the "5 tries, then locked for 5 minutes" limit can be bypassed with a burst of concurrent requests; a 4-digit PIN has only 10,000 values. Practical value is limited today because the PIN protects only the UI.
3. **Lockout denial of service.** The lock is per shop, so any session can send 5 wrong PINs every 5 minutes and keep the owner from unlocking.
4. **Password guess oracle.** `set` and `remove` call `signInWithPassword` with no per-user throttle; each attempt runs from your Vercel egress IP, so a flood could trip Supabase's per-IP auth limit for other users.
5. **Fails open.** If `/api/owner-pin` errors at load, everything is shown unlocked.

**Fix.**
- *Honest minimum:* describe the PIN in the app and guides as "prevents accidental changes on a shared device". (The owner guide wording currently overstates it.)
- *Atomic counter:* reserve the attempt in one SQL statement before running scrypt, and use async `scrypt`:
```sql
create function public.pin_reserve_attempt(p_shop uuid) returns text
language sql security definer set search_path = '' as $$
  update public.shop_owner_pins
     set failed_attempts = case when failed_attempts + 1 >= 5 then 0 else failed_attempts + 1 end,
         locked_until    = case when failed_attempts + 1 >= 5 then now() + interval '5 min' else locked_until end
   where shop_id = p_shop and (locked_until is null or locked_until < now())
  returning pin_hash;
$$;
revoke execute on function public.pin_reserve_attempt(uuid) from public, anon, authenticated;
grant  execute on function public.pin_reserve_attempt(uuid) to service_role;
```
No row returned means locked, so respond 429. Reset the counters on success. Add a per-user throttle (5 per 15 minutes) before `signInWithPassword`.
- *Real boundary, if you want one:* on a correct PIN, set a signed, HttpOnly, 10-minute `gw_owner` cookie, require it in `/api/stripe/portal`, `/api/square/*` and new server routes for alert recipients, thresholds and deletes, and revoke direct write grants on those columns/tables. Alternatively add a `shop_members(shop_id, user_id, role)` table so baristas have their own login and RLS lets them change only counts. This is a design change, so I would want your decision before starting it.

---

### SEC-07 — Medium — The shared demo account can be broken by any visitor

**Where:** `src/lib/demo.ts:12-14` (the demo email and password are in the client bundle by design), `src/lib/demo-seed.ts:87-199`, and `src/app/api/demo/reset/route.ts`.

**What is wrong.** "Try the demo" signs in as a real Supabase user. Anyone can do the same from the console and then call `supabase.auth.updateUser({ password: "x" })` or change the email, after which "Try the demo" fails for everybody until you repair it by hand. `auth.signOut({ scope: "global" })` kicks other visitors out. They can also fill the demo shop with rows until the 09:00 UTC reset, and (until SEC-01 is fixed) set its tier to `none`. Server routes do correctly block the demo user from Stripe, Square, owner PIN, admin routes and SMS, and RLS keeps everything inside the demo shop, so there is no path to other tenants. I did not test this on production because it would break your demo.

**Fix.** In `/api/demo/reset`, after `resetDemoShop`:
```ts
const { error } = await getSupabaseAdmin().auth.admin.updateUserById(DEMO_SHOP_ID, {
  email: DEMO_EMAIL, password: DEMO_PASSWORD, email_confirm: true,
});
if (error) throw error;
```
Also restore `tier = 'pro'` there, consider running the reset more often than daily, and add row-count caps for the demo shop (for example a trigger limiting `items` to 40). Confirm that you control the mailbox/domain of `DEMO_EMAIL`.

---

### SEC-08 — Medium — Stripe checkout and webhook state gaps

**Where:** `src/app/api/stripe/checkout/route.ts:34-73`; `src/app/api/stripe/webhook/route.ts:37-96`.

1. **Duplicate subscriptions.** Checkout never checks for an existing live subscription, so a paying shop can start a second one and be billed twice.
2. **Wrong-subscription revocation.** `customer.subscription.updated/deleted` find the shop by `metadata.shopId` and never compare `subscription.id` to the stored `stripe_subscription_id`. Cancelling the stale or duplicate subscription sets `tier = 'none'` for a shop that still pays.
3. **Ordering and replay.** Stripe does not guarantee event order and the Dashboard can resend events; handlers write from the payload with no ordering check, so a late stale event can flip a shop's state.
4. **Grant ignores payment state.** `checkout.session.completed` sets the plan without checking `payment_status`/`subscription.status`. This only matters if you enable delayed-payment methods (for example ACH); I could not see your Stripe settings.
5. **Unknown price** writes `tier = 'none'` (`plan ?? "none"`), which would downgrade a good shop.
6. **Design call:** `past_due` immediately sets `tier = 'none'`, and because table RLS gates on tier, one failed card charge instantly locks the shop out of its own data. That may be intended; it is harsh.

Webhook signature verification itself is correct (see "Checked and OK").

**Fix.**
```ts
// checkout: refuse when already subscribed
const { data: shop } = await supabase.from("shops")
  .select("id, stripe_customer_id, stripe_subscription_id, subscription_status").eq("id", user.id).maybeSingle();
if (shop?.stripe_subscription_id && ["active","trialing","past_due","unpaid"].includes(shop.subscription_status ?? ""))
  return NextResponse.json({ error: "You already have a plan. Use Manage billing." }, { status: 409 });

// webhook updated/deleted: ignore events for a different subscription, and re-read it
const sub = await stripe.subscriptions.retrieve(subscription.id);
const { data: s } = await supabase.from("shops").select("stripe_subscription_id").eq("id", shopId).maybeSingle();
if (s?.stripe_subscription_id && s.stripe_subscription_id !== sub.id) break;
```
In `completed`, compute the tier from the subscription status the same way `updated` does, and do not overwrite a good tier when the price is unknown.

---

### SEC-09 — Medium — No rate limiting or spend controls anywhere

**Where:** all of `src/app/api/**`; `vercel.json` has crons only.

**What is wrong.** The only throttles are Supabase Auth's own limits and the (racy) PIN counter. Unthrottled: `POST /api/square/sync` (each call makes up to 20 paged order searches per location, 60 s function), `POST /api/stripe/checkout` and `/portal` (any signed-in user, even tier `none`, can create unlimited Stripe sessions), `/api/square/connect`, `/api/owner-pin`, and direct database writes that drive SMS (SEC-02). Public webhooks read the whole body and compute an HMAC before rejecting, a minor CPU cost.

**Fix.** Add Vercel WAF rate-limit rules (Pro plan) for `/api/*` (for example 20/min/IP, tighter on `/api/owner-pin` and `/api/square/sync`), and a per-shop sync cooldown (return 429 if `last_synced_at` is under 30 seconds old). For per-user limits use a small `rate_limits` table or Upstash/Vercel KV. Exclude `/api/stripe/webhook`, `/api/twilio/inbound` and the cron paths from `src/proxy.ts`'s matcher so they do not each trigger a Supabase `getUser()` call.

---

### SEC-10 — Medium — Consent: privacy policy does not match the code (compliance risk)

**Where:** `src/app/privacy/page.tsx:75-80,113-116` versus `src/components/InventoryTracker.tsx:2661-2682` and `supabase/007_restock_alerts.sql`.

**What is wrong.** The policy says people opt in "by entering your phone number … and confirming via a one-time confirmation text" and that you retain opt-in and opt-out records. The code sends no confirmation text; the table stores only `id, shop_id, phone, created_at`; and the "consent" is a checkbox that the shop owner ticks on behalf of the number's owner (often an employee), enforced only in the browser. This is a TCPA/carrier-registration exposure, and the 10DLC campaign you registered presumably describes the flow in the policy. It is a business and legal risk rather than a technical exploit, so please read it with that in mind; I am not giving legal advice.

**Fix.** Short term: change the policy text to describe what the app actually does. Proper fix: add `consented_at`, `consented_by`, `consent_text_version`, `confirmed_at` columns, add a server route that texts "Reply YES to confirm" and records `confirmed_at` from `/api/twilio/inbound`, and make both send routes require `confirmed_at is not null`.

---

### SEC-11 — Low — No CSP or other security headers

**Reproduced (response headers):** production responses have HSTS but no `Content-Security-Policy`, `X-Frame-Options`/`frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy` or `Permissions-Policy`, and send `X-Powered-By: Next.js`. `next.config.ts:14-21` only adds `X-Robots-Tag` for `/guides`. Supabase auth cookies are not `HttpOnly` (the browser client has to read them), so any future XSS would mean session theft. I found **no** XSS sink in the code (no `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `new Function`; all user text renders as React text), so this is defence in depth, not a known hole. Clickjacking is blunted by `SameSite=Lax` cookies.

**Fix.** Add `poweredByHeader: false` and the headers below in `next.config.ts`. A nonce-less CSP needs `'unsafe-inline'` for scripts and styles because Next injects inline scripts; a nonce-based CSP would force every page dynamic, so I would not do that now. Roll out as `Content-Security-Policy-Report-Only` on a Vercel preview first.
```ts
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const isDev = process.env.NODE_ENV !== "production";
const appCsp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${supabaseUrl} ${supabaseUrl.replace(/^https:/, "wss:")}${isDev ? " ws://localhost:*" : ""}`,
  "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'",
].join("; ");
// plus: X-Frame-Options DENY, X-Content-Type-Options nosniff,
// Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy camera=(), microphone=(), geolocation=()
// /api/:path* gets Cache-Control: no-store. /guides/* keeps X-Robots-Tag and gets its own CSP
// allowing fonts.googleapis.com / fonts.gstatic.com (the guides load Google Fonts).
```

---

### SEC-12 — Low — Expiry-text cron: no tier check and robustness flaws

**Where:** `src/app/api/alerts/expiring-batches/route.ts:47-148`.
- It uses the service role and no tier filter, so a shop that has cancelled (`tier = 'none'`, which RLS prevents from managing recipients) keeps getting daily texts; only STOP removes them. Fix: join `shops!inner(tier)` and skip non-paying tiers.
- PostgREST returns at most 1,000 rows by default, so later batches are never alerted. `.in("id", alertedBatchIds)` can exceed URL length limits, in which case batches are never marked and recipients get repeats. Texts are sent before rows are marked, so overlapping runs duplicate texts, and if one recipient succeeds, all batches are marked sent. Fix: filter in SQL, paginate, claim rows with an `update … returning` before sending, chunk `.in()` to 200.

---

### SEC-13 — Low — No database-level limits on text length or numbers

**Where:** `supabase/schema.sql:24-34,54-63`, `005`, `010`. Item, shop, recipe and unit names are unbounded; `items.count`, `threshold`, `unit_size` and `ingredients.amount` accept negative, enormous or non-finite values; `expiration_alert_days` has no bounds; `handle_new_user` (`005_paid_tiers.sql:50-56`) takes `shop_name` from sign-up metadata with no length limit. A negative `unit_size` or `amount` turns a client-side "sales deduction" into a stock increase. The harm is confined to the user's own tenant, but it feeds SEC-02 and data-quality problems.

**Fix.**
```sql
alter table items add constraint items_ranges check (
  count >= 0 and count < 1e9 and threshold >= 0 and threshold < 1e9
  and (unit_size is null or (unit_size > 0 and unit_size < 1e7)));
alter table ingredients add constraint ingredients_amount check (amount >= 0 and amount < 1e7);
alter table shops add constraint shops_name_len check (char_length(name) between 1 and 80),
                  add constraint shops_alert_days check (expiration_alert_days between 1 and 60);
alter table menu_items add constraint menu_items_name_len check (char_length(name) between 1 and 80);
```
Before applying, I will check existing production rows against each constraint so the migration does not fail on current data.

---

### SEC-14 — Low — Prototype-key lookups and unbounded numbers in Square/CSV code

**Where and behaviour** (the reviewers confirmed in Node that `{}["constructor"]` is a function):
- `src/lib/square.ts:269`: `config.sizes[sizeKey] ?? 1`. A Square variation named "Constructor" makes the scale a function, deltas become `NaN`, which serialises to `null`. In `apply_square_sales` a null delta makes the chunk's totals null, so that chunk of up to 200 orders silently deducts nothing while the orders are still marked seen.
- `src/lib/square.ts:284`: a modifier named "Constructor" makes `for…of` throw "not iterable"; `syncShop` catches it, `last_synced_at` never advances, and that shop's sync is stuck.
- `src/lib/square.ts:305`: `parseEffects` has no upper bound on `amount`, so `1e308 × qty` overflows to Infinity (also serialises to null).
- `src/components/InventoryTracker.tsx:2283`: `SQUARE_FLASH[urlParam]`, so `/?square=__proto__` puts an object into a React child and the dashboard shows the error screen until reload. Not XSS.
- `src/lib/square.ts` `MAX_PAGES = 20`: if more than about 10,000 orders return, the tail is dropped while `last_synced_at` advances, so those orders are permanently lost after the 4-day lookback.

All of these are triggered by the merchant's own data (or by a crafted link opened by the logged-in owner), with no cross-tenant effect.

**Fix.** Build the lookup maps with `Object.create(null)` or `Map` (`square.ts:219-222,411,416`, `sales-import.ts:363`); use `Object.hasOwn(SQUARE_FLASH, k)`; cap `amount` (about 1e6) and drop non-finite deltas before the RPC; do not advance `last_synced_at` while a cursor remains.

---

### SEC-15 — Low — Server-only tables rely only on RLS; `server-only` not used

**Where:** `supabase/013:32,46,59,74`, `014:25,43`, `015:21`. `square_connections` (encrypted tokens), `shop_owner_pins` (PIN hashes), `square_orders_seen`, `sales_aliases`, `square_unmatched`, `sales_sizes` and `modifier_rules` have RLS on and no policies, but `anon` and `authenticated` still hold table grants (my reviewer's live anon GET returned 200 `[]` rather than a permission error, for all 15 tables, so no rows leak today). One future "admins can view all" policy, or a migration that disables RLS, would expose them. Separately, `src/lib/supabase/admin.ts` (and the other server-only modules) do not `import "server-only"`, so a future accidental client import would bundle the service key instead of failing the build. Today no client file reaches them: I and the reviewers checked the client import graph and searched the 11 production JS chunks for secret names with no hits.

**Fix.**
```sql
revoke all on public.square_connections, public.square_orders_seen, public.sales_aliases,
              public.square_unmatched, public.sales_sizes, public.modifier_rules,
              public.shop_owner_pins from anon, authenticated;
revoke all on all tables in schema public from anon;      -- test: the app should not need anon table access
alter default privileges in schema public revoke all on tables from anon;
revoke execute on function public.consume_batches_fifo(bigint, numeric) from public, anon;
```
and `npm i server-only` with `import "server-only";` at the top of `admin.ts`, `stripe.ts`, `square.ts`, `twilio.ts`, `owner-pin.ts`, `square-route.ts`, `demo-seed.ts`.

---

### SEC-16 — Low — Non-constant-time secret comparisons

`item-updated/route.ts:35`, `expiring-batches/route.ts:37`, `demo/reset/route.ts:11`, `square/cron/route.ts:13` and `square/callback/route.ts:22` compare secrets/state with `!==`. All fail closed when the secret is unset (the reviewer confirmed `Authorization: Bearer undefined` returns 401 on production), and with 32-character random secrets a network timing attack is impractical. Cheap to fix with a shared `safeEq` using `crypto.timingSafeEqual` on SHA-256 digests.

---

### SEC-17 — Low — Admin routes: single factor, no audit log

`src/app/api/admin/set-tier/route.ts` and `delete-shop/route.ts`. The admin check itself is sound (the `admins` row is read through the caller's RLS client). Gaps: a compromised admin password (minimum length 6, no MFA) can set any shop to Pro or delete every shop without a live subscription; nothing records who did what; `delete-shop` allows deleting your own shop; the live-subscription guard trusts the local `subscription_status` text; the delete steps are not transactional; `set-tier` does not check that the shop exists. Fix: require `aal2` (TOTP) for admins, write an `admin_audit` row, block self-delete, and re-fetch the subscription from Stripe before deleting.

---

### SEC-18 — Low — Internal error text returned to the browser

`/api/square/sync` returns `summary.message` (raw `err.message`, can include "apply_square_sales failed: …"), `/api/square/status` returns the stored `last_error`, and the Stripe webhook returns `Invalid signature: ${err.message}` (`stripe/webhook/route.ts:28`). No secrets or stack traces were seen. Return a fixed message and keep the detail in server logs. A missing signature header should be a 400, not "Webhook not configured" (500).

---

### SEC-19 — Low — Quadratic regex in CSV import (self-inflicted freeze)

`src/lib/sales-import.ts:343`: `name.replace(/\([^)]*\)/g, " ")` is O(n²) on a cell full of "(" characters; the reviewer measured about 2.6 s for 100,000 characters and 10.3 s for 200,000, so a 2 MB file (the limit at `InventoryTracker.tsx:1562`) would freeze the tab for minutes. The file is parsed in the browser and never sent to a server, so this only affects the person importing it. Fix: truncate names to about 200 characters and cap rows (for example 5,000) in `parseSalesText`.

---

### SEC-20 — Low — Request-host return URLs and unrestricted `location.href`

Return URLs in the Stripe and Square routes use `request.nextUrl.origin`. I found no exploit: on Vercel only your own domains reach the app, `redirectTo` for password reset is `window.location.origin`, and Square rejects unregistered redirect URIs. Hygiene fix: use a `NEXT_PUBLIC_SITE_URL` constant. The three `window.location.href = data.url` calls (`InventoryTracker.tsx:2329,3866,4948`) take their value from your own routes; adding a host allow-list (`stripe.com`, `squareup.com`, `squareupsandbox.com`) is cheap insurance.

---

### SEC-21 — Info — Smaller notes

- **Public repository.** `https://github.com/danielcshaffer1-boop/GroundWorks-Tool` is public (`private: false`). The full history was scanned (43 commits) for Stripe, Twilio, Square, Supabase, GitHub, AWS keys, JWTs and private keys: nothing found. The only password-like string is the intentionally public demo password. Turn on GitHub secret scanning and push protection. Public source means the RLS and route logic are readable by anyone, which makes fixing SEC-01 and SEC-02 more time-sensitive.
- **Live Stripe key on your laptop.** `.env.local` holds a live `STRIPE_SECRET_KEY` and a `VERCEL_OIDC_TOKEN` (untracked, gitignored). Use a test key locally, and consider a restricted `rk_live_` key in production limited to Checkout, Billing Portal, Customers and Webhooks.
- **Trigger URL.** `supabase/008_alerts_webhook_trigger.sql:36` posts to the **apex** `https://groundworksinventory.dev/...`, which redirects (307) to `www`. SMS is reported as delivering, so the live trigger was presumably changed already, but the repo file should be updated to `www` so a rebuild of the database does not break alerts. I cannot read the live function body.
- **`notify_item_updated`** is `SECURITY DEFINER` with `search_path = public, extensions, vault`; it qualifies its references so it is not exploitable, but `set search_path = ''` is safer. The `items` trigger fires on every row update; adding `when (old.count is distinct from new.count)` reduces needless webhook calls.
- **Square OAuth `state`** is random, HttpOnly, SameSite=Lax and path-scoped, but is not bound to the user id; exploiting that requires cookie injection from a sibling subdomain. Binding it to `HMAC(user.id)` is cheap.
- **Middleware / cookies.** `src/lib/supabase/middleware.ts` ignores the `headers` argument that `@supabase/ssr` passes to `setAll` (cache headers for responses that set cookies). Pages are `force-dynamic` so impact is low.
- **Lost updates.** Count changes write absolute values computed in the browser (`InventoryTracker.tsx:3905-3931,4333-4374`), so two phones changing the same item at once, or an import during a Square sync, can silently overwrite each other. An atomic `count = greatest(0, count + delta)` RPC would fix it.
- **`Cache-Control: no-store`** on per-user GET handlers (`/api/owner-pin`, `/api/square/status`) is not needed today but protects against future caching changes.
- **Guides** load Google Fonts from Google's servers, which shares visitors' IPs with Google; self-hosting removes this. The guides contain no scripts, forms or sensitive data.
- **Square tokens** are AES-256-GCM encrypted; `decryptToken` does not pin `authTagLength` (pass `{ authTagLength: 16 }`).

---

## Checked and found OK

**Secrets and configuration**
- `.env.local` was never committed; `.gitignore` covers `.env*`; `.env.local.example` has empty values.
- No secrets in git history (43 commits, patterns listed in SEC-21), none in `public/` or `docs/`.
- Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY_B64` are public; the anon key's JWT role is `anon`. The service-role key is not exposed. The 11 production JS chunks contain none of the server secret names.
- `CRON_SECRET` and `ALERTS_WEBHOOK_SECRET` are random 32-character values; the Square token key is 32 bytes.
- Source maps are not served (`.map` requests return 403, no `sourceMappingURL`); no debug or test routes exist.
- No typosquatted dependencies; every lockfile entry has an integrity hash and resolves to the npm registry; the only install script is the expected dev-only `unrs-resolver`.

**Authentication and authorization**
- Every route and page uses `auth.getUser()` (server-validated). No route relies on the proxy; `src/proxy.ts` only refreshes the session, as intended, and its matcher covers all `/api` routes and pages.
- CVE-2025-29927 (`x-middleware-subrequest`): not present in this build (zero occurrences in `node_modules/next/dist`; a crafted header got 401 on production). React2Shell (CVE-2025-55182): no `npm audit` advisory on `react`, `react-dom` or `next` for it; React 19.2.8 is well above the fixed 19.2.1. I could not read the vendored RSC version directly.
- No route trusts a `shopId` from the request body except the two admin routes, which require an `admins` row. No IDOR was found in any API route. Square routes use `requireProOwner`, take the shop id from the session, and verify that referenced `itemId` and `menuItemId` values belong to the shop.
- RLS is enabled on all 15 tables. `items`, `menu_items`, `ingredients`, `batches`, `alert_recipients` and `order_marks` have owner-scoped policies with matching `USING` and `WITH CHECK`, including cross-table ownership checks (an `ingredients` row cannot point at another tenant's item; a `batch` cannot attach to another tenant's item; an `order_marks` upsert against another tenant's item fails). Live: anonymous reads returned no rows on any table.
- `admins` has select-only policy on the user's own row, so no self-promotion. `handle_new_user` is `SECURITY DEFINER` with a pinned search path and a hard-coded `'none'` tier.
- `apply_square_sales` is revoked from `public`/`anon`/`authenticated` and granted to `service_role` only; `consume_batches_fifo` is security-invoker so RLS applies.
- Stripe and Twilio webhooks verify signatures on the raw body before acting (Twilio with HMAC-SHA1 and `timingSafeEqual`); both fail closed when the secret is unset. Tier is derived from a server-side price-id mapping, never from client data. Checkout whitelists the plan; the portal uses the caller's own customer id.
- Owner PIN storage uses scrypt with a per-PIN salt and `timingSafeEqual`; the hash never leaves the server.
- The demo user is correctly blocked from Stripe, Square, owner PIN, admin delete, and both SMS paths.

**Injection, XSS, redirects**
- No `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function`, `document.write`, iframes or `postMessage` in `src`. All user strings render as React text. No raw SQL string-building (all queries use the client builders; no `.or()` filter strings).
- Twilio inbound replies use constant TwiML. `target="_blank"` links carry `rel="noreferrer"`. No third-party scripts.
- No open redirect found: callback redirects are fixed same-origin strings; Square OAuth state is checked.
- CSV import is parsed in the browser only; no upload route exists.

**Transport and caching**
- HSTS is present (`max-age=63072000`; the `.dev` TLD is also preloaded). HTTP redirects to HTTPS.
- State-changing routes are POST-only (GET returned 405 in live probes); cookies are SameSite=Lax; no CORS headers on API routes (a foreign `Origin` got no `Access-Control-Allow-Origin`).
- Dynamic pages are `force-dynamic`; `/` and `/login` send `no-store`. No ISR, `use cache` or `revalidate` anywhere.

## Could not verify from code

- **Live database state beyond what I probed:** whether the live policies, grants and function bodies match `supabase/*.sql` (anything created in the dashboard would not appear in the repo). Useful read-only queries: `select * from pg_policies where schemaname = 'public'` and `select proname, proacl from pg_proc where pronamespace = 'public'::regnamespace`.
- **The live `notify_item_updated` trigger URL** (apex or `www`; see SEC-21) and the Vault secret matching `ALERTS_WEBHOOK_SECRET`.
- **Supabase Auth dashboard:** "Secure password change", "Secure email change", the redirect-URL allow-list (it should be exact `https://www.groundworksinventory.dev/**`, no wildcards, since the reset flow uses `window.location.origin`), CAPTCHA, rate limits and SMTP quota, minimum password length (the client enforces 6), leaked-password protection, session timeouts, and whether any email template renders `{{ .Data.shop_name }}` (user-controlled sign-up metadata).
- **Twilio:** Geo Permissions, spend caps and usage triggers, Advanced Opt-Out, and that the inbound webhook URL is exactly the `www` URL.
- **Stripe:** enabled payment methods (SEC-08 item 4), Customer Portal settings (cancel, switch plan), any Payment Links reusing these prices, webhook endpoint URL and event list, and whether the live key is restricted.
- **Vercel:** plan (the `*/10` cron needs Pro), env-var scoping between Production and Preview, any WAF/firewall rules set in the dashboard, deployment protection, whether the production runtime is really `next@16.3.3`, and whether Vercel's own optimiser or the app's `sharp` serves `/_next/image` (relevant to SEC-03).
- **GitHub:** secret scanning/push protection settings, and any history rewritten before the local clone.
- **Cookie flags in production:** whether `@supabase/ssr` marks cookies `Secure` (the code sets `sameSite: lax` and `httpOnly: false` and no `secure`; HTTPS-only domain and HSTS limit the risk).
- **Email change without confirmation** (SEC-04), the pre-registration hijack (SEC-05) and the SMS abuse (SEC-02): not run, because they need a real mailbox, would send real texts, or would break the live demo.
- **Domain/mailbox ownership** of the demo account's email address.

## Proposed order of work (after you approve)

1. **SEC-01:** migration `016` (you run it in the Supabase SQL Editor), then I verify with a throwaway account.
2. **SEC-02:** recipient and item-name constraints, message sanitising, cooldown, daily cap; you set Twilio Geo Permissions and a spend alert.
3. **SEC-03:** upgrade `next`/`eslint-config-next` to 16.4.3 and `sharp`/`source-map-js`, rebuild, smoke-test, deploy.
4. **SEC-04, SEC-05:** you change the Supabase Auth dashboard settings; I add `signOut({ scope: "others" })` after reset and test the sign-up flow.
5. **SEC-07:** demo credential and tier re-assert in the reset route.
6. **SEC-06:** atomic PIN counter and honest wording now; the real server-side PIN boundary only if you want it.
7. **SEC-08:** Stripe checkout and webhook guards.
8. **SEC-09, SEC-11:** rate limits and security headers/CSP (preview deploy first).
9. **SEC-10:** align the privacy policy with the code, then add real double opt-in.
10. **SEC-12 to SEC-21:** the remaining Low and Info items, batched.

Items that need a decision from you rather than just an approval: whether the PIN should become a real server-side lock (SEC-06), whether `past_due` should lock a shop out immediately (SEC-08), and whether US/Canada-only numbers is acceptable for alerts (SEC-02).
