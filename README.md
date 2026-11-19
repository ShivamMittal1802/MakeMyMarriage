# Make My Marriage

A portfolio wedding-management application built as a modular monolith with Next.js App Router, TypeScript, and the Node.js runtime.

## Current status

This repository contains the application scaffold and project documentation. The homepage is a static placeholder. Authentication, database persistence, business APIs, email delivery, photo uploads, and dashboard screens are not implemented yet. No external services are contacted by the shell.

## Local setup

Use Node.js **24.x** and npm. With nvm installed:

```sh
nvm install
nvm use
npm ci
npm run dev
```

Open <http://localhost:3000>. An environment file is not required to run or build the initial shell.

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

| Command                | Purpose                                             |
| ---------------------- | --------------------------------------------------- |
| `npm run dev`          | Start the local development server                  |
| `npm run build`        | Create a production build                           |
| `npm run start`        | Serve the existing production build                 |
| `npm run lint`         | Run Next.js/React/TypeScript ESLint rules           |
| `npm run lint:fix`     | Apply available lint fixes                          |
| `npm run typecheck`    | Generate Next.js route types, then check TypeScript |
| `npm run format:check` | Check formatting                                    |
| `npm run format`       | Format application and configuration files          |
| `npm run check`        | Run lint, formatting checks, and type checking      |

Run `npm run check` and `npm run build` before submitting changes. Linting runs separately from the production build. The existing `docs/` directory is excluded from formatting to preserve the implementation contracts.

## Structure and conventions

```text
docs/                  Existing requirements and implementation contracts
src/app/layout.tsx     Root layout, metadata, and Node.js runtime
src/app/page.tsx       Placeholder homepage
src/app/globals.css    Global reset, design tokens, and shell styles
```

TypeScript uses strict mode and the `@/*` alias for `src/*`. Use CSS Modules for future component styles and global CSS variables for shared design tokens. System fonts keep startup and builds independent of remote font services.

Add folders only when implementing their features:

- `src/app/(public)`, `(auth)`, `(portal)`, and `(guest)` for page/layout boundaries. Onboarding needs an account; dashboard access additionally needs current membership.
- `src/app/api/v1/` for application Route Handlers, following the API document. Auth.js owns `src/app/api/auth/[...nextauth]/route.ts` separately.
- `src/modules/identity`, `weddings`, `events`, `guests`, `email`, `expenses`, and `gallery` for feature services, models, validation schemas, DTOs/types, and feature components. Membership belongs with weddings; RSVP belongs with guests.
- `src/components/ui/` and `src/components/layout/` for reusable interface elements.
- `src/lib/config/`, `db/`, `access/`, `security/`, `http/`, `validation/`, and `providers/` for shared configuration, database connections, authorization, CSRF/grants, API conventions, primitive validators, and Resend/R2 adapters.
- `src/auth.ts` for server-only Auth.js configuration and `src/types/auth.d.ts` for session type augmentation when needed.
- Tests beside modules for domain behavior, `tests/integration/` for API/database invariants, and `tests/e2e/` for browser journeys.
- `scripts/migrations/` for explicit schema/index migrations and bounded operator commands when required.

Keep Route Handlers thin. Server-rendered pages and HTTP handlers call the same server services. Services enforce current authorization independently of page redirects. Keep types beside their owning schema or DTO; avoid generic repository hierarchies and empty placeholder modules.

## Configuration and secrets

`.env.example` documents proposed future server configuration. When integrations are implemented, copy it to ignored `.env.local` and supply only the values required for that feature. Do not commit `.env.local` or real credentials. On Vercel, configure environment variables separately for development, preview, and production.

The scaffold does not consume these variables or implement configuration validation yet. Blank integration settings do not make a working service. Add service-specific validation when implementing each integration, and return the contract's `SERVICE_NOT_CONFIGURED` error if an invoked service is unavailable. Do not connect to providers during module imports or application builds.

Mark future configuration, authentication, database, provider, and business-service modules with `server-only`. Secrets must never use `NEXT_PUBLIC_` prefixes, enter client props, or appear in logs. Keep application origin handling and Auth.js deployment settings consistent with the selected Auth.js version.

The intended email modes are `simulated`, `test`, and `live`. Simulated mode makes no provider calls; test mode sends only to the controlled Resend account email and never counts as live guest delivery or proof of another person's email ownership. Verify provider allowance/reset semantics before configuring real sends. Live email requires a verified sender domain.

The email allowance and 8,000,000,000-byte photo budget are shared across all weddings. Isolated preview databases do not create additional provider allowances: use shared accounting or explicitly allocated sub-budgets. Photos remain private in R2, with a 20,000,000-byte original limit and separate upload/view grants.

## Implementation contracts

- [Product requirements](docs/product-requirement-document.md)
- [Engineering and system architecture](docs/engineering-architecture-document.md)
- [Database design and embedded ERD](docs/make-my-marriage-database-design-document.md)
- [API design](docs/API-design-document.md)

Some companion links inside the existing documents reference older filenames. Use the actual filenames above; the documents have been preserved.

The API's `/api/v1` paths supersede the architecture's illustrative paths. The database design's active-only membership uniqueness supersedes earlier permanent-membership wording. Removed non-owner members retain history and may join another wedding. Ownership remains permanent in V1. Invitation send status derives from accepted live jobs for the current contact revision.

## Next development steps

1. Identity configuration, MongoDB connection/models/indexes, validation, CSRF/error conventions, Argon2id passwords, and Auth.js credentials/JWT sessions. Verify Auth.js release-channel compatibility before installation. Implement verification/recovery with minimal durable email/quota support.
2. Transactional wedding creation and membership, owner protection, roles, removal/rejoining, and cross-wedding access tests. Wedding creation also creates the two required gallery-access records.
3. Wedding details, events, public projections, and the initial dashboard.
4. Guests, event invitations, scoped RSVP grants, durable email operations, and manual continuation.
5. Expenses, payment-date rules, totals, soft deletion, and concurrent-edit handling.
6. Private photos, storage accounting, previews, original downloads, cleanup, QR codes, livestream settings, and acceptance verification.

Add meaningful tests as domain behavior appears; the static placeholder does not need file-existence tests. MongoDB integration tests must exercise indexes and transactions, not just mocked model calls.

## Deployment

The future deployment target is Vercel with Node.js 24.x and Next.js framework detection, using the repository root. The scaffold does not deploy or provision services. Keep the Vercel runtime major aligned with `package.json` and `.nvmrc`; Vercel manages runtime patch updates. No custom Vercel configuration is needed for this shell.
