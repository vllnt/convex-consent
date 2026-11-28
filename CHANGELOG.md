# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-11-28

### Added

- Ship `docs/API.md`, `CHANGELOG.md` and `llms.txt` in the npm tarball, so coding agents read
  docs that match the installed version from `node_modules/@vllnt/convex-consent/`. `llms.txt`
  links shipped files by relative path and gains a "For coding agents" note and an ecosystem
  link; the README gains the same note and a "Related packages" section.
- `docs/API.md` documents the package entry points (`./test`, `./convex.config`,
  `./_generated/component`) and the client options.
- `pnpm test:package`, which `pnpm build` now runs (so CI and the publish workflow run it), fails
  when a required file is missing from the tarball, when Markdown outside the shipped docs set (such
  as a contributor or internal doc) is packed, or when an `llms.txt` link does not resolve inside the
  tarball.
- `pnpm check:docs` (run by `pnpm lint`) enforces the docs contract in
  `scripts/check-documentation.mjs`: README sections and order, install and first example in the
  first 40 lines, tagged code blocks, resolving relative links and anchors, every public export
  (with a TSDoc summary) and every thrown error code documented in the README and `docs/API.md`,
  and the shared Links block, footer and `llms.txt` Ecosystem block. `pnpm test:package` runs the
  same contract on the installed tarball, type-checks every README example against the built
  package (convex 1.45.0, `Bundler` and `NodeNext` resolution) and runs the README test example.
- TSDoc summary on the `convex.config` default export and an `@see` link to the package page on
  `Consent`. Comment-only; no runtime or type change.

### Changed

- The README is rewritten for coding agents: when to use it (and what to use instead), install,
  a quick start with a host mutation and query, an API table of every export, common tasks,
  every error code with its cause and fix, limits and gotchas, compatibility, testing, and links.
  `docs/API.md` gains one heading per export, the data model, every message per error code and
  the built-in cron. `llms.txt` gains a "When to use" section, links to both error tables and the
  shared ecosystem links. "Related packages" now says there are none; the former entries move to
  "When to use".
- One description, used in `package.json`, the README and `llms.txt`: "TypeScript Convex
  component for GDPR consent: append-only ledger of granted, denied and withdrawn decisions per
  subject and purpose, with a version check." Keywords now cover the problem and the stack.

- Drop the `consentState.by_subject` index: it was a prefix of `by_subject_purpose`, which now serves
  `getStatesForSubject` (results ordered by `purpose`). Saves one index entry per state row.
- `homepage` points at the package page on oss.vllnt.com.
- Canary publishes on every push to `main` that touches the package or its shipped docs; the
  repository-variable gate is removed. It publishes under the `canary` dist-tag only and never moves
  `latest`.
- Upgrade dev tooling to convex 1.51, convex-test 0.0.73, vitest and `@vitest/coverage-v8` 5.1.1,
  vite 8.3, prettier 3.10 and `@vllnt/typescript` 3 (with `exactOptionalPropertyTypes` kept off),
  and override the vulnerable transitive `handlebars`, `deepmerge-ts` and `minimatch` releases.
  The built `dist` and the `convex@^1.45.0` peer range are unchanged.
- Adopt pnpm 10 with a release-age gate; releases are published only from CI with npm
  trusted publishing and provenance.

### Fixed

- `record` rejects an empty `subjectRef`, `purpose` or `version`, and `withdraw` an empty
  `subjectRef` or `purpose`, with `ConvexError({ code: "INVALID_ARGUMENT" })`.
- `@vllnt/convex-consent/test` now type-checks under `moduleResolution: nodenext`
  (explicit `.js` relative imports, Vite client types referenced).
- Documentation drift: the shipped `prune` comments now say events are not checked for being
  superseded and that `before` defaults to now minus 365 days; the `proofValidator` comments no
  longer claim `convex/values` validators have a `.parse`; `docs/API.md` states which `ctx` each
  method needs.
- `register` from `@vllnt/convex-consent/test` accepts the host app's own
  `convexTest(hostSchema, modules)` instance: it was typed against the component schema, so a host
  schema with its own tables failed with TS2345. Type-only; tests and the example are now
  type-checked in CI (`pnpm typecheck:ci` runs `pnpm typecheck:tests`).
- The package contents check now denies packed `*.spec.mts` and `*.spec.cts` files, like
  `*.test.mts` and `*.test.cts`; its self-test runs in `pnpm test:package` (so in `pnpm build`).

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
