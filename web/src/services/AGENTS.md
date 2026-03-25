# Services Notes for Agents

This directory contains cross-cutting runtime services: HTTP clients, persistence adapters, and utility engines.

## Responsibilities

1. Keep transport/storage adapters small and deterministic.
2. Isolate local storage keys and wire-format adapters from UI/store logic.
3. Provide reusable runtime helpers (for example notification sound engine).

## Invariants

1. Storage key migrations must be backward-safe and explicit.
2. Sound playback is best-effort: failures from autoplay policy or output routing must not break app flow.
3. Notification sound engine remains swappable behind an interface (`SoundEngine`).
4. IndexedDB writes must remain structured-clone-safe (no Vue proxies / non-cloneable values); normalize arrays/records to plain data before persistence.
5. Shared browser auth state must reconcile with current storage contents; a stale tab must not clear newer tokens written by another tab.

## Change Guidance

1. If API routes or payloads change, update both service modules and their consumers in one PR.
2. Keep browser-specific APIs guarded (`setSinkId`, Notification/SW capabilities).
3. Avoid mixing app-domain policy into low-level services.
4. For Dexie/cache writes, prefer explicit serialization helpers over direct assignment from reactive store objects.
5. When changing auth refresh/storage helpers, preserve multi-tab web behavior and explicit cross-tab logout semantics.
6. Admin HTTP payloads for bot users may diverge from human users (for example `integration_token` on edit, no password mutation); keep those contracts explicit in the typed client.
