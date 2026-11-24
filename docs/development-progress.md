# Make My Marriage — Development Progress

Last updated: 2026-11-24 (Asia/Kolkata)

This is the working record of implemented features, bug fixes, verification, and remaining work. It records delivery status; the [PRD](product-requirement-document.md), [architecture](engineering-architecture-document.md), [database design](make-my-marriage-database-design-document.md), and [API design](API-design-document.md) remain the implementation contracts.

## Status conventions

- **Planned:** agreed scope; implementation has not started.
- **In progress:** implementation, fixes, or required verification remain.
- **Done:** the stated scope is implemented and its relevant checks have passed. This does not imply deployment.
- **Blocked:** a concrete dependency prevents further progress; record the dependency.

Update this file alongside each feature, enhancement, bug fix, or configuration change that affects project progress. Keep the current status tables accurate and append a dated entry to the work log. Record actual checks and their outcomes; distinguish earlier verification from checks run for the current change. Keep credentials and private access links out of this file.

## Current focus

Authentication implementation is now present. Complete its external-service and browser acceptance, then build transactional wedding setup and membership/access control. The user explicitly moved development to authentication while landing-page follow-ups remain open.

Development is on `dev`. Identity was verified with disposable MongoDB transactions and a local production HTTP server; Atlas connectivity is now verified; migration completion requires database-scoped collMod permission. Real Resend inbox delivery is not configured or verified. Review fixes are implemented and validated for delivery on dev. Git delivery is recorded by commit history and the handoff; it is separate from implementation and deployment. No deployment has been performed.

## Feature progress

| ID | Area | Status | Delivered scope / remaining work |
| --- | --- | --- | --- |
| FND-001 | Repository foundation | Done | Next.js App Router, TypeScript, Node 24/npm, styles, lint/format/type scripts, environment example, ignore rules, and setup README. Clean installation, development/production startup, lint, formatting, types, and build were previously verified for the scaffold. |
| DOC-001 | Product and engineering contracts | Done | PRD, architecture, database design with embedded ERD, and API design are present. These define intended behavior; implementation status is recorded separately per feature. |
| TOOL-001 | Stitch design access | Done | Authenticated read access to the landing-page project, screen metadata, exported HTML, and screenshots was verified. Local MCP credential files are ignored by Git. Native tool availability depends on the running client/session. |
| WEB-001 | Application landing page | In progress | Desktop/mobile layouts, local imagery/fonts, fictional previews, section links, mobile drawer, FAQs, and real registration/login links are implemented. Copy is aligned with V1 scope. Lint, formatting, types, and the landing-page production build passed on 2026-11-23. `BUG-001` and complete browser interaction/responsive QA remain open. |
| AUTH-001 | Identity and authentication | In progress | Implemented registration, Argon2id, Auth.js credentials/JWT, verification/recovery, single-use expiring tokens, session invalidation, protected account entry, strict identity APIs, CSRF, database rate limits, and durable encrypted identity email/quota accounting. Isolated MongoDB and production HTTP checks pass. Configured Atlas/Resend and complete mobile/form browser acceptance remain under QA-003. |
| ACCESS-001 | Wedding setup and membership | Planned | Transactional wedding creation/joining, one owner, one active membership per account, roles, removal/rejoining, and server-side wedding isolation. |
| EVENT-001 | Wedding details and events | Planned | Member editing, event CRUD, chronological schedule, and deletion behavior. |
| PUBLIC-001 | Public wedding website | Planned | Restricted public wedding/event projections and configured YouTube livestream with fallback. Separate from the application landing page. |
| GUEST-001 | Guests, invitations, and RSVP | Planned | Individual guests, event selection, scoped invitation grants, independent responses, and email-correction/deletion invalidation. |
| EMAIL-001 | Invitations and manual reminders | Planned | Recipient preview, durable operations/jobs, shared quotas, simulated/test/live modes, bounded manual continuation, and safe retries/reconciliation. |
| EXPENSE-001 | Expense tracking | Planned | Paid/remaining integer-paise amounts, payer and payment dates, totals, soft deletion, and concurrent-edit conflicts. |
| PHOTO-001 | Private photo collection | Planned | Separate upload/view grants, QR links, private R2 storage, validated uploads, previews, individual original downloads, quota accounting, and cleanup. |
| DASH-001 | Management dashboard | Planned | Real summaries and navigation backed by wedding data. The landing-page dashboard is an illustration only. |
| DEPLOY-001 | Deployment and acceptance | Planned | Vercel configuration, environment setup, fictional demo data, and end-to-end verification against the documented acceptance criteria. No application deployment has been performed. |
| TRACK-001 | Progress tracking workflow | Done | This tracker, a README link, and root agent instructions establish the update workflow. Documentation links and whitespace checked when created; no application tests were needed for this documentation change. |

## Issues and follow-ups

| ID | Priority | Status | Problem / next action |
| --- | --- | --- | --- |
| BUG-001 | P2 | Open | At viewport widths 768–1023px, `.desktopNav` is hidden while `.mobileActions` remains hidden. Align the breakpoints in [landing.module.css](../src/components/landing/landing.module.css) so header section navigation or its menu is available throughout that range. Verify both boundary widths and a representative tablet width. |
| QA-001 | — | Pending | Complete landing-page interaction and narrow-screen browser checks. Earlier browser automation was interrupted/unreliable; do not treat the desktop screenshot or static checks as proof that all interactions passed. |
| QA-002 | — | Done | `npm run build` passed for the landing-page implementation on 2026-11-23, including compilation, TypeScript, and static page generation. Browser interaction/responsive checks remain separate under QA-001. |
| QA-003 | — | Pending | Complete identity acceptance against a development Atlas database and a controlled Resend inbox; check mobile layout, keyboard/forms/password toggles, and fragment-link consumption in the browser. Desktop login rendering/unconfigured state inspected. Browser connector throws a timeout-property error; native navigation actions did not reliably advance. HTTP cookie/redirect tests are separate and passed. |
| BUG-002 | P2 | Done | Missing account-service configuration disabled the entire authentication fieldset, blocking typing. Inputs and password visibility controls now stay editable; only submission is disabled when configuration is missing. Pending/completed requests still lock the fieldset. Verified enabled fieldsets and disabled submit buttons in served HTML for login, registration, recovery, resend, and reset pages; browser typing check remains under QA-003. |
| BUG-003 | P2 | Done | Auth.js sign-out was gated by database availability and the shared credential IP limiter. The limiter now applies only to credential callbacks; JWT sign-out/CSRF bootstrap remain available independently. Production HTTP regression checks passed with an exhausted login limiter and an actual temporary MongoDB outage, retaining cross-origin rejection and verifying expired session cookies. |
| BUG-004 | P2 | Done | Index-only readiness accepted an incomplete migration without validators. Shared migration/readiness definitions now require matching validators, strict/error enforcement, index keys, uniqueness, and TTL settings. Four isolated regression cases passed, including recovery after migration repair. |
| BUG-005 | P2 | Done | Added transactional carry-over holds in new daily/monthly windows for older unresolved dispatches and late acceptances. Verified daily/monthly rollover, unknown/in-flight outcomes, definite rejection, and concurrent claims against remaining capacity. Original-window settlement remains intact; no automatic retries were added. |
| SEC-001 | P1 | User action pending | Removed an inline database credential from the local environment example and notified the user to rotate it. The committed HEAD example did not contain that credential. No key/URI values are recorded here. |

Homepage account notices were replaced by registration/login routes during AUTH-001. Omitted Privacy/Terms links still await actual legal content. No deployment or commit/push should be inferred from an implementation status.

## Work log

Dates below use Asia/Kolkata. Earlier work is summarised from the recorded development history; future entries should describe the change made in that working session.

| Date | Type | Reference | Change and verification | Remaining work |
| --- | --- | --- | --- | --- |
| 2026-11-19 | Foundation | FND-001 | Created the root-level scaffold and tooling. Installation, clean lockfile install, lint, formatting, types, development/production HTTP responses, and production build passed for that scope. Existing project documents were preserved. | Build product features incrementally. |
| 2026-11-20 | Repository | FND-001 | Created `dev` and pushed initial commit `264d998` containing the scaffold and existing project documentation. Working tree was clean and synchronised at that point. | Subsequent landing-page changes are not included in that commit. |
| 2026-11-23 | Tooling | TOOL-001 | Configured local Stitch MCP access, verified authenticated project/screen reads, and retrieved desktop/mobile reference exports. Credential files are ignored; no key values are recorded here. | Client/session reload may be needed to expose native MCP tools. |
| 2026-11-23 | Feature | WEB-001 | Implemented the landing page using approved Stitch visuals and corrected V1 copy. Added local fonts/images, fictional previews, native FAQ disclosures, mobile navigation, and account notices. Inspected desktop rendering; lint and TypeScript passed. | Resolve BUG-001; complete browser QA and production-build verification. |
| 2026-11-23 | Review | BUG-001 | Review identified missing header navigation at 768–1023px. Finding is recorded; no fix has been applied. | Align navigation breakpoints and verify the fix. |
| 2026-11-23 | Documentation | TRACK-001 | Added this progress tracker, its README link, and `AGENTS.md` instructions requiring updates alongside future implementation and fixes. | Keep statuses, open issues, and verification evidence current. |
| 2026-11-23 | Validation | WEB-001 / QA-002 | Before committing the landing page and tracking workflow, `npm run check` (lint, formatting, and types) and `npm run build` passed. Confirmed local environment/MCP credential files and generated output are ignored by Git. | BUG-001 and QA-001 remain open; no deployment performed. |
| 2026-11-23 | Feature | AUTH-001 | Added credentials/JWT identity, explicit registration/verification/recovery endpoints and pages, protected account entry, current-user DTO, lazy service configuration, server-only modules, and database-backed attempt limits. Replaced homepage account notices with real links. Kept wedding creation/membership and dashboard implementation outside this scope. | Configure separate development Atlas and controlled Resend test delivery; complete QA-003. |
| 2026-11-23 | Persistence / email | AUTH-001 | Added explicit additive identity/index/validator migration, encrypted single-recipient jobs, simulated/test/live modes, shared transactional email reservations/settlements, conservative unknown-outcome holds, and bounded interrupted/stale job reconciliation. No queues or automatic send retries. | General invitation/reminder continuation and operator outcome-resolution tools remain EMAIL-001 work. |
| 2026-11-23 | Security | SEC-001 | Replaced an inline credential in the working environment example with a blank setting. Verified without printing values that the committed HEAD example had no inline MongoDB credential. | User must rotate the exposed database password. |
| 2026-11-23 | Validation | AUTH-001 / QA-003 | Lint, formatting, TypeScript and production build passed. Fifteen isolated MongoDB integration/security tests and one production HTTP journey passed, including real Auth.js cookies, wrong passwords, verification, reset revocation and logout; migration CLI also passed in the HTTP fixture. Desktop login inspected. Initial sandbox socket/build restrictions were resolved with approved execution. | Atlas/Resend and mobile/form browser acceptance remain under QA-003. No real provider email was sent. |
| 2026-11-24 | Bug fix | BUG-002 / AUTH-001 | Decoupled editable authentication fields from service readiness, clarified the unavailable-submission notice, and preserved disabled-button styling. Lint, formatting, TypeScript and production build passed. Running-server HTTP checks verified all five input-bearing auth pages return 200 with enabled fieldsets and unavailable submit actions disabled. No new tests added for this small UI fix. | Browser typing interaction could not be completed because the active tab changed; full browser acceptance remains QA-003. External-service configuration is still required for submission. |
| 2026-11-24 | Local configuration | AUTH-001 / QA-003 | Preserved existing local database settings; generated missing independent authentication/encryption keys directly into ignored .env.local without displaying them; applied owner-only file permissions and verified Git exclusion. Atlas ping and read/write/index privileges succeeded. Login page returned HTTP 200 with an enabled submit button after configuration reload. The additive migration failed; the configured database user lacks collMod permission needed for validators. | User must grant dbAdmin on only the configured application database, then rerun migration. Resend API key, controlled recipient and verified quota window are missing; email remains simulated. No real email sent. |
| 2026-11-24 | Review fixes | BUG-003 / BUG-004 / BUG-005 | Implemented the three reviewed fixes: database-independent JWT logout, readiness verification using shared validators/index definitions, and conservative quota rollover holds with supporting indexes. The final expanded suite passed 25 MongoDB/security tests and three production HTTP journeys; lint, formatting, TypeScript and production build passed. Verified local secret files are ignored, scanned candidate committed files without exposing values, and checked documentation links/whitespace. | Commit and push authorised on dev; delivery is reported separately. Configured Atlas migration, Resend inbox delivery, and remaining browser acceptance are separate pending work. |

## Updating this tracker

For each completed unit of work:

1. Update its feature row, or add a stable ID for a newly agreed area. A small fix can reference an existing feature and issue rather than creating another feature row.
2. Add or update open issues and follow-ups. Close an issue only after its fix is implemented and checked.
3. Append a work-log row with the local date, type, reference, actual change, validation outcome, and anything left unfinished.
4. Update “Last updated” and “Current focus” when they change.

Keep the history. Correct inaccurate entries explicitly instead of silently rewriting earlier outcomes. Do not mark placeholders, mocked data, configured credentials, or planned APIs as working product features.
