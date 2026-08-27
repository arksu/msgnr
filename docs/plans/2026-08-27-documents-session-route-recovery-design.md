# Documents session route recovery

## Goal

When a user leaves an open document for another sidebar mode and returns to
Documents during the same app session, reopen that document instead of sending
the user to the Documents browser.

## Scope

- Keep the most recent open Documents card route in `MainView` memory only.
- Restore that route from the Documents sidebar mode button.
- Retain existing search and teamspace fallback behavior when no document has
  been opened during the session.

Out of scope: persistence through page reloads or app restarts, changing
document loading, and altering explicit back or delete behavior.

## Design

Extend the existing in-memory Documents navigation state with the most recent
`documents-card` route. Update it whenever the router enters a valid document
card route. When the Documents mode button is pressed from Chat or another
mode, restore that card route before considering the existing search/teamspace
fallback routes.

The existing route watcher will reload the document as needed. If loading
fails or the document is deleted, its current fallback to the Documents browser
remains responsible for recovery. Navigation within Documents, including Back,
continues to clear the selected document and use the existing non-card route.

## Verification

Add a MainView regression test for document card -> Chat -> Documents and
assert that the same card route is restored. Run the focused MainView test,
the Web production build, and `git diff --check`.
