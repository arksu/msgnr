Section 1 — Base Message Layout (No Reactions, No Thread)
Show the minimal message UI.

[Avatar]  John Doe      10:42 AM
          Hello team, the deployment has finished successfully.

┌──────────────────────────────────────────────────────────────┐
│ [Avatar]  Username                    Timestamp              │
│           Message text line 1                                │
│           Message text line 2                                │
└──────────────────────────────────────────────────────────────┘

Section 2 — Message With Hover Actions
When the user hovers the message, show message actions.

[Avatar]  John Doe      10:42 AM                      🙂  💬  ⋯
          Hello team, the deployment has finished successfully.

┌──────────────────────────────────────────────────────────────┐
│ [Avatar]  Username                    Timestamp     🙂 💬 ⋯  │
│           Message text                                       │
└──────────────────────────────────────────────────────────────┘

Action buttons:
🙂  Add reaction
💬  Reply in thread
⋯   More actions
Buttons appear only on hover.

Section 3 — Message With Reactions
If reactions exist, show them below the message text.

[Avatar]  John Doe      10:42 AM                          💬 ⋯
          Hello team, the deployment has finished successfully.

          [ 👍 4 ]  [ 🎉 2 ]  [ ❤️ 1 ]

┌──────────────────────────────────────────────────────────────┐
│ [Avatar]  Username                    Timestamp         💬 ⋯ │
│           Message text                                       │
│                                                              │
│           [ 👍 4 ]  [ 🎉 2 ]  [ ❤️ 1 ]                       │
└──────────────────────────────────────────────────────────────┘

Rules:
Each reaction is a pill button
Format:
[ EMOJI COUNT ]

Click behavior:
Clicking adds/removes reaction

Action buttons:
💬  Reply in thread
⋯   More actions
Buttons appear only on hover.



Section 4 — Message With Thread (No Reactions)
If message has replies, show a thread indicator.

[Avatar]  John Doe      10:42 AM                          🙂 ⋯
          Hello team, the deployment has finished successfully.

          💬 5 replies   Last reply 2h ago

┌──────────────────────────────────────────────────────────────┐
│ [Avatar]  Username                    Timestamp        🙂 ⋯  │
│           Message text                                       │
│                                                              │
│           💬 5 replies    Last reply 2h ago                  │
└──────────────────────────────────────────────────────────────┘

Rules:
Thread indicator clickable
Opens thread panel

Action buttons:
🙂  Add reaction
⋯   More actions
Buttons appear only on hover.


Section 5 — Message With Reactions + Thread
Both elements appear under the message.

[Avatar]  John Doe      10:42 AM
          Hello team, the deployment has finished successfully.

          💬 5 replies   Last reply 2h ago

          [ 👍 4 ]  [ 🎉 2 ]


┌──────────────────────────────────────────────────────────────┐
│ [Avatar]  Username                    Timestamp              │
│           Message text                                       │
│                                                              │
│           💬 5 replies    Last reply 2h ago                  │
│           [ 👍 4 ]  [ 🎉 2 ]                                 │
│                                                              │
└──────────────────────────────────────────────────────────────┘

Spacing rules:
thread indicator first
reactions appear below thread indicator

Section 6 — Message Being Replied To (Thread Highlight)
When a message has an active thread open, highlight it.

▶ [Avatar]  John Doe      10:42 AM
            Hello team, the deployment has finished successfully.

            💬 5 replies
            [ 👍 4 ]  [ 🎉 2 ]

┌──────────────────────────────────────────────────────────────┐
│ ▶ [Avatar]  Username                Timestamp                │
│   Message text                                               │
│                                                              │
│   💬 5 replies                                               │
│   [ 👍 4 ]  [ 🎉 2 ]                                         │
└──────────────────────────────────────────────────────────────┘


Indicator:
▶
Shows thread is open.

Section 7 — Compact Message Grouping
Messages from same user within short time collapse avatar.

[Avatar]  John Doe     10:42 AM
          First message

          Second message
          Third message

[Avatar] Username
        Message 1

        Message 2
        Message 3

Rules:
avatar shown only once
username only once

Section 8 — Reaction Hover State
Hovering a reaction shows tooltip.

Example:
[ 👍 4 ]
      └─ reacted by:
         Alice
         Bob
         Carol
         David

Section 9 — Complete Message Example
Full example with everything:

[Avatar]  John Doe      10:42 AM                    🙂 💬 ⋯
          Hello team, the deployment has finished successfully.

          💬 5 replies   Last reply 2h ago

          [ 👍 4 ]  [ 🎉 2 ]  [ ❤️ 1 ]


Message Context Menu
┌──────────────────────────┐
│ Copy message             │
└──────────────────────────┘

click Copy message - copying message text to clipboard


---

Thread UI:

┌─────────────────────────────────┐
│  Thread                    [X]  │  ← Header with close button
├─────────────────────────────────┤
│  [Original message displayed    │  ← Parent message (read-only style)
│   in full at the top]           │
│                                 │
│  ── 3 Replies ────────────────  │  ← Divider with reply count
│                                 │
│  [Reply 1]                      │  ← Thread replies (same message
│  [Reply 2]                      │     anatomy as main feed)
│  [Reply 3]                      │
│                                 │
├─────────────────────────────────┤
│  [Thread composer input]        │  ← Reply composer (sticky bottom)
│  [Send button]                  │
└─────────────────────────────────┘