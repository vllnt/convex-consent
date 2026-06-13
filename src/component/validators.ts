import { v } from "convex/values";

/**
 * Opaque host-owned proof recorded alongside a consent decision — the evidence
 * that the subject made the choice (a policy hash, an IP, a user agent, a signed
 * token). The component never inspects it; it is last-resort arbitrary data,
 * aliased here rather than left bare in function signatures. The host narrows it
 * at the {@link Consent} client boundary via an optional `proofValidator` parser.
 *
 * This is the single documented `v.any()` escape hatch in the component; the lint
 * rule `convex-rules/no-bare-v-any` is satisfied by routing every arbitrary host
 * proof through this alias instead of a bare `v.any()`.
 */
export const jsonValue = v.any();

/**
 * The three consent decisions a subject can hold for a purpose. `granted` and
 * `denied` are explicit answers to the consent prompt; `withdrawn` revokes a
 * prior grant. Every decision is appended to the immutable ledger — the GDPR
 * proof — and projected onto the current-state row.
 */
export const consentDecision = v.union(
  v.literal("granted"),
  v.literal("denied"),
  v.literal("withdrawn"),
);

/**
 * One immutable row in the consent ledger. `subjectRef` and `purpose` are opaque
 * host strings; `decision` is the recorded answer; `version` is the policy
 * version the subject consented to; `proof` is the opaque host evidence; `at` is
 * the server timestamp. The ledger is append-only — a row is never mutated.
 */
export const consentEventView = v.object({
  subjectRef: v.string(),
  purpose: v.string(),
  decision: consentDecision,
  version: v.string(),
  proof: v.optional(jsonValue),
  at: v.number(),
});

/**
 * The current decision for one `(subjectRef, purpose)` pair — the O(1) runtime
 * gate, projected from the latest ledger event. `null` is returned by
 * {@link check}/{@link getState} when no event was ever recorded.
 */
export const consentStateView = v.object({
  subjectRef: v.string(),
  purpose: v.string(),
  decision: consentDecision,
  version: v.string(),
  at: v.number(),
});

/**
 * The answer to "may I process `<purpose>` for `<subject>`?". `granted` is the
 * gate: `true` only when the latest decision is `granted` AND its `version`
 * matches the host-supplied `requiredVersion` (or no version was required).
 * `stale` is `true` when the subject granted an older policy version than the one
 * now required — the host re-prompts. `decision`/`version`/`at` mirror the
 * current state (all `null` when no event was ever recorded).
 */
export const consentCheckView = v.object({
  granted: v.boolean(),
  stale: v.boolean(),
  decision: v.union(consentDecision, v.null()),
  version: v.union(v.string(), v.null()),
  at: v.union(v.number(), v.null()),
});
