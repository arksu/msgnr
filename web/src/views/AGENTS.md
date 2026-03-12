# Views Notes for Agents

This directory owns route-level orchestration (page composition, lifecycle wiring, and cross-store coordination).

## Responsibilities

1. Compose feature panels and dialogs without duplicating store business rules.
2. Wire browser lifecycle events (focus/blur/visibility) to store/WS activity signals.
3. Keep route-level side effects explicit (realtime startup, push checks, invite handling).

## Invariants

1. `MainView` must keep client activity reporting (`setClientActive` + `sendSetClientWindowActivity`) consistent on focus/blur/visibility transitions.
2. Incoming call invite ring starts when an invite is active and stops when invites clear or view unmounts.
3. On unmount, unsubscribe listeners and stop active audio playback; do not break singleton sound engine reuse.

## Change Guidance

1. Do not move protocol/event interpretation from stores into views.
2. When adding route lifecycle effects, ensure cleanup in `onUnmounted`.
3. Keep settings/profile dialogs accessible and non-blocking for realtime flows.
