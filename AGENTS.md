# Make My Marriage — Agent Instructions

## Project context

Work in the existing Next.js/TypeScript repository root. Preserve existing work and project documentation. The architecture is a modular monolith using the Node.js runtime; deployment targets Vercel.

Use the actual implementation contracts:

- [Product requirements](docs/product-requirement-document.md)
- [Engineering architecture](docs/engineering-architecture-document.md)
- [Database design and ERD](docs/make-my-marriage-database-design-document.md)
- [API design](docs/API-design-document.md)

Follow each document's stated authority and explicit refinements: application APIs use `/api/v1`, Auth.js uses `/api/auth`, and accounts have at most one active wedding membership. Surface unresolved contradictions instead of silently changing scope. UI previews and placeholders do not establish implemented business functionality.

For Next.js changes, consult the relevant version-matched documentation in `node_modules/next/dist/docs/` when needed. Use npm and the project's Node 24 configuration.

## Required progress updates

The application progress record is [docs/development-progress.md](docs/development-progress.md).

- Read the tracker before starting implementation to understand current work, open issues, and pending verification.
- After every feature, enhancement, bug fix (including small fixes), or configuration change that affects project progress, update the tracker in the same change set before reporting the work finished. Routine tracker maintenance within an authorised implementation task does not need separate approval.
- Update the relevant feature status, open issues, and current focus as appropriate. Append a dated work-log entry describing the actual change, checks run and their outcomes, and unfinished work. Use Asia/Kolkata dates.
- Only mark a scoped item Done when its implementation and relevant verification are complete. Distinguish implementation, validation, commit/push, and deployment; none implies the others.
- Keep previous history. Do not claim a check passed unless it actually ran and passed for that scope. Record checks that were not run, failed, or were blocked. Do not close an issue until the fix is implemented and verified.
- Keep credentials, raw tokens, private access links, and personal data out of the tracker and committed files.
- For read-only discussions or reviews, do not edit files unless the user asks to record the outcome. Report findings and recommended tracker updates instead.

## Validation and handoff

For application changes, run checks appropriate to the change using the scripts in `package.json`; normally lint, formatting checks, type checking, and a production build. Verify affected browser interactions and responsive behavior where browser access permits, and state any verification limits. Documentation-only changes need link/format checks rather than unrelated application tests.

Include the tracker update when summarising implementation work. Leave unrelated changes intact, and commit, push, or deploy only when authorised by the user.
