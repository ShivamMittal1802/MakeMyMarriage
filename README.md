# Make My Marriage

A portfolio wedding-management application built as a modular monolith with Next.js App Router, TypeScript, and the Node.js runtime.

## Current status

See the [development progress tracker](docs/development-progress.md) for feature status, open issues, verification, and the work log. Repository agent instructions in [AGENTS.md](AGENTS.md) require updates alongside future features and bug fixes.

The landing page links to working registration and login routes. Identity includes Argon2id passwords, Auth.js credentials/JWT sessions, explicit email verification, password recovery, session invalidation, and a protected account entry page. Wedding onboarding now includes details, review, atomic creation, confirmation, a verification gate, and private planning-team invitation acceptance. A minimal member-only wedding entry shows saved details and lets authorised organisers create/share invitations. The full dashboard and public wedding website remain future work; landing-page previews remain fictional illustrations.

Public pages build and run without external configuration. Account fields remain editable when configuration is missing; submission stays disabled with an explanatory notice until the required server settings exist. Development Atlas connectivity, both migrations, and registration/login HTTP acceptance have been verified. The configured account check also covered wrong-password rejection, current account access, the unverified-email gate, and logout. Real Resend inbox delivery and deployment remain unverified. Simulated email persists encrypted messages without sending them or proving email ownership.

## Local setup

Use Node.js **24.x** and npm. With nvm installed:

```sh
nvm install
nvm use
npm ci
npm run dev
```

Open <http://localhost:3000>. An environment file is not required to run or build the landing page.

If using another Node manager, select Node 24 before installing dependencies. An existing Homebrew Node 24 installation can also be selected for the current terminal:

```sh
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
node --version
npm ci
npm run dev
```

Commit `package-lock.json` when dependencies change. Use `npm ci` for subsequent clean installations; do not mix package-manager lockfiles. Direct dependency versions are pinned. TypeScript 5.9 and ESLint 9 were selected to remain within the checked tooling compatibility ranges.

Tooling caveat: npm marks ESLint 9 as deprecated, but the current Next.js React/import/accessibility plugins do not yet declare ESLint 10 support. Keep the compatible version for now and upgrade the lint stack together when those peer ranges permit it. The current TypeScript lint parser also excludes TypeScript 7.

## Commands

| Command                       | Purpose                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| `npm run dev`                 | Start the local development server                                 |
| `npm run build`               | Create a production build                                          |
| `npm run start`               | Serve the existing production build                                |
| `npm run lint`                | Run Next.js/React/TypeScript ESLint rules                          |
| `npm run lint:fix`            | Apply available lint fixes                                         |
| `npm run typecheck`           | Generate Next.js route types, then check TypeScript                |
| `npm run format:check`        | Check formatting                                                   |
| `npm run format`              | Format application and configuration files                         |
| `npm run check`               | Run lint, formatting checks, and type checking                     |
| `npm run db:migrate`          | Apply additive identity collections/indexes/validators             |
| `npm run db:migrate:weddings` | Apply wedding/membership/invitation/gallery-access definitions     |
| `npm run email:reconcile`     | Reconcile at most 100 interrupted/stale identity jobs; never sends |
| `npm test`                    | Run isolated MongoDB integration and security tests                |
| `npm run test:auth-http`      | Build and verify the production Auth.js HTTP/cookie lifecycle      |

Run `npm run check` and `npm run build` before submitting changes. Linting runs separately from the production build. The existing `docs/` directory is excluded from formatting to preserve the implementation contracts.

## Structure and conventions

```text
docs/                      Existing requirements and implementation contracts
public/images/landing/     Landing imagery from the approved Stitch exports
public/images/onboarding/  Onboarding imagery from the approved Stitch exports
src/app/(portal)/          Protected onboarding, private join context, wedding entry
src/modules/weddings/      Wedding/membership services, schemas, models, and screens
src/app/fonts/             Local Inter/Playfair Display fonts and OFL licenses
src/app/layout.tsx         Root layout, fonts, metadata, and Node.js runtime
src/app/page.tsx           Homepage entry point
src/app/globals.css        Global reset and design tokens
src/components/landing/    Landing content, previews, client controls, and CSS Module
```

TypeScript uses strict mode and the `@/*` alias for `src/*`. Component styles use CSS Modules, with global CSS variables for shared design tokens. Inter and Playfair Display are self-hosted through `next/font/local`; their SIL Open Font License files are included beside them. No remote font or Stitch credential is needed at build time or in the browser.

The landing page reads the current account and active membership on the server and renders per request with private/no-store caching. Signed-out visitors see login/registration links; signed-in accounts see their email, logout, and Continue setup or My wedding. The same destination applies to header, drawer, hero, closing and footer account links. Mounting the page, returning focus, or restoring a browser page refreshes account state, including after cached back/forward navigation. Account-service failures do not prevent the public landing content from rendering. No session secrets or password data enter client props.

Most landing content renders on the server. Only interactive controls use client-side React. The mobile navigation dialog supplies modal focus handling and Escape dismissal; native details/summary elements supply keyboard-accessible FAQs. The copy follows the implementation contracts, including individual guest invitations, one owner, manual email reminders, separate photo grants, and individual original downloads.

Add folders only when implementing their features:

- Future `(public)` and `(guest)` route groups complement the implemented `(auth)` and `(portal)` pages. Onboarding needs an account; dashboard access additionally needs current membership.
- `src/app/api/v1/` for application Route Handlers, following the API document. Auth.js owns `src/app/api/auth/[...nextauth]/route.ts` separately.
- `src/modules/identity`, `weddings`, `events`, `guests`, `email`, `expenses`, and `gallery` for feature services, models, validation schemas, DTOs/types, and feature components. Membership belongs with weddings; RSVP belongs with guests.
- `src/components/ui/` and `src/components/layout/` for reusable interface elements.
- `src/lib/config/`, `db/`, `access/`, `security/`, `http/`, `validation/`, and `providers/` for shared configuration, database connections, authorization, CSRF/grants, API conventions, primitive validators, and Resend/R2 adapters.
- `src/auth.ts` for server-only Auth.js configuration and `src/types/auth.d.ts` for session type augmentation when needed.
- Tests beside modules for domain behavior, `tests/integration/` for API/database invariants, and `tests/e2e/` for browser journeys.
- `scripts/migrations/` for explicit schema/index migrations and bounded operator commands when required.

Keep Route Handlers thin. Server-rendered pages and HTTP handlers call the same server services. Services enforce current authorization independently of page redirects. Keep types beside their owning schema or DTO; avoid generic repository hierarchies and empty placeholder modules.

## Configuration and secrets

Copy `.env.example` to ignored `.env.local`, then fill the settings needed for identity. Never put real credentials in the example. Use separate development, preview, and production databases. Run the migrations explicitly against the intended database in this order:

```sh
npm run db:migrate
npm run db:migrate:weddings
```

The first prepares identity; the second is required before wedding creation or joining. Both were verified against isolated MongoDB fixtures and have now succeeded against the configured development Atlas database. Runtime registration/login require read/write permission in addition to migration privileges; both permission classes are now working in the configured development environment. Neither command changes cloud permissions. Wedding migration refuses a legacy permanent unique `memberships.userId` index, which needs a controlled audit rather than an automatic drop.

Application requests check required validators, validation enforcement, and index definitions and do not silently create them. An incomplete migration fails closed. The MongoDB deployment must support transactions (Atlas or a replica set), and the migration identity needs collection/index/validator permissions. The additive migration can be run again; it never drops data or indexes.

If registration or login reports “Account access is not ready yet. Please try again later.”, the database contract check failed. Migration needs `dbAdmin` (including `collMod`) while the running application needs `readWrite`. In Atlas → Security → Database & Network Access → Database Users, edit the configured database user. Under Specific Privileges, keep **both** `readWrite` and `dbAdmin` scoped to the database named by `MONGODB_DB_NAME`, then save Update User. In the current development setup that database is `make_my_marriage_dev`. Setting only `dbAdmin` lets migrations pass but blocks account reads and form-token requests. Both migrations and configured registration/login HTTP checks have now succeeded after restoring both permission classes. It does not need Atlas admin or access to all databases. Production migration credentials should be separate from runtime credentials. [Atlas database-user instructions](https://www.mongodb.com/docs/atlas/security-add-mongodb-users/).

Required for login: `APP_ORIGIN`, `MONGODB_URI`, `MONGODB_DB_NAME`, and a random `AUTH_SECRET` of at least 32 characters. Registration, email requests, wedding creation, and invitation creation/sharing additionally require `TOKEN_ENCRYPTION_KEY` (32 random bytes encoded as base64), `TOKEN_ENCRYPTION_KEY_ID`, and valid email settings. Generate the secret and encryption key independently in a password manager or local secret generator and save them directly in the ignored environment file. Keep the encryption key stable; replacing it makes existing encrypted messages unreadable. Back it up securely; key rotation with multiple retained keys is not implemented.

`APP_ORIGIN` must exactly match the browser origin, including the port. Use `http://localhost:3000` consistently in local development, or set it to `http://127.0.0.1:3000` if that is how you open the app. Production/preview require HTTPS and a trusted deployment host. Auth.js uses secure cookies for HTTPS. Its verified compatible release is pinned at `5.0.0-beta.32`; upgrading this beta requires repeating the HTTP/session tests. Do not add an adapter or a second login endpoint.

All configuration, database, security, authentication, provider, and business-service modules are server-only. Secrets never use `NEXT_PUBLIC_`, enter client props, or appear in application logs. Configuration validates lazily: public rendering/builds do not connect to services. An invoked missing integration returns a safe `SERVICE_NOT_CONFIGURED` response. Unavailable services never trigger an authentication bypass.

Email modes:

- `simulated` (default): encrypt and persist the intended message, with no provider calls or quota usage. It does **not** deliver a usable link to a user or verify the account. There is no public token-preview endpoint or console output of links.
- `test`: set `RESEND_API_KEY`, a controlled `EMAIL_TEST_RECIPIENT`, and the quota settings below. A verification/reset challenge is eligible only when its intended recipient exactly matches that controlled address; it is never redirected from someone else's account. Subjects are labelled `[TEST]`.
- `live`: additionally set `EMAIL_FROM` to a sender on a verified domain. Real delivery still requires provider/inbox validation. Keep Resend SDK debug logging disabled (`RESEND_DEBUG` unset) to avoid logging provider diagnostics.

Real sends require `EMAIL_QUOTA_NAMESPACE`, `EMAIL_DAILY_LIMIT` (at most 100), `EMAIL_MONTHLY_LIMIT`, and ISO `EMAIL_MONTH_WINDOW_START`/`EMAIL_MONTH_WINDOW_END` containing the current time and matching the provider allowance window. Daily windows use UTC. Update the monthly window when it rolls over; sending fails closed outside it. Deployments sharing a provider account must share the same accounting database/namespace or receive explicit sub-budgets. Out-of-band sends must be reflected before application sending is enabled.

Every eligible request persists a single-recipient operation/job and makes one bounded attempt. There are no workers or automatic retries. A new explicit verification/recovery request replaces old challenges and tries a new message. Quota exhaustion keeps a generic acknowledgement. Unknown provider outcomes retain held quota and never automatically resend. New quota-window claims also hold capacity for older in-flight/unknown sends and for acceptances settled after the reset; the `carryHeld` portion of `held` is refreshed transactionally before any new reservation. Original-window accounting is preserved. Pending pre-dispatch claims are counted conservatively until they are cancelled or resolved. `npm run email:reconcile` cancels interrupted pre-dispatch jobs and turns expired post-dispatch leases into `needsReview`, holding both allowances. It never releases an ambiguous send: investigate provider records before any manual accounting correction. General email-operation continuation and operator resolution UI are later email-module work.

Verification links expire after 24 hours and reset links after 30 minutes. Their secret lives in a URL fragment, is removed from the address bar, and is consumed only on explicit POST. Refreshing after that removal requires reopening the original email. Password reset increments the database session generation and revokes previous sessions and outstanding challenges. Unverified users may log in; creating or joining a wedding normally requires verified email. The user-authorised local development exception below temporarily satisfies that access check.

## Temporary local development verification

While Resend setup is deferred, the user has authorised all local development accounts to pass email-verification access checks. Set `DEV_SKIP_EMAIL_VERIFICATION=true` in ignored `.env.local` (enabled locally for the current development session). The committed environment example keeps it `false`.

The exception requires **all** of: `next dev` / `NODE_ENV=development`, a loopback `APP_ORIGIN` (`localhost`, `127.0.0.1`, or `[::1]`), a database name ending in `_dev` or `_test`, `EMAIL_MODE=simulated`, and no Vercel runtime. It applies to existing and new accounts. `/api/v1/me` reports `emailVerified: true`, and onboarding/wedding/invitation access uses the same rule. Login, current-session checks, intended invitation email matching, membership limits, and roles still apply.

Stored `emailVerifiedAt` values are unchanged; this temporary access decision does not prove inbox ownership or send email. Set `DEV_SKIP_EMAIL_VERIFICATION=false` (or remove it) and restart the dev server to restore the real verification requirement immediately, including for accounts that used the exception. Enabling test/live email also disables it. Production ignores the flag, even when accidentally configured. Use the development database only for development identities; no data migration is needed for this exception.

The production HTTP suite deliberately sets the flag and still verifies the real unverified-email gate. Isolated tests cover the environment guards, development create/join access, unchanged stored timestamps, and restoring the requirement when the flag is disabled.

## Wedding onboarding

Open `/onboarding` after login. Accounts that satisfy the verification check and have no membership can enter the couple’s names, a valid date, location, website slug, optional introduction, and their own role. Review preserves edits before an explicit create action. Creation commits the wedding, permanent owner membership, and separate encrypted photo upload/view access records in one transaction. Photo storage and public website rendering are not implemented by those records. The selected Bride/Groom/Manager role is separate from ownership; names do not create accounts or assign roles. Wedding timezone and currency are fixed to Asia/Kolkata and INR.

Members return to `/dashboard/[weddingId]`, a minimal private entry with real saved details and an Open planning team link. `/dashboard/[weddingId]/team` contains the active roster and administrator-only pending invitations. The owner, bride and groom can create/share/revoke private invitations, change non-owner roles and remove non-owner members. Managers can view the active roster; they cannot read invitation emails or perform administration. Ownership and the owner’s selected role remain immutable. Creation does not send email. Invitations are tied to an intended email and expire after seven days; pending invitations do not reserve a Bride/Groom role.

`/join#token=…` exchanges a private link for a resource-scoped HttpOnly grant and then uses a clean `/join/[invitationId]` address. No intended email is exposed anonymously. Joining requires the intended verified account and an explicit Accept action, with membership and role conflicts checked transactionally. The grant lasts at most 15 minutes; reopen the original link if it expires. Login/registration preserve the pending context in cookies, while Not now lets an eligible account continue to wedding setup without accepting. An existing active membership always prevents creating or joining another wedding. Guest RSVP and photo grants remain separate future flows.

## Planning team management

The team screen follows the approved Stitch Admin/Manager desktop exports and their embedded invite/share/change-role/remove/revoke dialogs. Mobile uses cards and bottom-sheet dialogs from the agreed responsive brief. Design-only preview controls, roster emails, global counters, co-owner wording, vendor/task features and fictional support links are omitted.

Member and invitation list APIs use cursor pagination: default 25, maximum 100. Members default to active; revoked history is administrator-only. Invitations default to unexpired pending records; accepted/revoked/expired filters are supported by the API. Cursors are encrypted, expire after one hour, and are bound to the account/session generation, wedding, endpoint, filters, limit and access scope. Restart pagination when filters or permissions change. The roster returns names/roles/join dates and owner flags without account emails or identity secrets. Only administrators receive invitation emails and admin revocation metadata.

Role PATCH and member/invitation DELETE require the record’s current version; conflicts ask the user to refresh. Deletions use `expectedVersion` in the query string and return an empty HTTP 204. Writes recheck current permissions, fence the actor membership and serialize roster changes. A non-owner Bride/Groom can demote or remove themselves; an ordinary Manager has no self-removal action in this release. Self-demotion removes administration controls and self-removal returns to the account area.

Removing a member preserves the historical membership and existing content, frees their active membership/role slot, revokes pending invitations for their email in this wedding, and cancels applicable undispatched invitation jobs. Rejoining requires a fresh invitation and creates a new membership row. Invitation revocation invalidates both raw links and previously exchanged grants without removing an already accepted member. Cancellation releases only definite pre-dispatch quota reservations; dispatched/ambiguous outcomes retain their holds. No member-invitation sending or email-operation UI is added here.

The dialogs use real responses, preserve drafts on failure and require a refresh after an uncertain result or stale version. Sharing exposes the recovered private link only on request, with explicit copy and manual WhatsApp actions. No new packages, configuration variables, database collections or migrations are required beyond migrations 001/002. Browser interaction/responsive acceptance remains pending under the progress tracker; source-design inspection and HTTP tests are not browser tests.

## Authentication and wedding verification

`npm test` uses a disposable local replica set via `mongodb-memory-server-core`; it never uses the configured Atlas URI or contacts Resend. It may download a MongoDB test binary on first run. To use an installed binary instead, set `MONGOMS_SYSTEM_BINARY` and the matching `MONGOMS_VERSION` (the implementation was tested with MongoDB 6.0.10). Local socket/process permissions are required. The test database is removed after the suite.

`npm run test:auth-http` first builds, then starts an isolated production server on a free loopback port. It verifies real Auth.js cookies, wrong-password handling, protected redirects, `/api/v1/me`, explicit verification, reset session revocation, and logout, including during an actual temporary database outage and exhausted login limits. It also applies both migration CLIs and verifies creation, private invitation exchange, registration/verification return context, postponement, explicit/idempotent acceptance, and membership restrictions. The team-management journey also exercises list pagination/privacy, protected role changes, stale versions, owner protection, invitation revocation, self-demotion and immediate removal access checks. JWT sign-out and Auth.js CSRF bootstrap do not depend on MongoDB availability. It is an HTTP integration test, not a browser test. Configured development Atlas registration/login HTTP checks also passed with a temporary synthetic account, including incorrect-password rejection, current account access, the verification gate, and logout; its related test data was removed. Remaining manual acceptance: delivery to a controlled Resend inbox, mobile layouts, keyboard/form interaction, and URL-fragment behavior in the browser. Desktop login rendering and the honest unconfigured state have been inspected. Onboarding desktop/mobile source exports were inspected, but browser acceptance remains pending: the current browser connector cannot attach, and native control follows the active user window.

The email allowance and 8,000,000,000-byte photo budget are shared across all weddings. Isolated preview databases do not create additional provider allowances: use shared accounting or explicitly allocated sub-budgets. Photos remain private in R2, with a 20,000,000-byte original limit and separate upload/view grants.

## Implementation contracts

- [Product requirements](docs/product-requirement-document.md)
- [Engineering and system architecture](docs/engineering-architecture-document.md)
- [Database design and embedded ERD](docs/make-my-marriage-database-design-document.md)
- [API design](docs/API-design-document.md)

Some companion links inside the existing documents reference older filenames. Use the actual filenames above; the documents have been preserved.

The API's `/api/v1` paths supersede the architecture's illustrative paths. The database design's active-only membership uniqueness supersedes earlier permanent-membership wording. Removed non-owner members retain history and may join another wedding. Ownership remains permanent in V1. Invitation send status derives from accepted live jobs for the current contact revision.

## Next development steps

1. Complete controlled Resend inbox and browser acceptance for identity. Configured Atlas migrations and registration/login HTTP checks have passed; external email delivery is not yet verified.
2. Complete onboarding browser/responsive acceptance; Atlas permissions and both migrations are verified. Team administration, role changes, revocation/removal and their API/concurrency tests are implemented; complete their browser acceptance next.
3. Wedding details, events, public projections, and the initial dashboard.
4. Guests, event invitations, scoped RSVP grants, durable email operations, and manual continuation.
5. Expenses, payment-date rules, totals, soft deletion, and concurrent-edit handling.
6. Private photos, storage accounting, previews, original downloads, cleanup, QR codes, livestream settings, and acceptance verification.

Verify landing-page navigation, mobile-menu dismissal, account navigation, FAQ keyboard access, reduced-motion behavior, image loading, and narrow-screen layout during browser QA. Add automated domain tests as business behavior appears; avoid file-existence tests. MongoDB integration tests must exercise indexes and transactions, not just mocked model calls.

## Deployment

The future deployment target is Vercel with Node.js 24.x and Next.js framework detection, using the repository root. The scaffold does not deploy or provision services. Keep the Vercel runtime major aligned with `package.json` and `.nvmrc`; Vercel manages runtime patch updates. No custom Vercel configuration is needed for this shell.
