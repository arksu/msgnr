# Task Change History Value Transition Design

## Goal

Keep the existing task change-history layout and replace only the ordinary
value presentation with the compact transition treatment from the supplied
reference: `old value → new value`.

## Rendering

The prior value appears first, followed by a muted arrow, then the new value.
Missing, cleared, or empty values render as a muted italic `empty`, producing
clear states such as `empty → v2.14.0` and `Backend → empty`.

Existing type-aware formatting remains unchanged for statuses, people,
multi-value fields, and dates. Description entries retain their current
diff control; attachment and creation entries retain their compact file-card
presentation. Pagination, deferred loading, and the underlying history API
are unaffected.

## Verification

Update the focused component test to assert the empty-to-value and
value-to-empty transitions, then run the history component test and frontend
type/build checks.
