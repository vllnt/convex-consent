import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { consentDecision, jsonValue } from "./validators";

/**
 * Two sandboxed tables — the consent ledger's own concern.
 *
 * `consentEvents` is the **append-only** legal record (GDPR Art. 7(1) proof): a
 * row is inserted on every grant/deny/withdraw and is NEVER mutated, only ever
 * deleted by the retention prune. `subjectRef` and `purpose` are opaque host
 * strings; `proof` is opaque host evidence (policy hash, IP, UA). The
 * `by_subject_purpose_at` index reads one pair's history newest-first; the
 * `by_at` index drives the oldest-first retention sweep.
 *
 * `consentState` is the derived **current-decision projection** — exactly one
 * row per `(subjectRef, purpose)`, overwritten on each new event. It is the O(1)
 * runtime gate the host queries before processing; `by_subject_purpose` resolves
 * a single pair, `by_subject` lists every purpose for one subject.
 */
export default defineSchema({
  consentEvents: defineTable({
    subjectRef: v.string(),
    purpose: v.string(),
    decision: consentDecision,
    version: v.string(),
    proof: v.optional(jsonValue),
    at: v.number(),
  })
    .index("by_subject_purpose_at", ["subjectRef", "purpose", "at"])
    .index("by_at", ["at"]),

  consentState: defineTable({
    subjectRef: v.string(),
    purpose: v.string(),
    decision: consentDecision,
    version: v.string(),
    at: v.number(),
  })
    .index("by_subject_purpose", ["subjectRef", "purpose"])
    .index("by_subject", ["subjectRef"]),
});
