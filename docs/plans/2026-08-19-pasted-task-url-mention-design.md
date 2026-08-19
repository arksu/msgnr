# Pasted Task URL Mention Design

## Goal

When a user pastes the canonical URL copied from a task page into a regular
chat composer, replace it with the existing clickable task mention form:
`@<PUBLIC_ID> <task title>`.

## Scope

- Recognize only a standalone canonical task URL from the current workspace:
  `window.location.origin/tasks/<lowercase-public-id>`.
- Preserve surrounding whitespace, but do not convert URLs embedded in prose,
  URLs with query strings or fragments, external URLs, malformed URLs, or
  lookalike paths.
- Apply to new chat messages and message edits, which already enable message
  entities.
- Do not apply to encrypted chats, code/code-block content, or task comments.

## Chosen Approach

Reuse the existing task message-entity pipeline rather than adding a new link
format or a render-time substitution. A task entity already persists its task
UUID, label, canonical relative href, and offsets through the client, WebSocket
payload, server validation, history replay, and clickable message rendering.

The shared rich-text composer will own the paste behavior. It will use the
existing authenticated task-read API to resolve the pasted task precisely; it
will not use the five-result fuzzy tag search. The lowercase URL slug is
normalized back to a public ID before lookup.

No API, protocol, database, server, or message-rendering change is required.

## Paste and Resolution Flow

1. Keep the existing file-paste path first and unchanged.
2. For an eligible text paste, parse the URL and require the current origin,
   exact task path, and no query string or fragment.
3. Insert the clipboard text immediately so a slow lookup can never lose a
   paste or block further typing.
4. Track the URL portion using a temporary ProseMirror decoration keyed to the
   paste candidate. The decoration set maps through every subsequent editor
   transaction without becoming message content.
5. Resolve the task with `tasksGet(taskPublicIdFromSlug(slug))`.
6. If the mapped range still contains exactly the original URL, replace only
   that range with the existing atomic `messageEntity` node. Its attributes
   are:
   - `kind: 'task'`
   - the resolved task UUID as `targetId`
   - `@<PUBLIC_ID> <title>` as `label`
   - `/tasks/<lowercase-public-id>` as `href`
7. Remove the temporary decoration after replacement, lookup failure, a
   modified/deleted URL, or composer teardown. In every non-success case, the
   already-inserted URL remains ordinary text.

This transaction-aware tracking prevents a delayed response from replacing a
later edit or inserting a task chip at a stale cursor position. Multiple paste
candidates remain independent.

Task mention labels are snapshots. Renaming a task later does not rewrite
existing chat messages, matching current mention behavior.

## Error Handling

- An inaccessible, deleted, or unresolved task silently remains a normal URL.
- An API error does not show a toast and does not interrupt composing.
- A component unmount cancels or ignores pending resolutions.
- A user edit inside the decorated URL cancels conversion for that candidate.
- Existing file uploads, native non-task pastes, and ordinary link rendering
  remain unchanged.

## Verification

- Unit-test canonical current-origin URL recognition and public-ID
  normalization.
- Component-test a successful paste: raw text appears immediately, then becomes
  one task entity with the resolved UUID, `@ID title` label, canonical relative
  href, and correct serialized message payload.
- Test a delayed lookup while typing before or after the URL, editing the URL
  before resolution, and two independent URL pastes.
- Test external, malformed, query/fragment, embedded-prose, inaccessible, and
  failed-lookup inputs remain plain text without an entity.
- Test encrypted and code-content pastes bypass conversion.
- Retain focused file-paste coverage and run the relevant RichTextComposer,
  MessageInput, entity-rendering, and production Web/PWA build checks.
