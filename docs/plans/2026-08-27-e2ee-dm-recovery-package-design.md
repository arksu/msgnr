# E2EE DM recovery package design

## Goal

Allow a user to move existing encrypted-DM access to another browser or device
after browser storage is cleared. The user exports a passphrase-protected
recovery package from a browser that still has their E2EE identity and imports
it after authenticating on another browser.

This must work for encrypted DMs created before this feature exists. The
server, network, event log, and database remain unable to decrypt the package
or the encrypted messages.

## Scope and decisions

- Add a Security tab to the existing Profile dialog.
- Export a copyable, passphrase-encrypted recovery package. Do not display or
  copy the raw private JWK.
- Preserve the current E2EE `deviceId`, public P-256 JWK, and private P-256
  JWK in the encrypted package.
- Importing the package clones one logical E2EE identity. The original and
  imported browsers both retain access to all ciphertext addressed to that
  device ID, including existing encrypted-DM history and future messages.
- Add a public-only backend activation operation to retire a temporary local
  device created before import. It must never receive the package, passphrase,
  or private key.

This deliberately does not provide independent revocation for the two browser
copies. Revoking their shared device ID would stop future delivery to both.
Independent device management needs a future key-rotation and history
re-encryption design.

## Recovery package

The package is a compact, versioned text value with a fixed prefix such as
`MSGE2E-R1.` followed by base64url JSON. Its unencrypted header contains only
the format version, KDF identifier and fixed parameters, random salt, and
AES-GCM nonce. Its encrypted body contains:

- `deviceId`
- `publicKeyJwk`
- `privateKeyJwk`

Version 1 derives a 32-byte wrapping key with Argon2id using fixed,
versioned parameters: 64 MiB memory, three iterations, and parallelism one.
It encrypts the body with AES-256-GCM. The canonical header is authenticated
as AES-GCM additional authenticated data so an attacker cannot alter the
package version, KDF parameters, salt, or nonce without detection.

The implementation must use an audited browser-compatible Argon2id WASM
dependency rather than silently falling back to a weaker KDF. Package parsing
accepts only supported versions and exact permitted KDF parameters, imposes a
small maximum package size, and rejects malformed base64url and JSON before
allocating expensive crypto work.

The passphrase and decrypted device bundle exist only in runtime memory during
the export or import action. They must not be sent over HTTP or WebSocket,
written to IndexedDB, draft storage, telemetry, logs, error messages, or the
backend database.

## User experience

The Security tab owns its actions and does not use the general Profile Save
button.

### Export

- The tab reports whether this browser already has a local E2EE identity. It
  must not create one merely because the user opened Settings.
- When an identity exists, the user enters and confirms a recovery passphrase.
- Create recovery package produces a read-only text field and a Copy recovery
  package action.
- If clipboard access is unavailable, the user can copy from the read-only
  text field manually.
- Changing either passphrase, closing the dialog, or switching away from the
  Security tab clears the generated package from the rendered UI.
- The UI warns that anyone with both the copied package and its passphrase can
  read the encrypted-DM history available to this logical device.

### Import

- The user pastes a recovery package and enters its passphrase.
- The browser decrypts and validates the package locally before making a
  recovery request.
- If a different E2EE identity already exists locally, the user must explicitly
  confirm replacement. The UI explains that messages only decryptable with the
  replaced identity cannot be recovered unless it has first been exported.
- After successful activation, the browser writes the imported local identity,
  clears in-memory encrypted message placeholders, and reloads encrypted-DM
  history.
- Package data and passphrase fields are cleared after success, cancellation,
  or dialog close.

## Backend activation contract

Introduce an authenticated recovery activation endpoint. Its request contains
only the imported device ID, the imported public device bundle, and an optional
different current local device ID to retire. The endpoint runs one transaction:

1. Verify that the imported device ID either belongs to the authenticated user
   or can be created for that user. Reject a device ID belonging to another
   user.
2. Activate or refresh the imported device's public bundle and last-seen time.
3. If supplied and different, mark the authenticated user's temporary current
   device as revoked.

The endpoint does not receive any private key material. It returns only the
activated public device record. It must not log request values as secret
recovery data even though the request contains public keys.

The client calls this endpoint only after local decrypt/validation succeeds.
It writes the imported identity only after activation succeeds. If activation
fails, the existing local identity remains unchanged. If local persistence
fails after activation, the user can retry import from the recovery package;
the imported historical device remains valid on the server.

## Error handling and security limits

- Wrong passphrases, authentication failures, tampered packages, and malformed
  packages return one generic local error and do not change local storage.
- Unsupported package versions or prohibited KDF parameters return a specific
  compatibility error without attempting Argon2id.
- A browser without a local E2EE identity cannot export a package.
- A missing package or forgotten passphrase is unrecoverable. The backend
  cannot reset or recover E2EE history.
- Copying an identity is intentional. A copied identity cannot distinguish the
  old and new browser, and both keep access until the shared device ID is
  revoked or a future rotation feature replaces it.
- This feature does not remove the existing localStorage/XSS and malicious
  server-delivered JavaScript risks. It protects an exported package at rest
  and in transit between user-controlled devices, not a compromised browser.

## Verification

Add focused coverage for:

- exporting and importing a pre-feature local E2EE identity;
- decrypting old encrypted-DM ciphertexts after import;
- both browser copies decrypting old and newly delivered ciphertexts for the
  shared device ID;
- wrong passphrase, tampering, malformed content, oversized packages,
  unsupported versions, and disallowed KDF parameters leaving local identity
  storage unchanged;
- import with a temporary device retiring only that temporary device;
- cross-user device IDs being rejected by the activation endpoint;
- export/import UI states, confirmation, clipboard fallback, and field
  clearing; and
- proof that recovery package text, passphrase, and private JWK never reach
  HTTP payloads, WebSocket frames, IndexedDB, drafts, or logs.

Run the focused web crypto/UI tests, backend chat integration tests, the web
production build, and `git diff --check` before implementation is accepted.

## Non-goals

- Device-specific revocation after a recovery package is imported.
- Server-side, cloud, or password-reset recovery of E2EE identities.
- Recovery of a lost key when no exported package remains.
- Channel E2EE, encrypted attachments, or a general Signal key-rotation
  protocol.
