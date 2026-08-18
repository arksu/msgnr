# Chat Image Thumbnails and Lazy Loading

## Goal

Make image previews in regular chats appear quickly and keep chat reloads from
starting downloads for every image at once. The first release applies only to
new chat-image uploads; historical attachments are not backfilled.

## Scope

- Generate and persist one static thumbnail for every newly uploaded supported
  chat image.
- Load image media only near the chat viewport, with a shared concurrency cap.
- Cache immutable thumbnail responses in the browser's private HTTP cache.
- Preserve original attachments for the lightbox and downloads.

Out of scope: task/document attachment thumbnails, video thumbnails, a
historical backfill job, external media services, and non-Go image runtimes.

## Chosen Approach

Generate the thumbnail synchronously as part of chat attachment upload. This
keeps the attachment response and the resulting message metadata immediately
ready for display, without introducing a worker, queue, or retry system.

The original is always authoritative. Thumbnail generation is best effort: an
unsupported, corrupt, or unsafe image still uploads successfully without a
thumbnail.

## Server Data Flow

1. Store the original attachment unchanged.
2. For supported raster images, inspect dimensions before decoding and skip
   thumbnail generation above a safe source-pixel limit.
3. Decode JPEG, PNG, WebP, or GIF. GIF uses only its first frame.
4. Resize proportionally to a maximum 720-pixel long edge.
5. Encode opaque results as JPEG and transparent results as PNG.
6. Store the derivative beneath the same attachment object prefix, with a
   versioned name such as `thumbnail-v1.jpg` or `thumbnail-v1.png`.
7. Persist nullable thumbnail key, MIME type, file size, and version on
   `message_attachment`.

The image implementation uses Go packages linked into the server binary. It
does not invoke ImageMagick, a Node process, a hosted image service, or a cgo
runtime dependency.

The attachment DTO and websocket payload expose thumbnail availability and
version. Existing rows have no thumbnail metadata and remain compatible.

Attachment deletion, message deletion, DM-history clearing, and forwarding
must handle the thumbnail alongside the original. If thumbnail generation or
storage fails, log a structured non-sensitive warning and return the successful
original attachment with thumbnail metadata absent.

## Thumbnail Delivery and Cache

Expose an authorised versioned thumbnail route under the message attachment
resource. It applies the same conversation-membership check as original
attachment download and returns the recorded thumbnail metadata.

Responses include:

- `Content-Type` and `Content-Length`
- `ETag`
- `Cache-Control: private, max-age=2592000, immutable`
- `Vary: Authorization`

The versioned URL makes each thumbnail immutable. Private HTTP caching provides
fast reloads while avoiding a service-worker `CacheFirst` route that could
serve authenticated media after an account or access change.

## Client Delivery

Replace eager attachment preloading in chat message bubbles with a shared
thumbnail loader. Each image placeholder uses `IntersectionObserver` with a
small prefetch margin. A global queue allows at most four media requests at a
time.

New attachments fetch their thumbnail near the viewport. Opening the lightbox
uses the thumbnail immediately, then fetches the original only for that
lightbox; download behaviour continues to fetch the original. Legacy rows and
rare thumbnail failures lazily fetch their original only after becoming
visible. Audio, video, and non-image attachment behaviour is unchanged.

## Verification and Rollout

- Unit-test image generation for JPEG, transparent PNG, WebP, and animated
  GIF first frames, output bounds/types, and unsafe dimensions.
- Integration-test upload, authorised thumbnail download, missing-thumbnail
  fallback, forwarding, and cleanup of both object keys.
- Handler-test authentication and cache headers.
- Component-test intersection-gated loading, four-request concurrency,
  thumbnail-to-original lightbox replacement, and lazy legacy fallback.
- Run targeted Go and Vitest suites plus production Web/PWA and Tauri builds.

No existing attachments are migrated. Structured server logs record generation
duration and input/output byte counts without filenames or image content so the
performance improvement can be measured after deployment.
