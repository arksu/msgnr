# Raise-hand acknowledgement correction

## Problem

The call store currently waits for the durable `call_raised_hands_changed` event
before updating a participant badge. If fanout is delayed, a successful lower
hand request leaves the prior badge visible.

## Decision

On a successful `SetCallHandRaisedResponse`, apply the returned complete queue
to the local call snapshot immediately. Durable raised-hand events continue to
replace that snapshot for every participant and after reconnects.

## Verification

Extend the call-store regression test to prove a lower-hand acknowledgement
removes the local badge, then run the focused Vitest suite and production build.
