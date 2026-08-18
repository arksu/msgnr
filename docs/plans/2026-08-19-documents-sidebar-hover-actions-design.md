# Documents sidebar hover actions

## Goal

Remove the width reserved by hidden action controls from the Documents sidebar.
Unhovered rows should give their labels the full available row width. Hovered or
keyboard-focused rows should show their action controls and truncate the label
only when those controls need space.

## Scope

Apply the behavior consistently to all Documents sidebar row types:

- Document-tree rows: favorite, add-child, and actions-menu controls.
- Pinned Favorites rows: remove-from-favorites control.
- Teamspace rows: add-root-document control.

Selected and favorited rows follow the same rule; they do not permanently
reserve an action-control slot.

## Design

Each row remains a single-line flex layout. Its title retains the existing
single-line truncation rule, but hidden actions are removed from layout with a
hidden action wrapper. That lets the title use the complete row width while
the row is not hovered.

On pointer hover, the action wrapper becomes visible and participates in the
layout, naturally reducing the title width only for that row. The wrapper also
becomes visible when the row contains keyboard focus so a user can tab from the
title into the controls. Existing test IDs, click propagation behavior, loading
states, and menu positioning remain unchanged.

## Verification

Add regression assertions for the hidden-until-hover/focus layout classes on a
document row, a pinned favorite row, and a teamspace row. Run the focused
Documents sidebar test file and the web production build. Manually verify long
titles at the Documents sidebar minimum width: full available title width when
idle; truncated title plus usable controls on hover and keyboard focus.
