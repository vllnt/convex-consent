# @vllnt/convex-consent

TypeScript Convex component for GDPR consent: append-only ledger of granted,
denied and withdrawn decisions per subject and purpose, with a version check.

## For coding agents

Docs for the installed version are in `node_modules/@vllnt/convex-consent/`:
`docs/API.md`, `llms.txt`, `CHANGELOG.md` and the TypeScript `src/`. Read them
before writing code against this package.

## When to use

- Use it when you must show what a subject agreed to, for which purpose, when.
- Use it when server code must check consent before processing personal data.
- Use it when a new policy version must make users answer the prompt again.
- Do not use it when you need a do-not-contact list checked before each send: use
  [`@vllnt/convex-suppression`](https://oss.vllnt.com/packages/convex-suppression).
- Do not use it when you need cookie-banner state in a React app: use
  [`@vllnt/analytics`](https://oss.vllnt.com/packages/analytics).

## Install

```bash
pnpm add @vllnt/convex-consent
```

## Quick start

```ts
// convex/convex.config.ts
import consent from "@vllnt/convex-consent/convex.config";
import { defineApp } from "convex/server";

const app = defineApp();
app.use(consent);
export default app;
```

```ts
// convex/consent.ts
import { Consent } from "@vllnt/convex-consent";
import { ConvexError, v } from "convex/values";

import { components } from "./_generated/api.js";
import { mutation, query } from "./_generated/server.js";

export const POLICY_VERSION = "2026-11";

const consent = new Consent(components.consent, {
  defaultVersion: POLICY_VERSION,
});

export const setAnalyticsConsent = mutation({
  args: { granted: v.boolean() },
  returns: v.number(),
  handler: async (ctx, { granted }) => {
    const user = await ctx.auth.getUserIdentity();
    if (user === null) throw new ConvexError("not signed in");
    const decision = granted ? "granted" : "denied";
    const { at } = await consent.record(
      ctx,
      user.tokenIdentifier,
      "analytics",
      decision,
    );
    return at;
  },
});

export const mayTrack = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const user = await ctx.auth.getUserIdentity();
    if (user === null) return false;
    const gate = await consent.check(
      ctx,
      user.tokenIdentifier,
      "analytics",
      POLICY_VERSION,
    );
    return gate.granted;
  },
});
```

Run `npx convex dev` once to generate `components.consent`. The component never
reads auth: the host derives `subjectRef` (here the user's `tokenIdentifier`)
and decides who may record or read it. `purpose` is any string you choose.

[![npm](https://img.shields.io/npm/v/@vllnt/convex-consent.svg)](https://www.npmjs.com/package/@vllnt/convex-consent)
[![CI](https://github.com/vllnt/convex-consent/actions/workflows/ci.yml/badge.svg)](https://github.com/vllnt/convex-consent/actions/workflows/ci.yml)

## API

Full reference: [docs/API.md](docs/API.md).

| Export                                                                     | Import from                                  | What it does                                                           |
| -------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------- |
| [`Consent`](docs/API.md#consent)                                           | `@vllnt/convex-consent`                      | Host client: `new Consent(components.consent, options?)`               |
| [`record(ctx, subjectRef, purpose, decision, opts?)`](docs/API.md#record)  | `Consent` method, mutation                   | Append a decision to the ledger and update the current state; `{ at }` |
| [`withdraw(ctx, subjectRef, purpose, proof?)`](docs/API.md#withdraw)       | `Consent` method, mutation                   | Withdraw a current grant; throws if there is none; `{ at }`            |
| [`check(ctx, subjectRef, purpose, requiredVersion?)`](docs/API.md#check)   | `Consent` method, query                      | The gate: `{ granted, stale, decision, version, at }`                  |
| [`getState(ctx, subjectRef, purpose)`](docs/API.md#getstate)               | `Consent` method, query                      | Current decision for one pair, or `null`                               |
| [`getStatesForSubject(ctx, subjectRef)`](docs/API.md#getstatesforsubject)  | `Consent` method, query                      | Current decision for every purpose of one subject                      |
| [`history(ctx, subjectRef, purpose, paginationOpts)`](docs/API.md#history) | `Consent` method, query                      | One page of ledger events, newest first                                |
| [`prune(ctx, opts?)`](docs/API.md#prune)                                   | `Consent` method, mutation                   | Delete ledger events past retention; returns the first batch's count   |
| [`ConsentComponent`](docs/API.md#consentcomponent)                         | `@vllnt/convex-consent` (type)               | Type of `components.consent`                                           |
| [`ConsentOptions`](docs/API.md#consentoptions)                             | `@vllnt/convex-consent` (type)               | `{ defaultVersion?, proofValidator? }`                                 |
| [`RecordOptions`](docs/API.md#recordoptions)                               | `@vllnt/convex-consent` (type)               | `{ version?, proof? }`                                                 |
| [`ConsentDecision`](docs/API.md#consentdecision)                           | `@vllnt/convex-consent` (type)               | `"granted" \| "denied" \| "withdrawn"`                                 |
| [`ConsentCheck`](docs/API.md#consentcheck)                                 | `@vllnt/convex-consent` (type)               | Result of `check`                                                      |
| [`ConsentState`](docs/API.md#consentstate)                                 | `@vllnt/convex-consent` (type)               | Result of `getState`: `{ subjectRef, purpose, decision, version, at }` |
| [`ConsentEvent`](docs/API.md#consentevent)                                 | `@vllnt/convex-consent` (type)               | One ledger event in `history`                                          |
| [`Parser`](docs/API.md#parser)                                             | `@vllnt/convex-consent` (type)               | `(value: unknown) => T`, the shape of `proofValidator`                 |
| [`default` (component config)](docs/API.md#convexconfig)                   | `@vllnt/convex-consent/convex.config`        | Pass to `app.use(...)`                                                 |
| [`register`](docs/API.md#register)                                         | `@vllnt/convex-consent/test`                 | Mount the component in `convex-test`                                   |
| [`ComponentApi`](docs/API.md#componentapi)                                 | `@vllnt/convex-consent/_generated/component` | Generated type of the mounted component                                |

## Common tasks

Store proof with each decision, typed and checked by your own parser. The parser
runs on the proof you write and on every proof `history` returns:

```ts
// convex/proof.ts
import { Consent } from "@vllnt/convex-consent";
import { ConvexError, v } from "convex/values";

import { components } from "./_generated/api.js";
import { mutation } from "./_generated/server.js";

type Proof = { policyHash: string; source: string };

const consent = new Consent<Proof>(components.consent, {
  defaultVersion: "2026-11",
  proofValidator: (value) => {
    if (
      typeof value !== "object" ||
      value === null ||
      !("policyHash" in value) ||
      typeof value.policyHash !== "string" ||
      !("source" in value) ||
      typeof value.source !== "string"
    ) {
      throw new Error("expected { policyHash, source } strings");
    }
    return { policyHash: value.policyHash, source: value.source };
  },
});

export const acceptNewsletter = mutation({
  args: { policyHash: v.string() },
  returns: v.null(),
  handler: async (ctx, { policyHash }) => {
    const user = await ctx.auth.getUserIdentity();
    if (user === null) throw new ConvexError("not signed in");
    await consent.record(ctx, user.tokenIdentifier, "newsletter", "granted", {
      proof: { policyHash, source: "settings page" },
    });
    return null;
  },
});
```

Ask again after a policy change. `check` returns `stale: true` (and
`granted: false`) when the grant's version is not equal to the version you
require:

```ts
// convex/prompt.ts
import { Consent } from "@vllnt/convex-consent";
import { v } from "convex/values";

import { components } from "./_generated/api.js";
import { query } from "./_generated/server.js";

const consent = new Consent(components.consent);

export const analyticsPrompt = query({
  args: {},
  returns: v.union(v.literal("ok"), v.literal("ask"), v.literal("ask again")),
  handler: async (ctx) => {
    const user = await ctx.auth.getUserIdentity();
    if (user === null) return "ask";
    const gate = await consent.check(
      ctx,
      user.tokenIdentifier,
      "analytics",
      "2026-11",
    );
    if (gate.granted) return "ok";
    return gate.stale ? "ask again" : "ask";
  },
});
```

Withdraw consent. `withdraw` throws `NO_CONSENT` or `NOT_GRANTED` when there is
no current grant; catch them to make a "revoke" button safe to press twice, or
call `record(ctx, subjectRef, purpose, "withdrawn")`, which never checks (it
writes a `withdrawn` event even when nothing was granted, with the client's
`defaultVersion` unless you pass `version`):

```ts
// convex/revoke.ts
import { Consent } from "@vllnt/convex-consent";
import { ConvexError, v } from "convex/values";

import { components } from "./_generated/api.js";
import { mutation } from "./_generated/server.js";

const consent = new Consent(components.consent);

export const revoke = mutation({
  args: { purpose: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { purpose }) => {
    const user = await ctx.auth.getUserIdentity();
    if (user === null) throw new ConvexError("not signed in");
    try {
      await consent.withdraw(ctx, user.tokenIdentifier, purpose);
      return true;
    } catch (error) {
      const code =
        error instanceof ConvexError &&
        typeof error.data === "object" &&
        error.data !== null &&
        "code" in error.data
          ? error.data.code
          : undefined;
      if (code === "NO_CONSENT" || code === "NOT_GRANTED") return false;
      throw error;
    }
  },
});
```

Show a subject everything they agreed to, and page through the ledger for an
audit or a data subject access request:

```ts
// convex/settings.ts
import { Consent } from "@vllnt/convex-consent";
import type { ConsentEvent, ConsentState } from "@vllnt/convex-consent";
import type { PaginationOptions, PaginationResult } from "convex/server";

import { components } from "./_generated/api.js";
import type { QueryCtx } from "./_generated/server.js";

const consent = new Consent(components.consent);

export async function currentChoices(
  ctx: QueryCtx,
  subjectRef: string,
): Promise<ConsentState[]> {
  return consent.getStatesForSubject(ctx, subjectRef);
}

export async function ledgerPage(
  ctx: QueryCtx,
  subjectRef: string,
  purpose: string,
  paginationOpts: PaginationOptions,
): Promise<PaginationResult<ConsentEvent>> {
  return consent.history(ctx, subjectRef, purpose, paginationOpts);
}
```

Delete ledger events sooner than the built-in 365 days. Run your own sweep with
a shorter cutoff from a host cron; the built-in daily sweep keeps running:

```ts
// convex/retention.ts
import { Consent } from "@vllnt/convex-consent";
import { v } from "convex/values";

import { components } from "./_generated/api.js";
import { internalMutation } from "./_generated/server.js";

const consent = new Consent(components.consent);
const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;

export const pruneOldProof = internalMutation({
  args: {},
  returns: v.number(),
  handler: (ctx) =>
    consent.prune(ctx, { before: Date.now() - NINETY_DAYS, batch: 500 }),
});
```

```ts
// convex/crons.ts
import { cronJobs } from "convex/server";

import { internal } from "./_generated/api.js";

const crons = cronJobs();
crons.daily(
  "prune consent proof after 90 days",
  { hourUTC: 3, minuteUTC: 0 },
  internal.retention.pruneOldProof,
);
export default crons;
```

Keep two separate ledgers (for example web and marketing consent). Each named
mount has its own tables and its own daily sweep:

```ts
// convex/convex.config.ts
import consent from "@vllnt/convex-consent/convex.config";
import { defineApp } from "convex/server";

const app = defineApp();
app.use(consent, { name: "webConsent" });
app.use(consent, { name: "marketingConsent" });
export default app;
```

```ts
// convex/clients.ts
import { Consent } from "@vllnt/convex-consent";

import { components } from "./_generated/api.js";

export const webConsent = new Consent(components.webConsent);
export const marketingConsent = new Consent(components.marketingConsent);
```

## Errors and fixes

The component throws a `ConvexError` whose `data` is `{ code, message }`. Catch
it in the host with `error instanceof ConvexError` and read `error.data.code`.

| Code               | Message                                                                                         | Cause                                                                                                     | Fix                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `INVALID_ARGUMENT` | `subjectRef must be non-empty` (or `purpose`, `version`)                                        | `record` got an empty `subjectRef`, `purpose` or `version`; `withdraw` an empty `subjectRef` or `purpose` | Pass non-empty strings; do not pass `version: ""`                     |
| `INVALID_ARGUMENT` | `subjectRef must be at most 512 characters (Unicode code points)` (or `purpose`, `version`) | `record` would create a new pair whose `subjectRef` or `purpose` is over 512 code points, or store a new `version` over 512 code points | Shorten or hash long refs and versions before `record` |
| `NO_CONSENT`       | `no consent recorded for "<subjectRef>" / "<purpose>"`                                          | `withdraw` on a pair that has no recorded decision                                                        | Treat as "nothing to withdraw", or call `record(..., "withdrawn")`    |
| `NOT_GRANTED`      | `consent for "<subjectRef>" / "<purpose>" is "<decision>", not "granted" — nothing to withdraw` | `withdraw` when the current decision is `denied` or already `withdrawn`                                   | Treat as "nothing to withdraw", or call `record(..., "withdrawn")`    |
| `INVALID_BATCH`    | `batch must be an integer between 1 and 500`                                                    | `prune` got a `batch` below 1, above 500, fractional or not finite                                        | Pass an integer in 1..500, or omit it (default 200)                   |
| `INVALID_BEFORE`   | `before must be finite`                                                                         | `prune` got `before` that is `NaN` or `Infinity`                                                          | Pass a millisecond timestamp, or omit it (default now minus 365 days) |

Arguments of the wrong type (for example a number `purpose`, or a `decision`
other than the three values) are rejected by Convex argument validation before
the component runs. An error thrown by your `proofValidator` is your own error,
not a `ConvexError` from the component.

## Limits and gotchas

- Version checks compare strings for equality, not order. With
  `requiredVersion: "2"`, a grant for `"10"` or `"3"` is also `stale`.
- `stale` is only ever `true` for a `granted` decision. `check` without
  `requiredVersion` never returns `stale: true`.
- `withdraw` throws `NO_CONSENT` or `NOT_GRANTED` unless the current decision is
  `granted`. The `withdrawn` event keeps the version of the grant it replaces.
- `record` rejects an empty `subjectRef`, `purpose` or `version`, and `withdraw`
  an empty `subjectRef` or `purpose` (`INVALID_ARGUMENT`). Reads with empty
  strings do not throw; they find no consent unless 0.1.0, which accepted empty
  strings, stored one.
- `record` caps `subjectRef`, `purpose` and `version` at 512 characters, counted
  as Unicode code points (an emoji is 1, not 2 as in JavaScript `.length`).
  Longer values throw `INVALID_ARGUMENT`, but only for a new pair or a version
  that differs from the pair's current one: a pair stored earlier with longer
  values stays readable, can be re-recorded with the same version, and
  `withdraw` is never capped. Shorten or hash long refs before `record`.
- Ledger events are kept 365 days. Every mount has its own built-in cron that
  runs `prune` with batch 200 right after the mount is first deployed, then
  every 24 hours; redeploying an unchanged cron does not add a run. It cannot be
  turned off or reconfigured. A later `before` in your own `prune` call cannot
  keep events longer.
- `prune` deletes events by age only, including the proof of a subject's current
  decision. The current state is never deleted, so `check` and `getState` still
  answer after the proof is gone. Export proof first if you must keep it longer.
- `prune` takes `batch` 1..500 (default 200), integers only; other values throw
  `INVALID_BATCH`, they are not clamped. It returns only the count deleted by
  the first batch and schedules the next batches itself when a batch is full.
- `proofValidator` also runs on every proof `history` returns, so if you change
  your proof type, old proof that no longer parses makes `history` throw.
- Without `proofValidator`, `proof` is not checked: it is stored as given (any
  Convex value) and typed as `TProof` on read.
- `getStatesForSubject` reads all purposes of a subject in one query, with no
  pagination; keep the number of purposes per subject small. Results are in
  index order of `purpose`: by UTF-8 bytes (Unicode code point order), not
  locale, so uppercase sorts before lowercase: `Alpha` comes before `ads`.
- Every `at` is the server time in milliseconds. No method lets the caller set
  an event's `at`.
- The component does not read auth. Never accept a `subjectRef` from the client
  without checking that the caller may act for it.

## Compatibility

- Peer dependency: `convex@^1.45.0`. CI runs the unit tests on the locked convex
  version (1.51.0), and type-checks and runs the packed package against convex
  1.45.0.
- Node.js: `engines` is `>=20`, matching convex 1.45 to 1.48; convex 1.49 and
  newer needs Node.js 22 or later. ES modules only.
- `@vllnt/convex-consent/test` needs `convex-test`, `vitest`, `vite` and
  `@edge-runtime/vm`, with the Vitest config shown under Testing.
- React: not applicable. The package is backend-only and has no `./react` entry;
  read consent in the browser through your own query, such as `mayTrack` above.

## Testing

Mount the component in your own `convex-test` suite with `register`. Use the
Vitest settings `convex-test` recommends (edge runtime, `convex-test` inlined):

```ts
// vitest.config.mts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
  },
});
```

```ts
// convex/consent.test.ts
/// <reference types="vite/client" />
import { register } from "@vllnt/convex-consent/test";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";

import { api } from "./_generated/api.js";
import schema from "./schema.js";

test("a granted choice opens the gate", async () => {
  const t = convexTest(schema, import.meta.glob("./**/*.ts"));
  register(t);
  const user = t.withIdentity({ tokenIdentifier: "user-1" });
  expect(await user.query(api.consent.mayTrack, {})).toBe(false);
  await user.mutation(api.consent.setAnalyticsConsent, { granted: true });
  expect(await user.query(api.consent.mayTrack, {})).toBe(true);
  expect(await user.mutation(api.revoke.revoke, { purpose: "analytics" })).toBe(
    true,
  );
  expect(await user.mutation(api.revoke.revoke, { purpose: "analytics" })).toBe(
    false,
  );
});
```

`register(t, name)` takes the mount name when you used
`app.use(consent, { name })`.

This repository's own tests use the simulated `convex-test` runtime
(`pnpm test:coverage`, 100% coverage enforced); `pnpm build` also installs the
packed package, type-checks every README example against it and runs the
README test example.

## Security

- The component does not authenticate. The host must authorize every call and
  derive `subjectRef` itself; never trust a `subjectRef` sent by the client.
- Its tables are reachable only through the component's functions, which the
  host calls from its own server code.
- Ledger events are never edited; a withdrawal is a new event. Only `prune`
  deletes them.
- This package stores consent records; it does not by itself make an app
  compliant with the GDPR.

Report vulnerabilities as described in
[SECURITY.md](https://github.com/vllnt/convex-consent/blob/main/SECURITY.md).

## Related packages

None. This package has no runtime dependency, shared test or example with
another package.

## Contributing

See
[CONTRIBUTING.md](https://github.com/vllnt/convex-consent/blob/main/CONTRIBUTING.md).

## Links

- Docs and changelog: [oss.vllnt.com/packages/convex-consent](https://oss.vllnt.com/packages/convex-consent) · [release feed](https://oss.vllnt.com/packages/convex-consent/rss.xml)
- All @vllnt packages: [oss.vllnt.com](https://oss.vllnt.com) · [search packages and docs on index.vllnt.com](https://index.vllnt.com)
- Source and issues: [GitHub](https://github.com/vllnt/convex-consent) · [issues](https://github.com/vllnt/convex-consent/issues) · [npm](https://www.npmjs.com/package/@vllnt/convex-consent)
- Questions and updates: [Discord](https://bntvllnt.com/discord) · [X @bntvllnt](https://x.com/bntvllnt)
- Company and author: [vllnt.com](https://vllnt.com) · [bntvllnt.com](https://bntvllnt.com) · [GitHub @bntvllnt](https://github.com/bntvllnt) · [LinkedIn](https://linkedin.com/in/bntvllnt)
- Sponsor: [GitHub Sponsors](https://github.com/sponsors/bntvllnt)

## License

MIT. See [LICENSE](LICENSE).

---

Part of [vllnt open source](https://oss.vllnt.com) · [Package page](https://oss.vllnt.com/packages/convex-consent) · [vllnt.com](https://vllnt.com) · Built by [bntvllnt](https://bntvllnt.com)
