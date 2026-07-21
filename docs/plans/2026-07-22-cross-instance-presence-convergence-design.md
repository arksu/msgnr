# Cross-instance presence convergence

## Failure mode

`workspace_events` are persisted and replayed through the Postgres-backed
event listener, so messages reach clients connected to any backend instance.
`PresenceEvent` is instead sent through each server's in-memory WebSocket
session map. When the subject and observer are connected to different backend
instances, an incoming DM can therefore arrive while the observer never sees
the peer become online.

## Design

1. A server broadcasts a changed presence snapshot to its local sessions and
   emits the same compact snapshot on the Postgres `workspace_presence`
   notification channel.
2. Every server's existing listener subscribes to that channel and forwards a
   received snapshot only to its own local WebSocket sessions. Notifications
   are ephemeral and do not enter `workspace_events` or its ordered replay.
3. When a client sends a correlated transport heartbeat, its serving backend
   appends the authoritative current presence of that user's DM peers after
   the heartbeat acknowledgement. This heals a missed notification within one
   heartbeat period without a browser refresh.
4. Authentication and the transport heartbeat both continue to refresh the
   subject's presence lease. Lease expiry remains the source of offline state.

## Verification

- Presence notification parsing and listener dispatch.
- Two `ws.Server` instances sharing one database: a change on instance A
  updates a user connected only to instance B.
- Transport heartbeat returns the acknowledgement and a DM-peer presence
  snapshot for the observer.

## Boundaries

Presence remains an ephemeral liveness signal. A real network partition is
represented by lease expiry; the next notification or transport heartbeat
converges observers to the database-authoritative status.
