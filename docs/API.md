# API Reference — @vllnt/convex-consent

**Compatibility:** `convex@^1.45.0`; Node.js 20 or later (`engines` `>=20`), 22
or later with convex 1.49 and newer, which require it.

## Entry points

| Import                                                  | Exports                                                                                                                                                   |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@vllnt/convex-consent`                                 | `Consent` class; types `ConsentComponent`, `ConsentOptions`, `RecordOptions`, `ConsentDecision`, `ConsentCheck`, `ConsentState`, `ConsentEvent`, `Parser` |
| `@vllnt/convex-consent/convex.config` (or `.js`)        | default component config for `app.use(...)`                                                                                                               |
| `@vllnt/convex-consent/test`                            | `register(t, name = "consent")` for `convex-test` (TypeScript source; needs Vite `import.meta.glob`)                                                      |
| `@vllnt/convex-consent/_generated/component` (or `.js`) | type `ComponentApi`                                                                                                                                       |

There is no `./react` entry; the package is backend-only.

`subjectRef` and `purpose` are opaque host strings: the component never parses
them. `version` is an opaque policy version string. Every `at` is a server
timestamp in milliseconds since the epoch, taken from `Date.now()` inside the
component; no method lets the caller set an event's `at`.

## Data model

The component keeps two tables, reachable only through its functions:

| Table           | One row per                       | Indexes                          | Changed by                                              |
| --------------- | --------------------------------- | -------------------------------- | ------------------------------------------------------- |
| `consentEvents` | decision (the append-only ledger) | `by_subject_purpose_at`, `by_at` | inserted by `record` and `withdraw`; deleted by `prune` |
| `consentState`  | `(subjectRef, purpose)` pair      | `by_subject_purpose`             | written by `record`, patched by `withdraw`              |

A ledger row is never edited. `consentState` holds the latest decision for each
pair and is never deleted, not even by `prune`.

## Client

### `Consent`

```ts
new Consent<TProof = unknown>(component: ConsentComponent, options?: ConsentOptions<TProof>)
```

`component` is the mounted component, `components.consent` (or the name passed
to `app.use`). `options.defaultVersion` defaults to `"1"`.
`options.proofValidator` narrows stored proof to `TProof`; see
[`ConsentOptions`](#consentoptions).

Mutating methods (`record`, `withdraw`, `prune`) need a `ctx` with
`runMutation`: a mutation or action context. Reading methods (`check`,
`getState`, `getStatesForSubject`, `history`) need `runQuery`: a query, mutation
or action context.

### `record`

```ts
record(ctx, subjectRef: string, purpose: string, decision: ConsentDecision, opts?: RecordOptions<TProof>): Promise<{ at: number }>
```

Appends one event to the ledger and sets the pair's current state to this
decision. `opts.version` defaults to the client's `defaultVersion`. When
`opts.proof` is set and the client has a `proofValidator`, the validator runs
before the call and its result is stored. `decision` may be `"withdrawn"`:
unlike `withdraw`, `record` does not check the current decision.

Throws `INVALID_ARGUMENT` when `subjectRef`, `purpose` or the resolved `version`
is an empty string. Also throws `INVALID_ARGUMENT` when it would create a new
pair whose `subjectRef` or `purpose` is longer than 512 characters, or store a
`version` longer than 512 characters that differs from the pair's current
version. Characters are counted as Unicode code points, not UTF-16 code units
(JavaScript `.length`). The empty-value check runs first. A pair stored earlier
with longer values stays readable and can be re-recorded with its current
version; `withdraw` is not capped. Nothing is written when it throws. Returns
the event's `at`.

### `withdraw`

```ts
withdraw(ctx, subjectRef: string, purpose: string, proof?: TProof): Promise<{ at: number }>
```

Withdraws a current grant (GDPR Art. 7(3)). Appends a `withdrawn` event that
keeps the version of the current grant, and sets the current state to
`withdrawn` with the new `at` (the version is unchanged). `proof` goes through
`proofValidator` like in `record`.

Throws `INVALID_ARGUMENT` for an empty `subjectRef` or `purpose`, `NO_CONSENT`
when the pair has no recorded decision, and `NOT_GRANTED` when the current
decision is `denied` or `withdrawn`. Nothing is written when it throws.

### `check`

```ts
check(ctx, subjectRef: string, purpose: string, requiredVersion?: string): Promise<ConsentCheck>
```

The gate to call before processing personal data. Reads the pair's current state
with one index lookup:

- No recorded decision:
  `{ granted: false, stale: false, decision: null, version: null, at: null }`.
- Current decision `granted` and (`requiredVersion` omitted or equal to the
  stored `version`): `granted: true, stale: false`.
- Current decision `granted` and `requiredVersion !== version`:
  `granted: false, stale: true`. The comparison is string equality, not version
  order, so a newer stored version is also `stale`.
- Current decision `denied` or `withdrawn`: `granted: false, stale: false`.

`decision`, `version` and `at` mirror the current state.

### `getState`

```ts
getState(ctx, subjectRef: string, purpose: string): Promise<ConsentState | null>
```

The pair's current state, or `null` if no decision was ever recorded.

### `getStatesForSubject`

```ts
getStatesForSubject(ctx, subjectRef: string): Promise<ConsentState[]>
```

The current state of every purpose recorded for `subjectRef`, in index order of
`purpose`: by UTF-8 bytes (Unicode code point order), not locale, so uppercase
sorts before lowercase (`Alpha` before `ads`). It reads them all in one query,
without pagination.

### `history`

```ts
history(ctx, subjectRef: string, purpose: string, paginationOpts: PaginationOptions): Promise<PaginationResult<ConsentEvent<TProof>>>
```

One page of the pair's ledger events, newest first. `paginationOpts` is the
standard Convex `PaginationOptions`: start with `{ cursor: null, numItems: 50 }`
and pass the returned `continueCursor` until `isDone`. Events already deleted by
`prune` are gone. When the client has a `proofValidator`, it runs on the `proof`
of every returned event that has one; if it throws, `history` throws.

### `prune`

```ts
prune(ctx, opts?: { before?: number; batch?: number }): Promise<number>
```

Deletes up to `batch` ledger events with `at < before`, oldest first. `before`
defaults to now minus 365 days (`31_536_000_000` ms); `batch` defaults to 200
and must be an integer from 1 to 500. When a full batch was deleted, the
component schedules the next batch itself with the same `before` and `batch`,
until a batch comes back short. Returns the count deleted by the first batch
only.

Events are deleted by age only, including the proof of a pair's current
decision. `consentState` is never pruned, so `check` and `getState` still
answer. Throws `INVALID_BATCH` for a `batch` outside 1..500 or not an integer,
and `INVALID_BEFORE` for a `before` that is not finite.

The component also runs `prune` itself; see [Built-in cron](#built-in-cron).

## Types

### `ConsentComponent`

The type of `components.consent`: the component's `mutations.record`,
`mutations.withdraw`, `mutations.prune`, `queries.check`, `queries.getState`,
`queries.getStatesForSubject` and `queries.history` function references, with
`proof` typed `unknown`. Pass `components.consent` (or your mount name) to
`new Consent(...)`.

### `ConsentOptions`

```ts
interface ConsentOptions<TProof> {
  defaultVersion?: string;
  proofValidator?: Parser<TProof>;
}
```

- `defaultVersion`: the version `record` stores when `opts.version` is omitted.
  Default `"1"`. `check` does not use it; pass `requiredVersion` yourself.
- `proofValidator`: runs on the `proof` passed to `record` and `withdraw`
  (before storage) and on every `proof` returned by `history`. It must return a
  `TProof` or throw. Without it, proof is stored as given and cast to `TProof`
  on read. `convex/values` validators have no `.parse`; use a hand-written
  parser or a library parser such as Zod's `.parse`.

### `RecordOptions`

```ts
interface RecordOptions<TProof> {
  version?: string;
  proof?: TProof;
}
```

Options of `record`: the policy version of this decision (default: the client's
`defaultVersion`) and the proof to store with it.

### `ConsentDecision`

```ts
type ConsentDecision = "granted" | "denied" | "withdrawn";
```

### `ConsentCheck`

```ts
interface ConsentCheck {
  granted: boolean;
  stale: boolean;
  decision: ConsentDecision | null;
  version: string | null;
  at: number | null;
}
```

Result of `check`; see [`check`](#check) for when each flag is set.

### `ConsentState`

```ts
interface ConsentState {
  subjectRef: string;
  purpose: string;
  decision: ConsentDecision;
  version: string;
  at: number;
}
```

The latest decision for one `(subjectRef, purpose)` pair.

### `ConsentEvent`

```ts
interface ConsentEvent<TProof = unknown> {
  subjectRef: string;
  purpose: string;
  decision: ConsentDecision;
  version: string;
  proof?: TProof;
  at: number;
}
```

One ledger event, as returned by `history`.

### `Parser`

```ts
type Parser<T> = (value: unknown) => T;
```

The shape of `proofValidator`: return the typed value or throw.

## Component config

### `convex.config`

```ts
import consent from "@vllnt/convex-consent/convex.config";
```

The component definition, named `consent`. Pass it to `app.use(consent)`, or
`app.use(consent, { name })` for another mount; each mount has its own tables
and its own cron.

## Testing

### `register`

```ts
register<TSchema extends GenericSchema>(t: TestConvex<SchemaDefinition<TSchema, boolean>>, name = "consent"): void
```

Mounts the component in a `convex-test` instance built from your own schema.
`name` defaults to `"consent"`; pass the mount name used in `app.use`. The entry
is TypeScript source that uses Vite's `import.meta.glob`, so run it under Vitest
(with `convex-test`, `vite` and `@edge-runtime/vm` installed).

## Generated types

### `ComponentApi`

```ts
import type { ComponentApi } from "@vllnt/convex-consent/_generated/component";
```

The generated type of the mounted component's functions, from Convex codegen.
Most hosts use `ConsentComponent` through `Consent` instead.

## Error codes

The component throws `ConvexError` with `data: { code, message }`:

| Code               | Thrown by            | Message                                                                                         | Meaning                                                                 |
| ------------------ | -------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `INVALID_ARGUMENT` | `record`, `withdraw` | `<field> must be non-empty`                                                                     | `subjectRef`, `purpose` or (for `record`) `version` is an empty string. |
| `INVALID_ARGUMENT` | `record`             | `<field> must be at most 512 characters (Unicode code points)`                                  | A new pair's `subjectRef` or `purpose`, or a `version` that differs from the pair's current one, is over 512 Unicode code points. |
| `NO_CONSENT`       | `withdraw`           | `no consent recorded for "<subjectRef>" / "<purpose>"`                                          | The pair has no recorded decision.                                      |
| `NOT_GRANTED`      | `withdraw`           | `consent for "<subjectRef>" / "<purpose>" is "<decision>", not "granted" — nothing to withdraw` | The current decision is `denied` or `withdrawn`.                        |
| `INVALID_BATCH`    | `prune`              | `batch must be an integer between 1 and 500`                                                    | `batch` is below 1, above 500, fractional or not finite.                |
| `INVALID_BEFORE`   | `prune`              | `before must be finite`                                                                         | `before` is `NaN` or infinite.                                          |

Wrong argument types are rejected by Convex argument validation before the
component runs. Errors thrown by a `proofValidator` are the host's own errors.

## Built-in cron

Every mount registers its own cron job. Its first run happens right after the
mount is first deployed, then every 24 hours; redeploying an unchanged cron does
not add a run:

| Job             | Cadence        | Action                                                                  |
| --------------- | -------------- | ----------------------------------------------------------------------- |
| `consent:prune` | every 24 hours | `prune` with `batch: 200` and the default `before` (now minus 365 days) |

The cadence is fixed in the component and cannot be turned off or changed. A
host can run extra sweeps with its own `before` cutoff to delete events sooner;
a later cutoff cannot keep events longer, because the built-in cron still
deletes them after 365 days.
