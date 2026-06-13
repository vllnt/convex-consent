<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `example/convex/_generated/ai/guidelines.md` first** for
important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->

# @vllnt/convex-consent

An append-only consent ledger (GDPR Art. 6/7), as a Convex component. The host records a subject's
decision for a purpose (`granted` / `denied` / `withdrawn`) — each call appends an immutable ledger
event (the legal proof) and updates an O(1) current-state projection — then gates processing with
`check`. It follows the vllnt Component Standard (see the `convex-components` hub
`.claude/rules/component-standard.md`).

## Architecture

```
src/
├── shared.ts              # constants: component name, decisions, default version, retention, batch size
├── test.ts                # convex-test register() helper
├── client/
│   ├── index.ts           # Consent<TProof> class (consumer-facing API)
│   └── types.ts           # public TypeScript interfaces
└── component/
    ├── schema.ts           # sandboxed tables: consentEvents (append-only ledger) + consentState (projection)
    ├── convex.config.ts    # defineComponent("consent")
    ├── mutations.ts        # record, withdraw, prune
    ├── queries.ts          # check, getState, getStatesForSubject, history
    ├── validators.ts       # shared validators (consentDecision, consentEventView, consentStateView, consentCheckView, jsonValue)
    └── crons.ts            # daily prune cron (self-rescheduling)
```

Sandboxed tables: `consentEvents` — the append-only ledger, indexed `by_subject_purpose_at` (history)
and `by_at` (retention sweep); `consentState` — the current projection (one row per pair), indexed
`by_subject_purpose` (the O(1) gate) and `by_subject` (all purposes for a subject). No host tables are
touched. The stored `proof` is opaque to the component; the host narrows it via `proofValidator` at the
client boundary.

## Ownership boundary

**Component owns:**

- The consent record — the append-only `consentEvents` ledger AND the derived `consentState` projection
- Server-sourced time — `Date.now()` inside every handler stamps each event's `at`; no caller clock
- The append-only invariant: a ledger row is never mutated; withdrawal is a new event, not an edit
- The current-state projection logic (latest event wins, overwritten per `(subjectRef, purpose)`)
- The version-staleness comparison surfaced by `check`
- The daily prune cron and `prune` mutation (superseded ledger events past retention only — never the projection)

**Host owns:**

- The subject and its meaning (`subjectRef` is an opaque string — a user id, an anon id, a device id)
- The purpose catalog and the policy `version` semantics (what a purpose means, when to bump a version)
- Auth and authorization — whether a caller may record or read a given subject's consent
- The stored `proof` type (`TProof`) — opaque to the component, narrowed by the host validator
- Acting on the gate — the component answers `check`; the host decides what to do with `granted`/`stale`

**Auth:** the component is completely auth-agnostic. The host resolves identity, decides access, and
passes an opaque `subjectRef`. There is no built-in scope dimension — the host namespaces refs itself, or
mounts a second instance (`app.use(component, { name })`) for a static partition (e.g. web vs marketing
consent).

## Key design decisions

- **Append-only ledger is the proof (the core invariant):** `record`/`withdraw` only ever INSERT into
  `consentEvents` — a row is never patched or deleted (except by retention `prune`). Immutability is what
  makes the ledger a defensible GDPR Art. 7(1) record; a withdrawal is a new `withdrawn` event, not an
  edit of the grant. The mutable `consentState` row is a derived projection, not the source of truth.

- **State projection is the O(1) gate:** every event overwrites exactly one `consentState` row per
  `(subjectRef, purpose)`, so `check` is a single indexed `unique()` read rather than a ledger scan. The
  two structures are deliberately split — ledger for proof, projection for speed.

- **Server-sourced time:** every handler stamps each event's `at` from `Date.now()` internally; no API
  surface accepts a caller-supplied timestamp. Ledger order and retention cannot be skewed by a client
  clock.

- **Withdrawal requires a live grant:** `withdraw` throws `NO_CONSENT` (nothing recorded) or
  `NOT_GRANTED` (current decision isn't `granted`) rather than appending a meaningless `withdrawn` event.
  Keeping the trail honest matters more than a silent no-op. A host that wants idempotent revoke calls
  `record(..., "withdrawn")` directly.

- **Versioned consent (the part that's easy to get wrong):** every decision carries a policy `version`;
  `check(requiredVersion)` returns `stale: true` (and `granted: false`) when a grant is for an older
  version, so a policy change re-prompts instead of silently honoring outdated consent. `defaultVersion`
  lets a host bump its policy version in one place.

- **Typed-generic opaque proof, never `v.any()` dumped raw:** `proof` rides through the single documented
  `jsonValue` alias and is narrowed to `TProof` by the host parser at the client boundary on both write
  and read — no unchecked cast. `subjectRef`/`purpose` are opaque host strings the component never
  inspects.

- **Prune is ledger-only + bounded + self-rescheduling:** `prune` removes up to `batch` superseded ledger
  events (default 200) past their `at` cutoff per pass and self-reschedules via `ctx.scheduler` when a
  full batch was removed. The `consentState` projection — the live gate — is NEVER pruned, so the current
  decision survives even after old proof ages out. Idempotent; the built-in daily cron drives it. Default
  retention 365 days (proof must survive an audit window).

- **Backend-only (no `./react` entry):** consent state is read through an ordinary reactive `useQuery`
  over the host's own re-exported `check`/`getState` refs — a dedicated hook would wrap the host's `api`
  with no added value, and consent proof is sensitive with server-side gating (no safe client surface).
  Explicit analysis decision (see README); re-run when a real management-surface consumer appears.

## Conventions

- Mutations in `mutations.ts`, queries in `queries.ts` (enforced by `@vllnt/eslint-config/convex`).
- Explicit `args` + `returns` on every Convex function.
- Host data via typed generics / host validators — never `v.any()` dumps; `jsonValue` is the documented
  last resort for the stored opaque `proof`.
- 100% test coverage is BLOCKING (`vitest.config.mts` thresholds: statements, branches, functions, lines).
- Runtime deps: only official `@convex-dev/*` + `@vllnt/*`.

## Docs sync

| Changed | Update in the same commit |
|---------|--------------------------|
| Public API (record/withdraw/check/getState/getStatesForSubject/history/prune signatures) | README API Reference table, `docs/API.md`, `llms.txt` context, regenerate `llms-full.txt` |
| Config options / defaults (validators, defaultVersion, retention, batch) | README API Reference, `docs/API.md` constructor section |
| Schema / tables / indexes | README Architecture, `docs/API.md` |
| Error codes | `docs/API.md` → `## Error codes` table |
| `peerDependencies.convex` version | `llms.txt` context line (`convex@^X.Y.Z`), `docs/API.md` Compatibility line, README Installation peer note |
| Decisions / version-staleness / append-only semantics | `docs/API.md` mutation+query sections, Key design decisions above |
| Any change | `pnpm generate:llms` to keep `llms-full.txt` current |

Grep old values before committing (e.g. after a `peerDependencies.convex` bump, `git grep "1.41.0"` → only the new range survives).
