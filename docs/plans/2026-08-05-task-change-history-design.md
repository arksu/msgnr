# Task Change History Design

## Goal

Replace the task description-history modal with a complete, append-only task
change history at the bottom of the task page. History begins when this feature
ships; legacy changes do not need to be imported.

## Stored history

Add a first-class `task_change_history` table. Each entry stores the task ID,
actor ID, timestamp, change kind, a stable field key, a snapshot of the field
name and type, and typed before/after JSON values. This preserves historical
meaning when custom fields are renamed or deleted.

Creating a task writes one `Task created` entry in the same transaction as the
task and its initial values. Every later real change to title, status,
description, or a custom field appends one entry per changed field. No-op
updates append nothing. A batch update can therefore create several adjacent
entries.

Description entries store the Markdown before and after values. The existing
collaborative editor stays unchanged: its durable save/checkpoint requests,
rather than individual CRDT operations, define a history revision.

Each update path locks and reads the current task state, writes the domain
change and matching history entry or entries in one transaction, then commits.
This prevents concurrent edits from recording an incorrect predecessor.

## API

Replace the description-history endpoint with:

`GET /api/tasks/:id/history?cursor=<opaque>&limit=50`

Results are newest first and use stable cursor pagination. Responses include
the current public actor profile data (ID, nickname, avatar, and active custom
status) for the existing user presentation. Value JSON is decoded server-side
into display-safe typed values, retaining the field-name/type snapshots from
the historical record.

The old description history route, client API/store wrapper, modal UI state,
retention configuration, and snapshot/pruning code are removed from active
use. The legacy database table may remain dormant after upgrades, but its
contents are not returned or displayed.

## Task page

Place a final Change history section directly after Comments, moving the small
Created/Updated metadata block above Comments. It uses a table with Initiator,
Field, Value, and Date columns.

Initiators use the existing avatar, nickname, and custom-status UI. Regular
values render as type-aware `before -> after` text, including statuses, enum
values, users, multi-value fields, dates, and cleared values. The creation
entry renders `Task | Created`.

Description rows provide a `View diff` control that expands an inline detail
panel below the table row; no history modal remains. The panel supports
Unified and Inline Markdown-diff modes. A diff of more than 30 rendered rows
is collapsed initially and provides Expand and Collapse controls.

The section renders without making a request. An `IntersectionObserver`, rooted
at the task page scroller, loads the first page only when the section becomes
visible. A bottom sentinel loads later 50-entry pages while scrolling. Task
changes reset the entries and observer state. Loading, empty, retry, and end
states are explicit.

## Verification

Backend integration tests cover creation; every field type; title, status, and
description changes; no-ops; historical labels; actor output; ordering; and
cursor pagination. Frontend tests cover deferred visibility loading, automatic
paging, reset on task changes, user rendering, description diff modes,
long-diff collapsing, and absence of the old modal. Run targeted Go and Vitest
tests, frontend type checks, and the frontend build.
