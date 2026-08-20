# Task Description Image Preview Design

## Goal

Let a user click an image embedded in an editable task description and open a
full-screen preview, matching the image-preview interaction used in messages.

## Scope

- Apply to task attachment images rendered by `TaskDescriptionRichEditor`.
- Open the preview from an inline image while the description remains editable.
- Support closing with the backdrop, explicit close control, and `Escape`.
- Reuse the already fetched inline image immediately, then request the original
  attachment for the preview when available.

Out of scope: changing uploads, attachment ownership, Markdown syntax,
non-image attachments, or message media behavior.

## Chosen Approach

Add a small task-description image-preview state to `TaskDescriptionRichEditor`
and handle clicks on resolved attachment image elements in its existing
ProseMirror DOM event seam. The editor already maps attachment URLs to object
URLs and owns their lifetime, so it can show the cached preview at once and
fetch the original attachment only after the user explicitly opens the
lightbox.

The overlay will follow the existing task/message interaction: it is teleported
to `body`, has an accessible dialog label, closes on backdrop click or Escape,
and uses a close button. Image clicks only intercept task attachment image
URLs; normal editor selection and non-image links retain their current
behavior.

## Data Flow

1. The rich editor resolves a `msgnr-attachment://` or staged attachment image
   to an object URL for its inline preview.
2. A click on that image parses its preserved attachment URL and opens the
   dialog with the current object URL and image name.
3. The editor fetches the original attachment at foreground priority and swaps
   the dialog source when it arrives.
4. Closing clears dialog state. Editor teardown revokes owned object URLs as it
   does today.

## Error Handling and Verification

- If original loading fails, retain the already visible inline preview; do not
  interrupt editing or show an unrelated error.
- If the attachment cannot be resolved, leave the image unexpanded.
- Component tests will cover image click/open, the original-source upgrade,
  backdrop and Escape close, and non-image-link behavior.
- Run the focused rich-editor Vitest suite, the relevant task-description
  suite, the production Web build, and `git diff --check`.
