# Components Notes for Agents

This directory contains UI components and interaction surfaces.

## Responsibilities

1. Render state from stores/composables; avoid owning domain authority.
2. Keep interaction semantics accessible (keyboard, ARIA, focus management).
3. Emit explicit events upward rather than mutating global state directly.

## Invariants

1. Components must tolerate async state transitions (reconnect, permission updates, delayed bootstrap).
2. Notification/push toggles should reflect source-of-truth state from composables/stores.
3. Visual-only changes must not alter protocol/store semantics.
4. Chat- and task-comment markdown display should stay consistent: rendered markdown surfaces use the shared marked-based helper path and `markdown-body` styling.
5. Image lightboxes should support both backdrop-click close and `Escape` close for keyboard parity.

## Change Guidance

1. Keep heavy orchestration in views/stores, not leaf components.
2. When adding controls, include disabled/loading/error states and test IDs where existing patterns use them.
3. Maintain consistency with existing design language unless a deliberate redesign is requested.
4. When adding markdown rendering to a component, add/adjust tests to assert rendered HTML output rather than plain-text rendering.
