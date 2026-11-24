# Make My Marriage

A portfolio wedding-management application built as a modular monolith with Next.js App Router, TypeScript, and the Node.js runtime.

## Current status

See the [development progress tracker](docs/development-progress.md) for feature status, open issues, verification, and the work log. Repository agent instructions in [AGENTS.md](AGENTS.md) require updates alongside future features and bug fixes.

The landing page links to working registration and login routes. Identity includes Argon2id passwords, Auth.js credentials/JWT sessions, explicit email verification, password recovery, session invalidation, and a protected account entry page. Wedding setup and membership are next; the landing dashboard and feature previews remain fictional illustrations.

Public pages build and run without external configuration. Account fields remain editable when configuration is missing; submission stays disabled with an explanatory notice until the required server settings exist. No Atlas database, Resend inbox, or deployment has been configured or verified by this implementation. Simulated email persists encrypted messages without sending them or proving email ownership.

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

| Command                   | Purpose                                                            |
| ------------------------- | ------------------------------------------------------------------ |
| `npm run dev`             | Start the local development server                                 |
| `npm run build`           | Create a production build                                          |
| `npm run start`           | Serve the existing production build                                |
| `npm run lint`            | Run Next.js/React/TypeScript ESLint rules                          |
| `npm run lint:fix`        | Apply available lint fixes                                         |
| `npm run typecheck`       | Generate Next.js route types, then check TypeScript                |
| `npm run format:check`    | Check formatting                                                   |
| `npm run format`          | Format application and configuration files                         |
| `npm run check`           | Run lint, formatting checks, and type checking                     |
| `npm run db:migrate`      | Apply additive identity collections/indexes/validators             |
| `npm run email:reconcile` | Reconcile at most 100 interrupted/stale identity jobs; never sends |
| `npm test`                | Run isolated MongoDB integration and security tests                |
| `npm run test:auth-http`  | Build and verify the production Auth.js HTTP/cookie lifecycle      |

Run `npm run check` and `npm run build` before submitting changes. Linting runs separately from the production build. The existing `docs/` directory is excluded from formatting to preserve the implementation contracts.

## Structure and conventions

```text
docs/                      Existing requirements and implementation contracts
public/images/landing/     Wedding imagery from the approved Stitch exports
src/app/fonts/             Local Inter/Playfair Display fonts and OFL licenses
src/app/layout.tsx         Root layout, fonts, metadata, and Node.js runtime
src/app/page.tsx           Homepage entry point
src/app/globals.css        Global reset and design tokens
src/components/landing/    Landing content, previews, client controls, and CSS Module
```

TypeScript uses strict mode and the `@/*` alias for `src/*`. Component styles use CSS Modules, with global CSS variables for shared design tokens. Inter and Playfair Display are self-hosted through `next/font/local`; their SIL Open Font License files are included beside them. No remote font or Stitch credential is needed at build time or in the browser.

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

Copy `.env.example` to ignored `.env.local`, then fill the settings needed for identity. Never put real credentials in the example. Use separate development, preview, and production databases. Run `npm run db:migrate` explicitly against the intended database before using accounts; requests check required validators, validation enforcement, and index definitions and do not silently create them. An incomplete migration fails closed. The MongoDB deployment must support transactions (Atlas or a replica set), and the migration identity needs collection/index/validator permissions. The additive migration can be run again; it never drops data or indexes.

Required for login: `APP_ORIGIN`, `MONGODB_URI`, `MONGODB_DB_NAME`, and a random `AUTH_SECRET` of at least 32 characters. Registration and email requests additionally require `TOKEN_ENCRYPTION_KEY` (32 random bytes encoded as base64), `TOKEN_ENCRYPTION_KEY_ID`, and valid email settings. Generate the secret and encryption key independently in a password manager or local secret generator and save them directly in the ignored environment file. Keep the encryption key stable; replacing it makes existing encrypted messages unreadable. Back it up securely; key rotation with multiple retained keys is not implemented.

`APP_ORIGIN` must exactly match the browser origin, including the port. Use `http://localhost:3000` consistently in local development, or set it to `http://127.0.0.1:3000` if that is how you open the app. Production/preview require HTTPS and a trusted deployment host. Auth.js uses secure cookies for HTTPS. Its verified compatible release is pinned at `5.0.0-beta.32`; upgrading this beta requires repeating the HTTP/session tests. Do not add an adapter or a second login endpoint.

All configuration, database, security, authentication, provider, and business-service modules are server-only. Secrets never use `NEXT_PUBLIC_`, enter client props, or appear in application logs. Configuration validates lazily: public rendering/builds do not connect to services. An invoked missing integration returns a safe `SERVICE_NOT_CONFIGURED` response. Unavailable services never trigger an authentication bypass.

Email modes:

- `simulated` (default): encrypt and persist the intended message, with no provider calls or quota usage. It does **not** deliver a usable link to a user or verify the account. There is no public token-preview endpoint or console output of links.
- `test`: set `RESEND_API_KEY`, a controlled `EMAIL_TEST_RECIPIENT`, and the quota settings below. A verification/reset challenge is eligible only when its intended recipient exactly matches that controlled address; it is never redirected from someone else's account. Subjects are labelled `[TEST]`.
- `live`: additionally set `EMAIL_FROM` to a sender on a verified domain. Real delivery still requires provider/inbox validation. Keep Resend SDK debug logging disabled (`RESEND_DEBUG` unset) to avoid logging provider diagnostics.

Real sends require `EMAIL_QUOTA_NAMESPACE`, `EMAIL_DAILY_LIMIT` (at most 100), `EMAIL_MONTHLY_LIMIT`, and ISO `EMAIL_MONTH_WINDOW_START`/`EMAIL_MONTH_WINDOW_END` containing the current time and matching the provider allowance window. Daily windows use UTC. Update the monthly window when it rolls over; sending fails closed outside it. Deployments sharing a provider account must share the same accounting database/namespace or receive explicit sub-budgets. Out-of-band sends must be reflected before application sending is enabled.

Every eligible request persists a single-recipient operation/job and makes one bounded attempt. There are no workers or automatic retries. A new explicit verification/recovery request replaces old challenges and tries a new message. Quota exhaustion keeps a generic acknowledgement. Unknown provider outcomes retain held quota and never automatically resend. New quota-window claims also hold capacity for older in-flight/unknown sends and for acceptances settled after the reset; the `carryHeld` portion of `held` is refreshed transactionally before any new reservation. Original-window accounting is preserved. Pending pre-dispatch claims are counted conservatively until they are cancelled or resolved. `npm run email:reconcile` cancels interrupted pre-dispatch jobs and turns expired post-dispatch leases into `needsReview`, holding both allowances. It never releases an ambiguous send: investigate provider records before any manual accounting correction. General email-operation continuation and operator resolution UI are later email-module work.

Verification links expire after 24 hours and reset links after 30 minutes. Their secret lives in a URL fragment, is removed from the address bar, and is consumed only on explicit POST. Refreshing after that removal requires reopening the original email. Password reset increments the database session generation and revokes previous sessions and outstanding challenges. Unverified users may log in; creating/joining a wedding will require verification in the next feature.

## Authentication verification

`npm test` uses a disposable local replica set via `mongodb-memory-server-core`; it never uses the configured Atlas URI or contacts Resend. It may download a MongoDB test binary on first run. To use an installed binary instead, set `MONGOMS_SYSTEM_BINARY` and the matching `MONGOMS_VERSION` (the implementation was tested with MongoDB 6.0.10). Local socket/process permissions are required. The test database is removed after the suite.

`npm run test:auth-http` first builds, then starts an isolated production server on a free loopback port. It verifies real Auth.js cookies, wrong-password handling, protected redirects, `/api/v1/me`, explicit verification, reset session revocation, and logout, including during an actual temporary database outage and exhausted login limits. JWT sign-out and Auth.js CSRF bootstrap do not depend on MongoDB availability. It is an HTTP integration test, not a browser test. Remaining manual acceptance: configured Atlas, delivery to a controlled Resend inbox, mobile layouts, keyboard/form interaction, and URL-fragment behavior in the browser. Desktop login rendering and the honest unconfigured state have been inspected.

The email allowance and 8,000,000,000-byte photo budget are shared across all weddings. Isolated preview databases do not create additional provider allowances: use shared accounting or explicitly allocated sub-budgets. Photos remain private in R2, with a 20,000,000-byte original limit and separate upload/view grants.

## Implementation contracts

- [Product requirements](docs/product-requirement-document.md)
- [Engineering and system architecture](docs/engineering-architecture-document.md)
- [Database design and embedded ERD](docs/make-my-marriage-database-design-document.md)
- [API design](docs/API-design-document.md)

Some companion links inside the existing documents reference older filenames. Use the actual filenames above; the documents have been preserved.

The API's `/api/v1` paths supersede the architecture's illustrative paths. The database design's active-only membership uniqueness supersedes earlier permanent-membership wording. Removed non-owner members retain history and may join another wedding. Ownership remains permanent in V1. Invitation send status derives from accepted live jobs for the current contact revision.

## Next development steps

1. Complete configured Atlas/controlled-inbox and browser acceptance for identity. The code and isolated transaction/HTTP tests are implemented; external delivery is not yet verified.
2. Transactional wedding creation and membership, owner protection, roles, removal/rejoining, and cross-wedding access tests. Wedding creation also creates the two required gallery-access records.
3. Wedding details, events, public projections, and the initial dashboard.
4. Guests, event invitations, scoped RSVP grants, durable email operations, and manual continuation.
5. Expenses, payment-date rules, totals, soft deletion, and concurrent-edit handling.
6. Private photos, storage accounting, previews, original downloads, cleanup, QR codes, livestream settings, and acceptance verification.

Verify landing-page navigation, mobile-menu dismissal, account navigation, FAQ keyboard access, reduced-motion behavior, image loading, and narrow-screen layout during browser QA. Add automated domain tests as business behavior appears; avoid file-existence tests. MongoDB integration tests must exercise indexes and transactions, not just mocked model calls.

## Deployment

The future deployment target is Vercel with Node.js 24.x and Next.js framework detection, using the repository root. The scaffold does not deploy or provision services. Keep the Vercel runtime major aligned with `package.json` and `.nvmrc`; Vercel manages runtime patch updates. No custom Vercel configuration is needed for this shell.
