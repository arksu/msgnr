# Thread Unread Resolution Design

## Problem

Selecting a conversation advances its root-message read cursor. The same server
operation currently resolves every mention and thread-reply notification in the
conversation, including notifications whose target is inside a thread. As a
result, thread items disappear from the unread feed without the user opening the
thread.

Conversation reads and thread reads already use separate persisted cursors. The
notification-resolution behavior must preserve that boundary.

## Design

Conversation-level read updates will resolve only notifications that do not have
a `thread_root_message_id`. This keeps ordinary conversation mentions aligned
with the conversation read cursor while preserving thread-reply notifications
and mentions inside threads.

Explicit thread actions remain unchanged:

- Opening a visible thread subscribes to it, advancing its thread read cursor,
  and resolves notifications for that thread.
- Opening a thread item from the unread feed explicitly resolves that thread's
  notifications.

No protocol or schema changes are required because notifications already carry
their thread root identifier.

## Verification

Add integration coverage proving that a conversation read:

- resolves a root-conversation mention;
- preserves a thread-reply notification;
- preserves a mention notification targeting a thread; and
- leaves the thread unread counter set until the thread is explicitly
  subscribed.
