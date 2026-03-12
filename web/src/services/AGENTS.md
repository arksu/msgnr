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

## Change Guidance

1. If API routes or payloads change, update both service modules and their consumers in one PR.
2. Keep browser-specific APIs guarded (`setSinkId`, Notification/SW capabilities).
3. Avoid mixing app-domain policy into low-level services.
