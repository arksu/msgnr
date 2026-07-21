# Presence convergence after unstable connections

## Goal

Keep DM presence accurate without requiring a page refresh when either the
subject or observer experiences a temporary WebSocket failure and reconnects.

## Current failure

Presence leases are refreshed only by the uncorrelated presence heartbeat. A
browser can delay that timer while the user still has a usable or newly
reconnected socket. Separately, a dropped direct `PresenceEvent` does not force
the observer to reconnect, so its stale local value can persist indefinitely.

## Design

1. A negotiated correlated transport heartbeat refreshes the authenticated
   connection's presence lease before returning its acknowledgement. This
   makes a successful bidirectional liveness probe the source of online state.
   The legacy presence heartbeat remains the fallback for servers that have not
   negotiated transport-heartbeat support.
2. Authentication continues to create or refresh a lease immediately, and the
   lease sweeper continues to expire genuinely silent sessions. Manual Away is
   preserved because lease recomputation still applies the preferred status.
3. Direct fanout overflow closes every affected recipient session, including
   presence-only envelopes. The normal reconnect flow then bootstraps the
   authoritative presence snapshot, repairing an event missed during overflow.
4. The client runs only one periodic liveness mechanism when transport
   heartbeat is supported, avoiding duplicate presence writes. It retains the
   legacy heartbeat when connected to an older server.

## Verification

- Backend integration test: transport heartbeat restores an expired presence
  lease and fanouts `online` with the correlated acknowledgement.
- Backend unit test: a dropped direct presence envelope disconnects the
  affected recipient session.
- Frontend store tests: transport-capable servers use correlated heartbeats;
  presence-only servers retain the compatibility heartbeat.

## Boundaries

No client can know a peer's state during an actual network partition. The
server therefore treats presence as current through the lease timeout and
converges to the confirmed state on the next acknowledged heartbeat or
reconnect.
