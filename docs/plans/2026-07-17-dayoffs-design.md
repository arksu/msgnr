# Dayoffs calendar design and implementation plan

## Outcome

Dayoffs is a first-class Msgnr mode.  A calendar button in the persistent left
rail opens a shared monthly leave timeline.  Everyone can browse the team's
leave; regular members can manage only their own records, while administrators
and owners can manage every record.

The `dayoffs/` directory is a visual and interaction reference only.  Its
proposed technology, API, schema, budgets, approval process, and retention
policy are intentionally not adopted.

## Product scope

### Included

- A top-level **Dayoffs** rail button and authenticated `/dayoffs` route.
- A dark, Msgnr-themed monthly timeline: employees are rows and days are
  columns.  Leave ranges use distinct, labelled colours.
- An employee panel with **All employees** as the default and an individual
  employee focus mode.
- Vacation, Sick Leave, and Personal Day records with an inclusive start date,
  inclusive end date, and optional note.
- A create/edit form and a delete confirmation.
- All authenticated users may read all active users' records.
- A member can create, update, and delete only their own records.  An admin or
  owner can perform those actions for any employee.
- Server-side date validation and same-person overlap prevention.

### Explicitly deferred

- Leave allowances, approval flows, public holidays, notifications, exports,
  audit/soft-delete policy, admin reporting, and realtime calendar updates.
- Any special role beyond the existing member/admin/owner roles.

## Interaction design

The left rail gains a calendar icon between the existing workspace modes.  It
uses the same active treatment, tooltip, keyboard semantics, and route-driven
state as Chat, Task tracker, and Documents.

The Dayoffs page opens on the current month in **All employees** mode.  Its
secondary panel provides the employee selector; the main panel contains month
navigation and a horizontally scrollable employee-by-day grid.  Selecting an
employee filters the grid to that person and reveals their record list.

Saturday and Sunday are the fixed weekend days for this release.  They are
rendered as inactive cells and leave bars do not occupy them.  A shared
frontend calendar constant is the only definition of this rule so its meaning
does not drift across the grid and any client-side date helpers.  No leave-day
counter is in scope.

Leave rows and calendar details make the type legible without relying only on
colour.  The form exposes employee selection only when the actor is an admin
or owner; for a member, the owner is implicitly the signed-in user.  Edit and
delete controls are visible only when the actor is the record owner or holds
an elevated role.  The backend makes the same authorization decision.

## Data and API boundary

Create one `dayoffs` table backed by the existing `users` table.  Store a UUID
id, `user_id`, a constrained leave type (`vacation`, `sick_leave`, or
`personal_day`), date-only start/end columns, an optional trimmed note, and
created/updated timestamps.  The first release deletes rows outright; a later
audit requirement can replace this with an explicit archival design.

Expose a small authenticated REST surface:

- `GET /api/dayoffs?year=YYYY&month=MM` returns all records intersecting the
  selected calendar month together with the active employee display data.
- `POST /api/dayoffs` creates a record.  Member requests have their user id
  derived from the authenticated principal; elevated users may provide a
  target user id.
- `PATCH /api/dayoffs/:id` updates a record under the same authorization rule.
- `DELETE /api/dayoffs/:id` removes a record under the same authorization
  rule.

The service validates non-empty dates, `end_date >= start_date`, an allowed
type, a bounded note, target-user activity, and no overlap for the same user.
It returns clear 400/403/404/409 errors.  No WebSocket or `workspace_events`
integration is required because this feature has no live-update requirement.

## Implementation plan

1. Add a dated migration for the dayoffs table, type and date constraints, and
   an index covering a user's date-range lookup.  Update `migrations/schema.sql`
   to keep fresh databases equivalent to migrated databases.
2. Add `internal/dayoffs` with service types, SQL operations, authorization,
   overlap validation, and HTTP handler.  Follow the existing domain-handler
   pattern, authenticate through `auth.Service`, and register the new handler
   from `cmd/server/main.go`.
3. Add server integration tests for month intersection, date/type validation,
   conflict rejection, member ownership checks, and admin/owner cross-user
   mutation.
4. Add a typed `web/src/services/http/dayoffsApi.ts` and a focused Pinia store
   under `web/src/stores/dayoffs.ts` for selected month/employee, loading,
   errors, and mutation refreshes.
5. Add `/dayoffs` to `web/src/router/index.ts`; extend `MainView.vue`'s
   route-derived application mode and left rail with the Dayoffs calendar
   button and lazy-loaded Dayoffs shell.  Add route/mode coverage to the
   existing MainView/router tests.
6. Build the Dayoffs shell from small Vue components: employee selector,
   month timeline, record list, and record dialog.  Use existing semantic theme
   tokens, accessible icon labels, Escape/backdrop dialog closing, clear empty
   and error states, and test IDs for interaction tests.
7. Put Saturday/Sunday in a single exported calendar constant and add unit
   tests for weekend rendering, month boundaries, and inclusive range layout.
   Add component tests for member versus admin controls and form feedback.
8. Run the targeted Go and Vitest suites, then the full frontend build.  Add a
   basic browser path when the project's E2E harness is available: navigate to
   Dayoffs, create a personal record, edit it, delete it, and confirm an admin
   can edit another person's record.

## Acceptance criteria

- The rail's Dayoffs button opens `/dayoffs`, survives reload, and visibly
  becomes active.
- The current-month team calendar can be browsed and narrowed to one employee.
- Vacation, Sick Leave, and Personal Day ranges are distinguishable and never
  draw across Saturday or Sunday cells.
- Members cannot alter another person's record through either the UI or a
  forged HTTP request.
- Admins and owners can alter any person's record.
- Invalid, reversed, and overlapping date ranges fail without changing the
  calendar.
