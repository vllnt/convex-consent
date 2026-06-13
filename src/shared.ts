/** Shared constants used by both `client/` and `component/`. */

export const COMPONENT_NAME = "consent";

/**
 * The consent decisions a subject can hold for a purpose. `granted` and `denied`
 * are explicit answers to the consent prompt; `withdrawn` revokes a prior grant.
 * Every decision is appended to the immutable ledger and projected onto the
 * current-state row.
 */
export const CONSENT_DECISIONS = ["granted", "denied", "withdrawn"] as const;

/** A single consent decision. */
export type ConsentDecision = (typeof CONSENT_DECISIONS)[number];

/**
 * The default policy version stamped on a decision when the host supplies none.
 * Consent is always versioned so a later policy change can invalidate a stale
 * grant; `"1"` is the sensible zero-config default for a host that hasn't started
 * versioning its policy yet.
 */
export const DEFAULT_VERSION = "1";

/**
 * Default retention (ms) for ledger events before the prune cron sweeps them:
 * 365 days. Consent proof must survive long enough to answer an audit or a data
 * subject request, so the default window is deliberately long. The current-state
 * projection is NEVER pruned — only superseded historical ledger events past the
 * cutoff are removed. A host with a stricter or looser legal window drives
 * `prune` from its own scheduler with an explicit `before` cutoff.
 */
export const DEFAULT_RETENTION_MS = 31_536_000_000;

/** Default page size for a `prune` pass before the sweep self-reschedules. */
export const DEFAULT_PRUNE_BATCH = 200;
