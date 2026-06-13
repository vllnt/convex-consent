<!-- Badges -->
[![convex-component](https://img.shields.io/badge/convex-component-EE342F.svg)](https://www.convex.dev/components)
[![npm](https://img.shields.io/npm/v/@vllnt/convex-consent.svg)](https://www.npmjs.com/package/@vllnt/convex-consent)
[![CI](https://github.com/vllnt/convex-consent/actions/workflows/ci.yml/badge.svg)](https://github.com/vllnt/convex-consent/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@vllnt/convex-consent.svg)](./LICENSE)

# @vllnt/convex-consent

An append-only consent ledger (GDPR Art. 6/7), as a Convex component.

The host records a subject's decision for a purpose (`granted` / `denied` /
`withdrawn`) — each call appends an immutable ledger event (the legal proof) and
updates an O(1) current-state projection. Before processing personal data, the
host asks `check("may I process <purpose> for <subject>?")` and gets a yes/no gate
back. When the privacy policy version changes, a prior grant goes `stale` so the
host re-prompts. Domain-neutral: a cookie/analytics gate, a marketing opt-in, a
device-tied consent — purposes are config, `subjectRef` is an opaque host string.
The host owns the subject, the purpose meaning, and auth; this component owns only
the consent record.

## Features

- **Record-and-gate** — `record(subjectRef, purpose, decision, { version?, proof? })` appends an immutable event and updates the projection; `check(subjectRef, purpose, requiredVersion?)` is the O(1) runtime gate the host calls before processing.
- **Append-only ledger** — every decision is a new `consentEvents` row that is never mutated, only swept by retention `prune`. The immutability *is* the GDPR proof. `history(subjectRef, purpose, paginationOpts)` pages the full trail for an audit or a data subject request.
- **Easy withdrawal** — `withdraw(subjectRef, purpose, proof?)` (GDPR Art. 7(3)) revokes a grant, but only when one is currently held; withdrawing something never granted throws a coded error so the trail stays meaningful.
- **Version staleness** — `check` compares the consented `version` against the host's `requiredVersion`; a grant for an older policy version returns `stale: true` (and `granted: false`) so the host re-prompts. The part that's easy to get wrong hand-rolled.
- **Server-sourced time** — every event's `at` is stamped from the server clock inside the handler; a caller can never supply a timestamp, so the ledger order can't be skewed.
- **Typed, opaque proof** — `Consent<TProof>` types the stored `proof` end to end; pass `proofValidator` to narrow the opaque value at the boundary (no unchecked cast, no `v.any()` dump). The component stores it opaquely.
- **Bounded prune + cron** — a built-in daily cron sweeps superseded ledger events past a retention window in bounded batches and self-reschedules; the current-state projection is never pruned, so the gate stays correct.
- **Mount-safe** — runs correctly under multiple named `app.use` mounts; each instance is an isolated sandbox (web + marketing consent on one backend, say).

## Architecture

```
src/
├── shared.ts              # constants (component name, decisions, default version, retention, batch)
├── test.ts                # convex-test register() helper
├── client/                # Consent class (the public API)
└── component/             # schema (consentEvents + consentState) + mutations + queries + prune cron
```

Sandboxed tables:

- `consentEvents {subjectRef, purpose, decision, version, proof?, at}` — the
  append-only ledger, indexed `by_subject_purpose_at` (history) and `by_at`
  (retention sweep).
- `consentState {subjectRef, purpose, decision, version, at}` — the current
  projection (one row per pair), indexed `by_subject_purpose` (the O(1) gate) and
  `by_subject` (all purposes for a subject).

No host tables are touched. A built-in cron (`crons.ts`) prunes superseded ledger
events daily; the projection is never pruned.

## Installation

```bash
pnpm add @vllnt/convex-consent
```

Peer dependency: `convex@^1.41.0`.

## Usage

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import consent from "@vllnt/convex-consent/convex.config";

const app = defineApp();
app.use(consent);
export default app;
```

```ts
// convex/consent.ts — host owns auth; pass an opaque subjectRef in.
import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { Consent } from "@vllnt/convex-consent";

const consent = new Consent<{ policyHash: string }>(components.consent, {
  defaultVersion: "2024-policy",
  proofValidator: v.object({ policyHash: v.string() }).parse, // narrow at the boundary
});

// 1) Record a subject's decision (host resolved identity → subjectRef).
export const setConsent = mutation({
  args: { purpose: v.string(), granted: v.boolean(), policyHash: v.string() },
  handler: async (ctx, { purpose, granted, policyHash }) => {
    const subjectRef = await resolveSubject(ctx); // host-owned auth
    await consent.record(ctx, subjectRef, purpose, granted ? "granted" : "denied", {
      proof: { policyHash },
    });
  },
});

// 2) Gate processing on the current consent (reactively, in a Convex query).
export const mayProcess = query({
  args: { purpose: v.string() },
  handler: async (ctx, { purpose }) => {
    const subjectRef = await resolveSubject(ctx);
    const gate = await consent.check(ctx, subjectRef, purpose, "2024-policy");
    return gate.granted; // false (and gate.stale === true) if they consented to an older policy
  },
});

// 3) Withdraw (GDPR Art. 7(3)) — appends a withdrawn event.
export const revoke = mutation({
  args: { purpose: v.string() },
  handler: async (ctx, { purpose }) => {
    const subjectRef = await resolveSubject(ctx);
    await consent.withdraw(ctx, subjectRef, purpose);
  },
});
```

## API Reference

See [docs/API.md](docs/API.md). Summary:

| Method | Kind | Result |
|--------|------|--------|
| `record(ctx, subjectRef, purpose, decision, opts?)` | mutation | `{ at }` (`decision`: `"granted" \| "denied" \| "withdrawn"`; `opts`: `{ version?; proof? }`) |
| `withdraw(ctx, subjectRef, purpose, proof?)` | mutation | `{ at }` |
| `check(ctx, subjectRef, purpose, requiredVersion?)` | query | `ConsentCheck` (`{ granted; stale; decision; version; at }`) |
| `getState(ctx, subjectRef, purpose)` | query | `ConsentState \| null` |
| `getStatesForSubject(ctx, subjectRef)` | query | `ConsentState[]` |
| `history(ctx, subjectRef, purpose, paginationOpts)` | query | `PaginationResult<ConsentEvent>` |
| `prune(ctx, opts?)` | mutation | `number` (ledger events removed in the first bounded pass) |

Client options:
`new Consent(component, { defaultVersion?, proofValidator? })`.
`prune` opts: `{ before?; batch? }` (defaults `before = Date.now()`, `batch = 200`).

## React

This component ships **backend-only** — no `./react` entry. Consent state is read
through ordinary reactive `useQuery` over the host's own re-exported `check` /
`getState` function refs (those return live in Convex), so a dedicated hook would
wrap the host's `api` with no added value. Consent proof is sensitive and the
gating is server-side, so there is no safe client surface to add. If a future
consumer needs a shared management surface the analysis will be re-run (per the
Component Standard's front-end tooling decision).

## Security Model

The component is **auth-agnostic**: it never authenticates or authorizes. The host
resolves identity, decides whether a caller may record or read a subject's
consent, and passes an opaque `subjectRef`. Component tables are sandboxed — the
host reaches them only through the exported functions, and the component never
reads host or sibling tables. `subjectRef`, `purpose`, and the stored `proof` are
opaque to the component; it never inspects or de-references them.

**The ledger is append-only**, so a recorded decision (and its proof) can never be
silently rewritten — withdrawal is a new event, not an edit. **Time is
server-sourced** — every event's `at` comes from `Date.now()` inside the handler,
never from the caller. The host may narrow the opaque `proof` with `proofValidator`,
applied at the client boundary on both write and read.

## Testing

```bash
pnpm test           # single run
pnpm test:coverage  # enforced 100% on covered files
```

Tests run against the real component runtime via `convex-test` (`@edge-runtime/vm`), not mocks.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Author

Built by [bntvllnt](https://github.com/bntvllnt) · [bntvllnt.com](https://bntvllnt.com) · [X @bntvllnt](https://x.com/bntvllnt)

Part of the [@vllnt](https://github.com/vllnt) Convex component fleet — [vllnt.com](https://vllnt.com)

If this is useful, [sponsor the work](https://github.com/sponsors/bntvllnt).

## License

MIT — see [LICENSE](LICENSE).
