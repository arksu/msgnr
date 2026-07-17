# Video Thumbnail Play Indicator

## Goal

Make video attachments visibly distinct from still images in the message timeline.

## Design

Video thumbnails retain their current compact poster-frame preview. Add a centered
play icon with a translucent circular background above the preview. The indicator
is always visible, but does not intercept clicks: selecting any part of the
thumbnail continues to open the existing video lightbox.

## Scope

- Change only the video-attachment thumbnail in `MessageBubble.vue`.
- Preserve the current lightbox, playback controls, attachment loading, and
  download behavior.
- Add a component regression assertion for the persistent overlay.

## Verification

Run the focused `MessageBubble` Vitest suite and the frontend type-check/build.
