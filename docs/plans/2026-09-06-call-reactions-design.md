# Call Reactions

## Goal

Let active call participants send a short-lived emoji reaction that appears on
the sender's call tile for everyone currently in the call.

## Design

Call reactions use a dedicated LiveKit data-message topic, following the
existing screen-annotation transport. Each packet contains a version, an
allowlisted emoji, a sender-session identifier, a monotonically increasing
sequence number, and a reaction identifier. The sender updates its own
in-memory state before publishing the reliable packet so its reaction is
visible immediately.

The client keeps only the latest reaction for each participant. A new reaction
replaces the previous one and receives a four-second lifetime. A reaction
timeout is guarded by its identifier so an older timeout cannot remove a newer
reaction. Incoming packets are accepted only when their topic, shape, emoji,
identity, identifiers, and sequence are valid; duplicate or older packets are
ignored.

Reaction state is not sent through the workspace WebSocket, stored in the
database, cached, included in bootstrap, or replayed after reconnect. It is
cleared when a participant leaves and when the room disconnects or reconnects,
which prevents stale badges from surviving membership or transport changes.

## UI

The expanded control bar gains a Reactions button that opens a compact picker
for 👍, 👏, ❤️, 😂, 🎉, and 😮. Each picker option has a descriptive accessible
label. The button exposes its expanded state. The selected reaction is shown
as a compact badge above the participant name/microphone overlay on local and
remote tiles, and above the name badge in the pinned presentation. The
minimized call dock and layout are unchanged.

## Verification

- Call-store tests cover local publishing, receiving, automatic expiry,
  replacement under rapid sends, duplicate/stale packets, invalid data, and
  state cleanup.
- CallDock tests cover opening the picker, selecting an emoji, and displaying
  a reaction on the correct local, remote, and pinned tile.
