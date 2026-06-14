<!-- Badges -->
[![convex-component](https://img.shields.io/badge/convex-component-EE342F.svg)](https://www.convex.dev/components)
[![npm](https://img.shields.io/npm/v/@vllnt/convex-consent.svg)](https://www.npmjs.com/package/@vllnt/convex-consent)
[![CI](https://github.com/vllnt/convex-consent/actions/workflows/ci.yml/badge.svg)](https://github.com/vllnt/convex-consent/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@vllnt/convex-consent.svg)](./LICENSE)

# @vllnt/convex-consent

An append-only consent ledger (GDPR Art. 6/7), as a Convex component.

```ts
const consent = new Consent(components.consent);
await consent.record(ctx, subjectRef, "analytics", "granted");
const gate = await consent.check(ctx, subjectRef, "analytics"); // { granted, stale, ... }
```

The host records a subject's decision for a purpose (`granted` / `denied` /
`withdrawn`) — each call appends an immutable ledger event (the legal proof) and
updates an O(1) current-state projection — then gates processing with `check`. When
the policy version changes, a prior grant goes `stale` so the host re-prompts.
Domain-neutral: a cookie gate, a marketing opt-in, a device-tied consent.

## Features

- **Record-and-gate** — `record` appends an immutable event and updates the projection; `check` is the O(1) runtime gate before processing.
- **Append-only ledger** — every decision is a `consentEvents` row, never mutated; `history` pages the full trail for an audit or DSR.
- **Easy withdrawal** — `withdraw` (Art. 7(3)) revokes a held grant; withdrawing something never granted throws a coded error.
- **Version staleness** — `check` returns `stale: true` when a grant is for an older policy version than `requiredVersion`.
- **Server-sourced time** — every event's `at` is stamped from the server clock; a caller can never supply a timestamp.
- **Typed, opaque proof** — `Consent<TProof>` with an optional `proofValidator` narrows the stored evidence at the boundary.
- **Bounded prune + cron** — a daily cron sweeps superseded ledger events past retention; the live projection is never pruned.
- **Mount-safe** — correct under multiple named `app.use` mounts (web + marketing consent on one backend), each an isolated sandbox.

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
  proofValidator: v.object({ policyHash: v.string() }).parse,
});

// Record a decision, gate processing on it, and withdraw — host resolves identity → subjectRef.
export const setConsent = mutation({
  args: { purpose: v.string(), granted: v.boolean(), policyHash: v.string() },
  handler: async (ctx, { purpose, granted, policyHash }) => {
    const subjectRef = await resolveSubject(ctx);
    await consent.record(ctx, subjectRef, purpose, granted ? "granted" : "denied", { proof: { policyHash } });
  },
});

export const mayProcess = query({
  args: { purpose: v.string() },
  handler: async (ctx, { purpose }) => {
    const subjectRef = await resolveSubject(ctx);
    const gate = await consent.check(ctx, subjectRef, purpose, "2024-policy");
    return gate.granted; // false (gate.stale === true) if they consented to an older policy
  },
});

export const revoke = mutation({
  args: { purpose: v.string() },
  handler: async (ctx, { purpose }) => consent.withdraw(ctx, await resolveSubject(ctx), purpose),
});
```

Client options: `new Consent(component, { defaultVersion?, proofValidator? })`.

## API Reference

| Method | Kind | Result |
|--------|------|--------|
| `record(ctx, subjectRef, purpose, decision, opts?)` | mutation | `{ at }` (`decision`: `"granted" \| "denied" \| "withdrawn"`; `opts`: `{ version?; proof? }`) |
| `withdraw(ctx, subjectRef, purpose, proof?)` | mutation | `{ at }` |
| `check(ctx, subjectRef, purpose, requiredVersion?)` | query | `ConsentCheck` (`{ granted; stale; decision; version; at }`) |
| `getState(ctx, subjectRef, purpose)` | query | `ConsentState \| null` |
| `getStatesForSubject(ctx, subjectRef)` | query | `ConsentState[]` |
| `history(ctx, subjectRef, purpose, paginationOpts)` | query | `PaginationResult<ConsentEvent>` |
| `prune(ctx, opts?)` | mutation | `number` (ledger events removed in the first bounded pass) |

Full reference: [docs/API.md](docs/API.md).

## React

Backend-only — no `./react` entry. Consent state is read through an ordinary
reactive `useQuery` over the host's re-exported `check` / `getState` refs; consent
proof is sensitive and gating is server-side, so there is no safe client surface.

## Security

- **Auth-agnostic** — the host authenticates the caller, decides who may record/read a subject's consent, and passes an opaque `subjectRef`; tables are sandboxed.
- **Append-only** — a recorded decision and its proof can never be silently rewritten; withdrawal is a new event, not an edit.
- **Server-sourced time** — every event's `at` comes from `Date.now()` in the handler, never the caller; the `proof` is opaque, narrowed by the host validator.

See [docs/API.md](docs/API.md).

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
