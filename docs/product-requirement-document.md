# Make My Marriage — Product Requirements Document

**Version:** 1.0  
**Date:** 29 October 2026  
**Purpose:** Portfolio project and software development practice  
**Status:** Initial PRD based on confirmed product scope

## 1. Product overview

Make My Marriage is a web application that helps a couple, their family, and trusted friends manage one wedding together. It combines wedding events, individual guest invitations and RSVPs, basic expenses, a simple wedding website, guest photo collection, and access to a YouTube livestream.

V1 prioritises straightforward workflows. It is not a commercial service, professional planning platform, or vendor marketplace. It does not include task-level coordination: collaboration happens through shared wedding information and event management.

### Goals

- Give the couple and their family one shared place to maintain wedding information.
- Manage multiple events within a wedding.
- Invite selected individuals to selected events and collect an RSVP for each invitation.
- Track money paid, the payer, and amounts still due.
- Let guests access invitations, photos, and the livestream without accounts.
- Provide a realistic portfolio project with authentication, roles, shared data, email, uploads, and external media integration.

### Product boundaries

- Each account belongs to at most one wedding in V1.
- Each wedding has exactly one owner and can have multiple managers.
- Bride and groom are application roles with member-management permissions.
- Guests and wedding management members are separate concepts. Receiving a guest invitation does not create an account or management access.
- Email is the only guest invitation and reminder channel in V1.
- Expenses are visible to all authenticated members of that wedding, including managers, but never to guests or public website visitors.

## 2. Users and permissions

Ownership is an administrative attribute separate from the bride, groom, and manager roles. The creator becomes the owner and can set up the couple's roles. An owner does not need to be the bride or groom.

| Capability | Owner | Bride / groom | Manager | Guest / visitor |
| --- | --- | --- | --- | --- |
| View public wedding website and event schedule | Yes | Yes | Yes | Yes |
| Manage wedding details and events | Yes | Yes | Yes | No |
| Manage guests and event invitations | Yes | Yes | Yes | No |
| Send invitation and reminder emails | Yes | Yes | Yes | No |
| View and edit expenses | Yes | Yes | Yes | No |
| Configure gallery links and livestream | Yes | Yes | Yes | No |
| Invite members and assign roles | Yes | Yes | No | No |
| Respond to an RSVP | Via guest invitation link | Via guest invitation link | Via guest invitation link | Via guest invitation link |
| Upload or view guest photos | Via dashboard or relevant gallery link | Via dashboard or relevant gallery link | Via dashboard or relevant gallery link | Via relevant gallery link |

**Simple implementation defaults:** There is at most one bride role holder and one groom role holder per wedding; either role may initially be unassigned. Membership invitations are tied to the invited email. The owner cannot be removed or changed through V1 member management. Ownership transfer, account migration between weddings, and custom permission roles are outside V1.

Authenticated members can open gallery management from the dashboard. Guests use separate upload and viewing links. Public visitors cannot edit wedding information merely by obtaining a website URL.

## 3. Product surfaces and navigation

### Management portal — authentication required

1. Email login / sign-up.
2. Create wedding or accept a member invitation.
3. Overview dashboard.
4. Wedding details and website preview.
5. Events.
6. Guests, invitations, and RSVPs.
7. Expenses.
8. Members and roles.
9. Photo gallery management and QR codes.
10. Livestream settings.

### Guest experience — no account required

1. Public wedding homepage and full event schedule.
2. Personal event invitation and RSVP page, opened from an email link.
3. Photo upload page, opened from the private upload link or QR code.
4. Gallery page, opened from the private viewing link or QR code.
5. YouTube livestream section on the wedding website.

**Visibility distinction:** Event-specific invitations control who can RSVP to each event. They do not hide events from the public schedule in V1. This preserves the previously agreed simple website showing all events. Gallery access links, guest contact details, RSVP tokens, and expenses must not be exposed on the public website.

## 4. Functional requirements

### FR-01 — Authentication and wedding access

- Members sign up and log in using an email-based authentication flow. The authentication provider and exact verification mechanism are implementation choices.
- A new account can create a wedding or accept a valid member invitation, provided it does not already belong to a wedding.
- Accepting an invitation requires authentication with the invited email address.
- Merely logging in does not grant access to another wedding.
- Guests do not authenticate to RSVP, upload photos, or view photos through valid access links.
- Every management operation checks wedding membership and relevant permissions on the server.

### FR-02 — Wedding setup

- The creator becomes the owner of the wedding.
- Store the couple's names, wedding date, wedding location, and an optional introduction.
- Provide a unique public website address for the wedding.
- Members can edit wedding details and preview the resulting guest website.
- Wedding and event edits appear on the website without requiring duplicate data entry.
- Use Asia/Kolkata as the initial wedding timezone and INR for expenses. These are V1 defaults rather than a multi-region configuration feature.

### FR-03 — Events

- Members can create, view, edit, and delete events within their wedding.
- Event fields: name, date, start time, location, and optional description and end time.
- Display the schedule in chronological order.
- Permit different dates and venues for different functions.
- Deleting an event requires a confirmation because it also removes its event invitation and RSVP records from active views.
- An old invitation link for a deleted event must show an unavailable state and must not accept an RSVP.
- Editing an event updates the website and invitation page. It does not automatically send an email; a member can send an updated reminder manually.
- No tasks, subtasks, task owners, dependencies, rehearsals, or detailed operational timelines.

### FR-04 — Dashboard overview

Show a concise summary with links to the underlying records:

- Couple's names, wedding date, and upcoming events.
- Total individual guests and a selected event's invited / attending / declined / pending counts.
- Total amount paid and total remaining across expenses.
- Upcoming outstanding payment due dates.
- Shortcuts to add an event, add a guest, record an expense, and send reminders.

Guest counts must distinguish unique people from event invitations. One person invited to three events is one guest and three event invitations.

### FR-05 — Members and roles

- The owner, bride, and groom can invite a person by email and assign a supported role.
- They can change non-owner members' roles within the supported role limits.
- Managers can collaborate on wedding content but cannot invite members or assign roles.
- Show accepted memberships and pending invitations separately.
- Support copying a member invitation link and sharing it through a WhatsApp button.
- WhatsApp sharing opens a prepared message for the member to send. It is not automated messaging.
- A shared member invitation link remains tied to its intended email address; forwarding it does not grant another account access.

### FR-06 — Individual guests and event selection

- Members can add, view, edit, and remove an individual guest.
- Guest fields: name, email, and optional phone number.
- Email is required before an email invitation can be sent.
- Members choose which events each guest is invited to. A guest can be invited to one, several, or all events.
- Show guests and their invitation / RSVP status for a selected event.
- Prevent duplicate invitations for the same guest-event pair. Treat the same email within a wedding as one guest in V1.
- Removing a guest withdraws their invitations and invalidates their RSVP links.
- Do not model households, plus-ones, extra attendee names, seating, dietary requirements, room allocation, or transport in V1.

### FR-07 — Event invitation emails and RSVP

- Members can send invitations to selected guests for a selected event.
- Each guest-event invitation has a unique, unguessable private RSVP link.
- An email includes the couple's names, event name, date, time, location, and RSVP link.
- The private invitation page displays the relevant guest and event and allows **Attending** or **Not attending**.
- The initial RSVP state is **Pending**. Email sending alone does not change it.
- A guest can revisit the same valid link and update their response.
- Responding to one event does not change that guest's RSVP for another event.
- RSVP submissions update the dashboard and event counts.
- Re-sending an invitation must not create a second guest-event record or reset an existing RSVP.
- An RSVP link grants access to that invitation only; it does not expose the guest list, expenses, or management controls.

### FR-08 — Manual email reminders

- Provide a **Send reminder** action for an event.
- Members can select all its invitees or filter/select recipients by RSVP status.
- Responded and non-responded guests are both eligible. Declined guests are not automatically excluded when the member chooses all invitees.
- Show recipient count and a send confirmation before emailing.
- Include current event details and the guest's existing RSVP link so they can review or update their response.
- Record the last successful invitation send and reminder send time per invitation.
- Do not reset RSVP status when sending a reminder.
- If some emails fail, show which failed and allow retrying them without re-sending to successful recipients.
- Reminder sending is manual. There is no automatic scheduling, SMS, automated WhatsApp messaging, or guest WhatsApp sharing workflow in V1.

### FR-09 — Expense tracker

- All authenticated wedding members can create, view, edit, and delete expenses.
- Fields: title, optional description / vendor name, amount paid so far, payer name, payment date, remaining amount, and optional remaining-payment due date.
- The payer is a text field and does not need an application account.
- Support one primary payer per expense record in V1.
- Calculate recorded total cost as **amount paid + remaining amount**.
- Display sums for paid, remaining, and recorded total cost across the wedding.
- Reject negative amounts and store money with exact currency precision.
- When another payment is made, increase the cumulative paid amount and reduce the remaining amount on the existing record. Do not count the same obligation again as a second expense.
- An expense with no outstanding balance has a remaining amount of zero.
- Show due dates where entered. No payment processing, automatic payment reminders, instalment ledger, contributions, splitting, reimbursements, or estimated-budget planning.
- Expense data is excluded from all unauthenticated pages and guest APIs.

### FR-10 — Basic wedding website

- Provide one simple, responsive website per wedding using a fixed layout.
- Include the couple's names, introduction if supplied, wedding date, location, full event schedule, and livestream when configured.
- Use the existing wedding and event records as its source of information.
- Personal RSVP access comes from invitation emails, rather than a public guest directory or email lookup.
- Do not publish gallery access links on the public site. Members distribute those private links separately.
- No advanced page builder, theme marketplace, custom domain, guest accounts, or complex design editor.

### FR-11 — Private photo uploads and gallery

- Generate separate wedding-level upload and viewing access links, each with its own QR code.
- The upload QR opens the upload page; the viewing QR opens the gallery.
- Anyone holding the upload link can select and upload photos without creating an account.
- Anyone holding the viewing link can browse the gallery without creating an account.
- An upload link does not grant gallery viewing access on its own.
- Successful uploads appear in the gallery automatically. There is no approval queue in V1.
- Members can view the gallery and remove inappropriate or accidental uploads through the dashboard.
- Provide upload progress, successful-upload feedback, and useful error messages for rejected or failed files.
- Validate image type and size on the server, with configurable upload limits. Video uploads are outside V1.
- Keep stored photos accessible through authorised gallery access rather than a public storage listing.
- “Private” means link-based access in V1: link holders can forward access. There is no individual viewer verification, face recognition, photo matching, or professional photographer delivery workflow.

### FR-12 — YouTube livestream

- Members can add, replace, or remove one wedding-level YouTube livestream URL.
- Display an embedded YouTube player where supported, plus an **Open on YouTube** link.
- When no stream is configured, hide the livestream section.
- If playback is unavailable, retain a clear link to YouTube.
- Organisers create and operate the stream on YouTube. This application does not capture, broadcast, record, or transcode video.

## 5. Key user journeys

### A. Create the wedding and invite collaborators

Owner logs in → creates the wedding → enters basic details → invites the bride, groom, and managers → invited people authenticate using the invited email → accept membership → access the same wedding dashboard.

### B. Invite a guest to selected functions

Member creates Haldi, Sangeet, and Reception events → adds a guest → selects Sangeet and Reception → sends their event invitations → guest responds using each event's link → each event's RSVP counts update independently.

The guest can still read the full public schedule, but cannot use another guest's invitation or RSVP to an uninvited event without a valid invitation link.

### C. Send a reminder before an event

Member selects Reception → chooses all invitees or a status-based selection → reviews the recipient count → confirms send → recipients receive current details and their original RSVP links → existing responses remain unchanged unless guests update them.

### D. Record an expense and settle its balance

Member records ₹20,000 paid by a named person and ₹5,000 remaining → totals show ₹25,000 recorded cost → member later edits the same expense to ₹25,000 paid and ₹0 remaining → total cost stays ₹25,000.

### E. Collect guest photos

Member shares the upload QR → visitor scans it and uploads photos without login → photos appear in the gallery → family shares the separate viewing link or QR → viewers browse without accounts.

## 6. Conceptual data model

These are product-level records, not a mandated database schema.

| Record | Core information / relationship |
| --- | --- |
| Account | Verified email and display name |
| Wedding | Couple, date, location, introduction, website identifier, owner |
| Membership | Account, wedding, bride / groom / manager role; one wedding per account |
| Member invitation | Wedding, intended email, role, access token, acceptance state |
| Event | Wedding, name, date/time, location, description |
| Guest | Wedding, name, email, optional phone |
| Event invitation | Guest + event, unique RSVP token, response, response timestamp, invitation/reminder send timestamps |
| Email attempt | Invitation, invitation/reminder type, attempted time, send result |
| Expense | Wedding, title, notes/vendor, paid amount, payer, date, remaining amount, due date |
| Gallery access | Wedding, separate upload and viewing tokens |
| Photo | Wedding, private storage reference, upload time, file metadata |
| Livestream setting | Wedding and optional YouTube URL; may be stored on Wedding |

**Important rules:** Each guest-event pair is unique. A guest and event in an invitation must belong to the same wedding. Every management record is scoped to its wedding. A public website identifier is not a management credential or photo-access credential.

## 7. Quality and implementation requirements

- **Responsive use:** Core member and guest workflows work on phone and desktop browsers.
- **Access enforcement:** Protect data on the server, including direct URL and API access. Hiding navigation alone is insufficient.
- **Account-free links:** Use unguessable tokens, transmit links securely, and handle invalid or withdrawn invitations clearly.
- **Shared updates:** Persist changes centrally so another member sees them on the next fetch or refresh. Live collaborative editing is not required.
- **Form behaviour:** Validate required fields and show loading, empty, success, and failure states. Confirm destructive actions.
- **Email feedback:** Separate RSVP status from email send status. A provider accepting an email does not prove it was read or received in the inbox; read tracking is not required.
- **Uploads:** Show progress and limits; allow retry after a failed upload without requiring an account.
- **Accessibility:** Use labelled fields, keyboard-accessible controls, clear validation, and readable contrast.
- **External failures:** Email, storage, and YouTube failures should produce useful feedback without breaking unrelated features.
- **Demonstration:** Use fictional wedding and guest data for a public portfolio demo. Document environment configuration without committing credentials.
- **Technology:** Framework, database, authentication, email provider, storage, and deployment service are implementation decisions. No stack is mandated by this PRD.

## 8. Acceptance criteria

V1 is complete when the following end-to-end behaviours work:

| ID | Acceptance scenario |
| --- | --- |
| AC-01 | Creating a wedding assigns one owner. An account already attached to a wedding cannot create or join a second wedding. |
| AC-02 | An invited account can join using the intended email. An unrelated authenticated account cannot access that wedding's management data. |
| AC-03 | Owner, bride, and groom can invite and assign members. A manager cannot perform those actions through either the UI or API. |
| AC-04 | Members can maintain multiple events; their public schedule displays the saved details chronologically. |
| AC-05 | A guest invited to two of three events receives invitations only for those two. Duplicate sending does not create duplicate invitation records. |
| AC-06 | A guest responds without an account. Updating the RSVP for one event leaves the other event's response unchanged. |
| AC-07 | Dashboard counts correctly distinguish unique guests from invitations and reflect attending, declined, and pending responses for each event. |
| AC-08 | Reminders can be sent to all event invitees, including responded guests, or to a selected status group. Sending does not change RSVPs. |
| AC-09 | Failed email sends are visible and can be retried without duplicating successful sends from that batch. |
| AC-10 | Recording ₹20,000 paid and ₹5,000 remaining shows ₹25,000 total. Settling the same expense preserves that total. |
| AC-11 | All wedding members can view expenses. Public visitors and RSVP-link holders cannot retrieve expenses through pages or APIs. |
| AC-12 | Public visitors can view the full event schedule but cannot retrieve the guest list, contact information, RSVP tokens, or gallery access links. |
| AC-13 | A phone scanning the upload QR can upload a valid photo without login. A viewer using the viewing QR can see the uploaded photo. |
| AC-14 | Upload-only access does not expose the gallery. Missing or invalid gallery credentials do not grant image access. |
| AC-15 | A configured YouTube stream displays with an external link; removing it hides the section. |
| AC-16 | Deleting an event or guest invalidates the affected RSVP links. Relevant destructive actions require confirmation. |
| AC-17 | Core login, event, RSVP, reminder, expense, and photo workflows are usable on mobile and desktop. |

## 9. Suggested implementation sequence

These stages organise development; they do not expand the V1 scope or impose a delivery timeline.

1. **Foundation:** Authentication, wedding creation, single-wedding membership, roles, and access checks.
2. **Wedding experience:** Event management, public website, and initial dashboard.
3. **Guests:** Individual guests, event selection, email invitations, private RSVPs, and manual reminders.
4. **Expenses:** Basic entries, totals, remaining amounts, and due dates.
5. **Media:** Private photo upload/view links, QR codes, gallery management, and YouTube embedding.
6. **Completion:** Dashboard integration, essential failure states, acceptance verification, and a fictional portfolio demonstration.

## 10. Explicitly outside V1

- Commercial pricing, subscriptions, payments, or business analytics.
- Professional organiser portfolios and accounts managing multiple weddings.
- Task management, assignments, dependencies, and detailed wedding-day operations.
- Vendor discovery, marketplace listings, contracts, and vendor-management workflows.
- Household guests, plus-one tracking, seating, accommodation, travel, and transport.
- Automated or scheduled reminders, SMS, and automated WhatsApp guest messages.
- Hiding individual events from the public schedule or defining custom permission roles.
- Estimated-budget planning, contribution accounting, reimbursement, and payment processing.
- Complex website builders, custom domains, native mobile apps, and live collaborative editing.
- Photo approval queues, video uploads, facial recognition, and photo matching.
- Hosting or operating livestream infrastructure.

## 11. Defaults and scope traceability

The following distinctions resolve the final clarifications and prevent later scope confusion:

| Topic | V1 decision |
| --- | --- |
| One organiser versus multiple managers | Exactly one owner; multiple collaborating members. Owner and couple can invite and assign roles. |
| “Public” expenses | Shared with authenticated wedding members only; excluded from all guest-facing access. |
| Individual invitations | Select guests per event; each guest-event invitation has its own RSVP. |
| Event visibility | Public schedule shows all events; invitation selection limits RSVP eligibility, not schedule visibility. |
| Reminder eligibility | Both responded and non-responded invitees can receive manually sent reminders. |
| Guest accounts | None required; invitation and gallery capabilities come from their respective links. |
| Private gallery | Separate unguessable upload/view links, also represented as QR codes; no verified identity for visitors. |
| Expenses | Cumulative amount paid plus remaining amount; one primary payer per record. |
| Livestream | One configured wedding-level YouTube link; broadcasting occurs on YouTube. |

Role-holder limits, exact authentication mechanism, unique guest email handling, fixed website layout, wedding-level gallery links, and one active livestream are simple implementation defaults documented in this PRD. They can be revised before implementation without requiring additional V1 modules.
