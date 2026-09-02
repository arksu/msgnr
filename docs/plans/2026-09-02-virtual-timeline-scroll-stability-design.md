# Virtual Timeline Scroll Stability Design

## Goal

Keep the visible conversation position stable while a virtualized message row is
measured or changes height. The guarantee applies to the main chat, pinned
conversation workspace, and thread workspace without sacrificing
virtualization.

## Problem

`VirtualMessageTimeline` estimates rows at 96 px and corrects each rendered
row with `ResizeObserver`. It currently changes `scrollTop` itself and emits
`contentResize` before Vue applies the corresponding row transforms.
`ChatArea` responds by restoring a DOM anchor based on the pre-transform
geometry. The two corrections cancel or overshoot one another; as new rows
enter the virtual window, the feedback repeats as visible scroll twitching.

Late image previews and dynamic thread header/footer content create the same
class of height change. The shared timeline is used by three independent
surfaces, so parent-specific fixes would diverge.

## Decision

`VirtualMessageTimeline` is the only owner of scroll corrections caused by its
own layout changes. Its parent components continue to own explicit user
actions: sending, composer growth, focused-message navigation, and preserving
the anchor while an older history page is inserted.

The generic `contentResize` event is removed. In particular, `ChatArea` must
not restore a DOM anchor for a row measurement initiated by the timeline.

## Timeline Correction Algorithm

Before accepting a measurement batch, the timeline captures a logical anchor
from its current layout:

- If the scroller is within the shared 72 px bottom threshold, capture a
  bottom anchor.
- Otherwise capture the first visible virtual entry and the number of pixels
  from that entry's top to the viewport top.
- If only the `before` slot is visible, preserve the raw `scrollTop` instead
  of manufacturing a message anchor.

All changed row heights from one `ResizeObserver` delivery update the height
cache together. The timeline coalesces those changes, waits for Vue to apply
the new transforms, and restores the captured logical anchor exactly once.
This means the calculation always uses the new layout and never stale DOM
rectangles.

For a bottom anchor, it restores `scrollTop` to the new scroll height. For a
message anchor, it uses the measured entry's current logical offset. Missing
or removed entries safely fall back to the current position rather than
forcing an unrelated scroll.

The static observer applies the same policy to `before` and `after` slots;
resizing the scroll container itself only refreshes the viewport dimensions.

## Observer Lifetime and Performance

Function refs must retain an already observed row element instead of
unobserving and observing it on every virtual-window render. A direct row
element-to-ID lookup avoids a nested map scan for each resize entry.

This keeps observer work bounded to rows genuinely entering, leaving, or
resizing in the virtual window.

## Consumer Changes

`ChatArea` removes its generic resize-anchor state and handler. Its explicit
history-prepend anchor remains because the item collection, rather than an
existing row's height, changes there.

`ConversationWorkspace` and `ThreadWorkspace` require no bespoke correction
logic: the shared timeline preserves free-scroll and tail-reading behavior
for both. Their explicit composer and focus scroll actions remain unchanged.

## Regression Coverage

The timeline test suite will use a controlled `ResizeObserver` and variable
row heights to verify that:

1. an offscreen-above row changes height while reading older messages, and the
   visible message retains its exact offset after one correction;
2. a partially visible row changes height without an incorrect compensation;
3. a tail-row change keeps the scroller pinned to the bottom;
4. a `before` slot change retains the first visible reply's position;
5. re-rendering the same virtual row does not re-register its observer.

The focused chat and workspace suites will also verify that history prepend,
composer behavior, and focused-message navigation remain intact.

## Non-goals

- Disabling or raising the virtualization threshold.
- Changing history page size or server pagination.
- Adding browser-specific scroll behavior; this is shared frontend logic and
  must work in both web and desktop shells.
