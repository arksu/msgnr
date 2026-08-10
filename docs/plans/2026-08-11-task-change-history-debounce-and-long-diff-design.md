# Task Change History Debounce and Long Diff Design

## Goal

Prevent frequent collaborative description saves from producing noisy task
history, and keep the bottom of long description diffs visible before users
expand them.

## Description-history debounce

The first changed description save creates a provisional `description` row in
`task_change_history`. It is not returned by the history API until it has been
quiet for 10 seconds. A later description save updates that provisional row's
after value and timestamp when it is still the newest description event for
the same actor, resetting the quiet period. The before value remains from the
first edit in the burst.

If another actor creates an intervening description event, a new provisional
row is created rather than merging across collaborators. This keeps the
description sequence correct. The implementation uses the existing durable
history table and API visibility filter, so it does not rely on browser timers,
process-local state, or a new background worker.

## Long diff collapse

When a diff exceeds 30 lines, collapsed Unified and Inline views render the
first 15 lines, an in-place separator showing the number of omitted lines,
and the last 15 lines. Expand reveals every line; Collapse restores the same
head/middle/tail view. The separator prevents the visible head and tail from
appearing adjacent in the source.

## Verification

Backend integration coverage verifies same-actor coalescing, the ten-second
visibility delay, and the no-merge behavior after another actor's edit.
Frontend tests verify collapsed Unified and Inline diffs display a separator
and tail content, plus existing expand/collapse behavior. Run focused Go and
Vitest tests, the frontend production build, and whitespace checks.
