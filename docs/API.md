# API Reference — @vllnt/convex-consent

**Compatibility:** `convex@^1.41.0`

Construct the client with the mounted component and optional host config:

```ts
import { Consent } from "@vllnt/convex-consent";
import { v } from "convex/values";

const consent = new Consent<MyProof>(components.consent, {
  defaultVersion: "2024-policy",                            // version stamped when record omits one
  proofValidator: v.object({ policyHash: v.string() }).parse, // narrow stored proof
});
```

`Consent<TProof = unknown>` is generic over the host's opaque consent `proof`
type. All methods take the host `ctx` (a query or mutation context) as the first
argument.

**Time is server-sourced.** Every handler stamps the event `at` from `Date.now()`
itself; no method accepts a caller-supplied clock.

**Validation.** When `proofValidator` is set it runs at the client boundary: over
the value written by `record` / `withdraw` (before storage) and over the value
returned by `history` (on read). It must return the typed value or throw. Omit it
to leave the opaque proof unvalidated.

## Mutations

### `record(ctx, subjectRef, purpose, decision, opts?) → { at }`

`decision` is `"granted" | "denied" | "withdrawn"`. `opts`:
`{ version?: string; proof?: TProof }` (`version` defaults to the client's
`defaultVersion`, itself `"1"` by default).

Record a consent decision for a `(subjectRef, purpose)` pair. Appends one
immutable row to the `consentEvents` ledger — the GDPR proof — and overwrites the
`consentState` projection so the next `check` / `getState` reads the new decision.
`at` is stamped from the server clock. `proof` is validated against
`proofValidator` before storage. Returns the event timestamp.

### `withdraw(ctx, subjectRef, purpose, proof?) → { at }`

Withdraw a previously-granted consent (GDPR Art. 7(3)). Appends a `withdrawn`
event (carrying the prior version) and projects it — but only when the subject
currently holds a `granted` decision.

A pair with no recorded consent throws
`ConvexError({ code: "NO_CONSENT" })`; a pair whose current decision is not
`granted` (already `denied`/`withdrawn`) throws
`ConvexError({ code: "NOT_GRANTED" })`. Withdrawal is never a silent no-op, so the
audit trail stays meaningful.

### `prune(ctx, opts?) → number`

`opts`: `{ before?: number; batch?: number }` (defaults: `before = Date.now()`,
`batch = 200`).

Delete up to `batch` **ledger events** whose `at < before`, oldest first via the
`by_at` index, and return the count removed in the first pass. Only the historical
`consentEvents` ledger is swept — the `consentState` projection (the live gate) is
never pruned, so the current decision survives even after old proof ages out. If a
full batch was removed the sweep self-reschedules through the component scheduler
until the tail is clean. Idempotent — safe to run anytime. A built-in daily cron
drives it automatically; call `prune` directly only for an extra or custom-cadence
sweep.

## Queries

### `check(ctx, subjectRef, purpose, requiredVersion?) → ConsentCheck`

The runtime gate. Reads the O(1) current-state projection and returns
`{ granted, stale, decision, version, at }`:

- `granted` is `true` only when the latest decision is `granted` AND — if
  `requiredVersion` is supplied — the consented `version` matches it.
- `stale` is `true` when a `granted` decision is for an older `version` than
  `requiredVersion` (the host re-prompts); `granted` is then `false`.
- With no recorded consent, `granted`/`stale` are `false` and
  `decision`/`version`/`at` are `null`.

### `getState(ctx, subjectRef, purpose) → ConsentState | null`

The raw current decision for one pair, or `null` if none was ever recorded.
`ConsentState` is `{ subjectRef, purpose, decision, version, at }`.

### `getStatesForSubject(ctx, subjectRef) → ConsentState[]`

Every current decision held by one subject, across all purposes (via the
`by_subject` index).

### `history(ctx, subjectRef, purpose, paginationOpts) → PaginationResult<ConsentEvent>`

Page the immutable consent ledger for one pair, **newest-first** via the
`by_subject_purpose_at` index. Takes the standard Convex `paginationOpts` and
returns the standard paginated envelope (`page`, `isDone`, `continueCursor`).
`ConsentEvent` is `{ subjectRef, purpose, decision, version, proof?, at }`; `proof`
is narrowed by the host validator when set. This is the full proof trail for an
audit or a data subject request.

## Error codes

Coded `ConvexError`s thrown by the component (`error.data.code`):

| Code | Thrown by | Meaning |
|------|-----------|---------|
| `NO_CONSENT` | `withdraw` | No consent was ever recorded for this `(subjectRef, purpose)`. |
| `NOT_GRANTED` | `withdraw` | The current decision is not `granted` (already `denied`/`withdrawn`) — nothing to withdraw. |

## Cron / Maintenance

The component registers one cron (`crons.ts`):

| Job | Cadence | Action |
|-----|---------|--------|
| `consent:prune` | every 24h (`PRUNE_INTERVAL`) | runs `prune` with `batch = PRUNE_BATCH` (200), self-rescheduling until the stale-event tail is clean |

Cadence is a static module constant (Convex cron definitions are static per
deployment). A host wanting a different cadence — or a different retention window
than the 365-day default — drives `prune` from its own scheduler with an explicit
`before` cutoff. The cron is per-mount, so each `app.use(component, { name })`
instance prunes its own sandbox independently. The current-state projection is
never pruned.
