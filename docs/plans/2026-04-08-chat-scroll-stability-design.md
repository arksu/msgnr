# Chat Scroll Stability Design

## Summary

Fix unstable scroll behavior in main chat mode for two separate cases:

1. Inline editing of an older message should keep that message pinned in place while the edit control grows.
2. Typing in the main composer at the bottom should keep the chat bottom-anchored so the latest message stays flush to the bottom edge without visible trembling.

Inline editing of the last message should behave like normal bottom-anchored composing, not like an anchored older-message edit.

## Problems To Solve

- Starting inline edit on a message currently causes the timeline to jump upward.
- Editing the last message does not preserve the bottom anchor when the editor grows.
- Growing the main composer while typing new lines causes visible scroll oscillation.
- Current scroll decisions are based on a mix of heuristics (`nearBottom`, forced bottom scroll, follow windows, resize deltas) without a single source of truth for intent.

## Recommended Approach

Introduce explicit scroll intent in `ChatArea.vue` and make it the only owner of vertical correction.

Use three modes:

- `bottom-anchor`
- `message-anchor`
- `free`

`MessageBubble.vue` reports inline edit lifecycle events upward, but does not perform any scroll corrections itself.

## Architecture

### ChatArea Scroll State

`ChatArea.vue` keeps a small reactive state object:

- `mode: 'bottom-anchor' | 'message-anchor' | 'free'`
- `anchorMessageId: string`
- `anchorOffsetTop: number`

Behavior:

- `bottom-anchor`
  Use when the user is composing at the tail, or editing the last visible message.
  On size changes, keep the scroller locked to the bottom.

- `message-anchor`
  Use when editing a non-tail message.
  Capture that message row and preserve its viewport offset while the inline editor grows or shrinks.

- `free`
  Use when the user manually scrolls away and the UI should stop forcing corrections.

### MessageBubble Lifecycle Events

`MessageBubble.vue` emits:

- `edit-open(messageId: string)`
- `edit-close(messageId: string)`
- `edit-resize(messageId: string, deltaPx: number)`

This keeps scroll ownership in `ChatArea.vue` and avoids local editor code fighting container scroll policy.

### Main Composer Resize

The main composer stays separate from inline edit behavior.

Rules:

- If the chat is at or near the bottom, composer growth enters or preserves `bottom-anchor`.
- If the user has scrolled away, composer growth does not force bottom scroll.
- Bottom anchoring uses a single correction path instead of repeated competing scroll attempts.

## Data Flow

### Inline Edit Open

When a message enters edit mode:

- `MessageBubble` emits `edit-open(messageId)`.
- `ChatArea` checks whether `messageId` is the last timeline message.
- If yes, switch to `bottom-anchor`.
- If no, capture that message row’s viewport offset and switch to `message-anchor`.

### Inline Edit Resize

When the inline edit control changes height:

- `MessageBubble` emits `edit-resize(messageId, deltaPx)`.
- `ChatArea` applies one of two paths:
  - tail message: scroll to bottom
  - non-tail message: restore the anchored message offset

### Inline Edit Close

When edit mode ends:

- `MessageBubble` emits `edit-close(messageId)`.
- `ChatArea` clears `message-anchor`.
- If the user is at the tail, return to `bottom-anchor`; otherwise return to `free`.

### Main Composer Resize

When the main composer resizes:

- If current mode is `bottom-anchor`, preserve bottom.
- If current mode is `message-anchor`, leave it alone because inline edit owns the anchor.
- If current mode is `free`, do nothing.

### Manual User Scroll

`handleScroll()` remains the user-intent boundary:

- If the user scrolls away from the bottom, leave `bottom-anchor` and enter `free`.
- If the user scrolls back near the bottom, arm `bottom-anchor`.
- If the user is editing an older message and manually scrolls, drop `message-anchor` and enter `free`.

## Implementation Notes

### ChatArea

Refactor existing scroll logic in `ChatArea.vue`:

- Keep existing preload and history-anchor logic for loading older messages.
- Reduce composer resize handling to one bottom-anchor path.
- Remove repeated forced bottom-scroll retries from normal resize handling.
- Add helpers:
  - `captureMessageAnchor(messageId)`
  - `restoreMessageAnchor()`
  - `setBottomAnchor(reason)`
  - `setFreeScroll(reason)`

### MessageBubble

Inline edit stays local for content and save/cancel behavior, but emits lifecycle and resize signals upward.

Reuse the existing rich text resize signal from the edit composer instead of introducing DOM observers.

### RichTextComposer

No major behavior change required.

It already emits resize deltas. The main fix is to make parent consumers react with explicit intent instead of mixed heuristics.

## Error Handling

- Missing anchor row: fall back to `free` instead of forcing an incorrect correction.
- Missing scroll container: no-op safely.
- Rapid edit open/close: last event wins; anchor state should be cleared on close.
- Message deletion while editing: clear anchor state and avoid restoration attempts.

## Testing Plan

### ChatArea

- composing at bottom with multi-line growth keeps latest message flush to bottom
- composing while scrolled away does not force bottom scroll
- editing last message keeps timeline bottom-anchored as lines are added
- editing older message preserves that message’s viewport position as lines are added
- manual scroll during older-message edit drops anchor mode and stops forced correction

### MessageBubble

- entering inline edit emits `edit-open`
- leaving inline edit emits `edit-close`
- edit composer growth emits `edit-resize` with the correct message id

### Regression Coverage

- no oscillating scroll while typing several new lines into the main composer
- no jump upward when starting inline edit
- no jump to bottom when resizing an older inline edit

## Tradeoffs

This approach adds explicit state to `ChatArea.vue`, but it replaces fragile implicit behavior with a model that matches user intent. The code becomes easier to reason about because resize events no longer decide scroll behavior on their own; they only apply the current mode.

## Recommendation

Implement explicit scroll modes in `ChatArea.vue` and event-driven inline edit coordination from `MessageBubble.vue`. This is the smallest change that solves both the “edit jump” and “composer trembling” issues without introducing a heavy observer-based system.
