# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-11-28

### Added

- `docs/API.md`, `CHANGELOG.md` and `llms.txt` ship in the npm tarball, so coding agents read
  docs that match the installed version from `node_modules/@vllnt/convex-consent/`. `llms.txt`
  links the shipped files by relative path.
- `docs/API.md` documents every export under its own heading, the package entry points
  (`./test`, `./convex.config`, `./_generated/component`), the client options, which `ctx` each
  method needs, the data model, every message per error code and the built-in cron.
- TSDoc summary on the `convex.config` default export and an `@see` link to the package page on
  `Consent`. Comment-only; no runtime or type change.

### Changed

- Breaking: `record` rejects an empty `subjectRef`, `purpose` or `version`, and `withdraw` an
  empty `subjectRef` or `purpose`, with `ConvexError({ code: "INVALID_ARGUMENT" })`; 0.1.0
  accepted them. Pass non-empty strings: `record` stored empty values as meaningless ledger rows.
  Rows that 0.1.0 stored with an empty `subjectRef` or `purpose` stay readable through `check` and
  `getState` but can no longer be updated or withdrawn.
- `engines.node` is now `>=20` (was `>=18`), what convex 1.45 itself requires. Run on Node.js 20
  or later, and 22 or later with convex 1.49 and newer.
- The peer dependency is unchanged: `convex@^1.45.0`.
- Drop the `consentState.by_subject` index: it was a prefix of `by_subject_purpose`, which now
  serves `getStatesForSubject`. Results are now sorted by `purpose` (UTF-8 byte order, so
  `Alpha` before `ads`) instead of the order each purpose was first recorded. No data migration
  is needed.
- The README is rewritten for coding agents: when to use it, install, a quick start, an API table
  of every export, every error code with its cause and fix, limits and gotchas, compatibility and
  testing. `llms.txt` gains a "When to use" section and links to both error tables.
- One description in `package.json`, the README and `llms.txt`; keywords cover the problem and the
  stack; `homepage` points at the package page on oss.vllnt.com.
- Internal: CI, tests, the release workflow (canary on every push to `main`, under the `canary`
  dist-tag only), package and docs checks, a 7-day release-age gate and dev-dependency upgrades.

### Fixed

- `register` from `@vllnt/convex-consent/test` accepts the host app's own
  `convexTest(hostSchema, modules)` instance: it was typed against the component schema, so a host
  schema with its own tables failed with TS2345. Type-only.
- `@vllnt/convex-consent/test` now type-checks under `moduleResolution: nodenext`
  (explicit `.js` relative imports, Vite client types referenced).
- Documentation corrections in the shipped TSDoc and docs: `prune` deletes events by age, not only
  superseded ones, and `before` defaults to now minus 365 days; `check` staleness is string
  inequality, not version order; `history` returns only the events not yet pruned; without
  `proofValidator` the stored `proof` is returned unchecked; `convex/values` validators have no
  `.parse` to pass as `proofValidator`.

## [0.1.0] - 2026-09-01

### Added

- First release of `@vllnt/convex-consent` — an append-only consent ledger
  (GDPR Art. 6/7) per `(subjectRef, purpose)`.
- `record(subjectRef, purpose, decision, { version?, proof? })` appends an
  immutable `consentEvents` row (the legal proof) and updates the O(1)
  `consentState` projection; `decision` is `granted`/`denied`/`withdrawn`.
- `withdraw(subjectRef, purpose, proof?)` (GDPR Art. 7(3)) revokes a grant by
  appending a `withdrawn` event — only when a grant is currently held, else throws
  `ConvexError({ code: "NO_CONSENT" })` or `ConvexError({ code: "NOT_GRANTED" })`.
- `check(subjectRef, purpose, requiredVersion?)` is the runtime gate, returning
  `{ granted, stale, decision, version, at }`; a grant for an older policy version
  returns `stale: true` so the host re-prompts.
- `getState`, `getStatesForSubject`, and paginated `history` read the record;
  `history` pages the immutable ledger newest-first for an audit or data subject
  request.
- Append-only ledger: a recorded decision is never mutated — withdrawal is a new
  event, not an edit — so the proof trail can't be silently rewritten.
- Server-sourced time: every event's `at` is stamped from `Date.now()` inside the
  handler — no caller-supplied clock.
- Typed generics: `Consent<TProof>` with an optional `proofValidator` host parser
  narrowing the opaque stored `proof` at the client boundary on write and read — no
  `v.any()` dump, no unchecked cast — plus a configurable `defaultVersion`.
- Bounded, self-rescheduling `prune` (`take(batch)` + scheduler) that removes only
  superseded ledger events past the cutoff, plus a built-in daily prune cron
  (`crons.ts`); idempotent. The current-state projection is never pruned. Default
  retention 365 days.
- Mount-safe: correct under multiple `app.use(component, { name })` mounts — each
  instance is sandboxed, the cron is registered per instance.

### Fixed

- Apply the documented 365-day default ledger retention and reject invalid prune batches to
  prevent premature proof deletion and scheduler loops.

### Changed

- Treat Convex `_generated` output as CLI-owned, exclude it from formatting, and expose a
  dedicated codegen script.
- Refresh all direct dependencies to their latest compatible releases.
- Require `convex@^1.45.0` and update `convex-test` to `^0.0.56`.
