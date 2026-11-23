# Make My Marriage — Development Progress

Last updated: 2026-11-23 (Asia/Kolkata)

This is the working record of implemented features, bug fixes, verification, and remaining work. It records delivery status; the [PRD](product-requirement-document.md), [architecture](engineering-architecture-document.md), [database design](make-my-marriage-database-design-document.md), and [API design](API-design-document.md) remain the implementation contracts.

## Status conventions

- **Planned:** agreed scope; implementation has not started.
- **In progress:** implementation, fixes, or required verification remain.
- **Done:** the stated scope is implemented and its relevant checks have passed. This does not imply deployment.
- **Blocked:** a concrete dependency prevents further progress; record the dependency.

Update this file alongside each feature, enhancement, bug fix, or configuration change that affects project progress. Keep the current status tables accurate and append a dated entry to the work log. Record actual checks and their outcomes; distinguish earlier verification from checks run for the current change. Keep credentials and private access links out of this file.

## Current focus

Finish the landing page before starting authentication:

1. Fix the tablet header navigation issue, `BUG-001`.
2. Verify mobile-menu opening/dismissal, account notices, FAQ keyboard behavior, and responsive layouts. Desktop rendering has been inspected; complete interaction and narrow-screen checks remain.

Development is on `dev`. The landing-page previews do not represent working management features. Lint, formatting, type checking, and the production build passed for the current landing-page implementation on 2026-11-23.

## Feature progress

| ID | Area | Status | Delivered scope / remaining work |
| --- | --- | --- | --- |
| FND-001 | Repository foundation | Done | Next.js App Router, TypeScript, Node 24/npm, styles, lint/format/type scripts, environment example, ignore rules, and setup README. Clean installation, development/production startup, lint, formatting, types, and build were previously verified for the scaffold. |
| DOC-001 | Product and engineering contracts | Done | PRD, architecture, database design with embedded ERD, and API design are present. These define intended behavior; database schemas and endpoints are not implemented. |
| TOOL-001 | Stitch design access | Done | Authenticated read access to the landing-page project, screen metadata, exported HTML, and screenshots was verified. Local MCP credential files are ignored by Git. Native tool availability depends on the running client/session. |
| WEB-001 | Application landing page | In progress | Desktop/mobile layouts, local imagery/fonts, fictional previews, section links, mobile drawer, FAQs, and temporary account messages are implemented. Copy is aligned with V1 scope. Lint, formatting, types, and the landing-page production build passed on 2026-11-23. `BUG-001` and complete browser interaction/responsive QA remain open. |
| AUTH-001 | Identity and authentication | Planned | Registration, Argon2id passwords, Auth.js credentials/JWT sessions, verification, recovery, session invalidation, and minimal identity-email/quota support. |
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

Account creation/sign-in messages and omitted Privacy/Terms links are intentional for this iteration. They are not completed authentication or legal-content features. No deployment or commit/push should be inferred from an implementation status.

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

## Updating this tracker

For each completed unit of work:

1. Update its feature row, or add a stable ID for a newly agreed area. A small fix can reference an existing feature and issue rather than creating another feature row.
2. Add or update open issues and follow-ups. Close an issue only after its fix is implemented and checked.
3. Append a work-log row with the local date, type, reference, actual change, validation outcome, and anything left unfinished.
4. Update “Last updated” and “Current focus” when they change.

Keep the history. Correct inaccurate entries explicitly instead of silently rewriting earlier outcomes. Do not mark placeholders, mocked data, configured credentials, or planned APIs as working product features.
