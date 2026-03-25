# Stores Notes for Agents

This directory owns client-side authoritative runtime state (WS lifecycle, chat state, calls, auth/session state).

## Responsibilities

1. Apply server events in correct order and preserve protocol semantics.
2. Keep unread, notification, and call state convergent with server-authoritative data.
3. Expose minimal store APIs for views/components; avoid leaking protocol details into UI.
4. Emit lightweight side-effect hooks (for example incoming message sound hooks) without coupling store logic to UI implementations.

## Invariants

1. `chat.lastAppliedEventSeq` is monotonic and duplicate-safe.
2. Unread counters and `notification_level` semantics remain server-authoritative.
3. Inactive-window behavior must not fake disconnects: WS can stay connected while window is inactive.
4. Incoming-message sound hooks fire only for non-self messages when tab is inactive and notification level allows.
5. Task selection is authoritative: stale async task-update responses must not overwrite `selectedTask` after navigation to another task.
6. Auth/session state must stay convergent with shared browser storage: a stale refresh failure must not force logout if another tab already rotated tokens successfully.
7. Browser auth/session stores represent interactive human sessions only; bot users and static integration tokens must not be modeled as normal web login state.

## Change Guidance

1. If WS payload handling changes, update store handlers and `web/src/stores/__tests__` in the same change.
2. Keep protocol adaptation in stores; components should consume derived state and actions.
3. Avoid introducing hidden timers/global singletons inside stores unless lifecycle is explicit and test-covered.
4. For task-scoped update APIs, gate selected-task assignment by matching task ID to avoid cross-task races.
5. If auth semantics change for non-human principals, keep that split in services/handlers; do not widen browser-session stores to support static integration-token flows.

## Tests

1. Prefer store unit tests for event ordering, unread/read transitions, and notification-level behavior.
2. Add regression tests for focus/blur/visibility-sensitive logic.
3. Add auth/session regressions when token refresh or logout coordination changes.
