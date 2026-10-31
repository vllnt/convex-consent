# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - Unreleased

### Fixed

- `record` rejects an empty `subjectRef`, `purpose` or `version`, and `withdraw` an empty
  `subjectRef` or `purpose`, with `ConvexError({ code: "INVALID_ARGUMENT" })`.
- `@vllnt/convex-consent/test` now type-checks under `moduleResolution: nodenext`
  (explicit `.js` relative imports, Vite client types referenced).

### Changed

- Upgrade dev tooling (vitest 5, vite 8.3, convex 1.48, convex-test 0.0.65, prettier 3.9.10) and
  override the vulnerable transitive `handlebars` and `deepmerge-ts` releases.
- Adopt pnpm 10 with a release-age gate; releases are published only from CI with npm
  trusted publishing and provenance.

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
