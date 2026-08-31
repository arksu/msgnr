# Encrypted message decrypt render design

## Problem

Opening an encrypted direct-message conversation can leave its messages showing
`Decrypting encrypted message...` even after local decryption completes.
Changing conversations and returning makes the decrypted bodies appear.

The chat store deliberately updates the canonical message object in place after
decryption. The virtual timeline derives its render list from item identities,
so an in-place body update does not reliably invalidate the active slot render.

## Decision

Keep decryption and message ownership in the chat store unchanged. Give the
virtual timeline a lightweight, render-relevant revision input derived from the
visible messages' bodies. A decrypt completion advances that input, causing the
active timeline to render the updated message and allowing its existing
`ResizeObserver` to recalculate the row height.

This applies identically to encrypted messages received through history and to
messages received through the live WebSocket event path. It does not copy
plaintext into caches, queues, or any server-facing path.

## Alternatives considered

- Replace each decrypted message object in the store. This would invalidate the
  timeline but adds unnecessary array/map churn and risks unrelated cache work.
- Force-remount or refresh the whole timeline after every decrypt. This is
  broader and unnecessarily costly for long conversations.

## Verification

Add regression coverage that confirms the history and live-event paths update
the currently rendered encrypted message body without a conversation switch.
Run the focused store and virtual-timeline/component tests, TypeScript checks,
and the production web build where available.
