# Encrypted message decrypt render design

## Problem

Opening an encrypted direct-message conversation can leave its messages showing
`Decrypting encrypted message...` even after local decryption completes.
Changing conversations and returning makes the decrypted bodies appear.

The chat store starts decryption with a plain message object before that object
is inserted into Pinia's reactive conversation or thread collection. The async
completion updates that original non-reactive object, so Vue does not observe
the body change. A later remount reads the changed object and makes the text
appear.

## Decision

Keep the encryption protocol and message ownership unchanged. When decryption
finishes, resolve the message by ID from the canonical reactive conversation or
thread collection, then update that object's body only while it still contains
the decrypting placeholder. Vue and the existing timeline then receive the
normal reactive update and recalculate the row height if necessary.

This applies identically to encrypted messages received through history and to
messages received through the live WebSocket event path. It does not copy
plaintext into caches, queues, or any server-facing path.

## Alternatives considered

- Pass a reactive proxy into the decrypt helper immediately after insertion.
  This also works but makes call-site ordering easier to get wrong.
- Force-remount or refresh the whole timeline after every decrypt. This is
  broader and unnecessarily costly for long conversations.

## Verification

Add regression coverage that confirms the history and live-event paths update
the currently rendered encrypted message body without a conversation switch.
Run the focused store and virtual-timeline/component tests, TypeScript checks,
and the production web build where available.
