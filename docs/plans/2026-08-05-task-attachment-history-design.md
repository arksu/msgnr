# Task Attachment History Design

## Goal

Extend the new task change history with immutable attachment-audit entries.
Only files added to or removed from an existing task are audited. Uploading
several files in one picker action creates one event containing all successful
files. Attachments staged before task creation are instead captured in the
initial `Task created` entry.

## History representation

Reuse `task_change_history` so attachment events participate in the same
ordering, actor rendering, deferred loading, and cursor pagination as every
other task change. An added-files event has `field_key = attachments`,
`field_name = Attachments`, and an immutable JSON array of file ID, display
name, size, and MIME type. A removal event stores the same snapshot for the
deleted file. The event type distinguishes `Added` from `Removed`; no history
is recorded for previews, downloads, or other reads.

The task-created history value becomes a small object rather than a bare
boolean. It includes the immutable metadata for any staged attachments that
were successfully attached while creating the task. A task created with no
attachments continues to render simply as `Created`.

## Upload and delete flow

Add a batched task-attachment upload endpoint. It accepts multiple multipart
`files` parts and preserves the current per-file outcome behavior: valid files
are attached while invalid or failed files are reported individually. The
successful attachment rows and exactly one grouped `Attachments added` history
entry are committed together. The client switches one file-picker action from
parallel individual requests to this endpoint, then retains its existing
success/error feedback and attachment refresh behavior.

Attachment removal receives the authenticated actor ID, reads the attachment
metadata, removes the database row, and appends a single `Attachments removed`
entry in the same transaction before best-effort object-store cleanup. This
ensures an attachment cannot disappear without the matching audit event.

## Task-page rendering

Attachment history uses a compact card in the history table's Value column:
an `Attachments` label, one file row per captured file (name and size), and a
semantic `Added` or `Removed` badge, matching the supplied visual direction.
The field remains `Attachments`; creation entries display the card below
`Created`. File metadata is historical and deliberately does not become a
download link, because a removed file may no longer exist.

## Failure handling and verification

Server-side file-size enforcement remains per file. Failed batch members do
not generate an audit event; the event contains only rows that were actually
created. If the database transaction fails after object uploads, uploaded
objects are cleaned up best-effort. The existing first-page and infinite-scroll
history API require no pagination changes.

Tests cover a grouped multi-file add event, a removal event with its actor and
immutable metadata, staged creation attachments in `Task created`, failure
isolation, and the history card's added/removed/creation rendering. Existing
attachment upload/delete tests are updated for the actor-aware deletion API.
