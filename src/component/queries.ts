import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { query } from "./_generated/server";
import {
  consentCheckView,
  consentEventView,
  consentStateView,
} from "./validators";
import type { Doc } from "./_generated/dataModel";

/** Project a stored ledger row to its public event view (drops internal fields). */
function eventView(e: Doc<"consentEvents">) {
  return {
    subjectRef: e.subjectRef,
    purpose: e.purpose,
    decision: e.decision,
    version: e.version,
    proof: e.proof,
    at: e.at,
  };
}

/** Project a stored projection row to its public state view. */
function stateView(s: Doc<"consentState">) {
  return {
    subjectRef: s.subjectRef,
    purpose: s.purpose,
    decision: s.decision,
    version: s.version,
    at: s.at,
  };
}

/**
 * The runtime gate: may the host process `purpose` for `subjectRef`? Reads the
 * O(1) current-state projection. `granted` is `true` only when the latest
 * decision is `granted` AND — if a `requiredVersion` is supplied — the consented
 * `version` matches it. When the subject granted an older version than required,
 * `stale` is `true` (and `granted` is `false`) so the host re-prompts. With no
 * recorded consent every field is `null`/`false`.
 */
export const check = query({
  args: {
    subjectRef: v.string(),
    purpose: v.string(),
    requiredVersion: v.optional(v.string()),
  },
  returns: consentCheckView,
  handler: async (ctx, args) => {
    const state = await ctx.db
      .query("consentState")
      .withIndex("by_subject_purpose", (q) =>
        q.eq("subjectRef", args.subjectRef).eq("purpose", args.purpose),
      )
      .unique();
    if (state === null) {
      return {
        granted: false,
        stale: false,
        decision: null,
        version: null,
        at: null,
      };
    }
    const versionMatches =
      args.requiredVersion === undefined ||
      state.version === args.requiredVersion;
    const isGranted = state.decision === "granted";
    return {
      granted: isGranted && versionMatches,
      stale: isGranted && !versionMatches,
      decision: state.decision,
      version: state.version,
      at: state.at,
    };
  },
});

/** The raw current decision for one `(subjectRef, purpose)` pair, or `null`. */
export const getState = query({
  args: { subjectRef: v.string(), purpose: v.string() },
  returns: v.union(v.null(), consentStateView),
  handler: async (ctx, args) => {
    const state = await ctx.db
      .query("consentState")
      .withIndex("by_subject_purpose", (q) =>
        q.eq("subjectRef", args.subjectRef).eq("purpose", args.purpose),
      )
      .unique();
    return state === null ? null : stateView(state);
  },
});

/** Every current decision held by one subject, across all purposes. */
export const getStatesForSubject = query({
  args: { subjectRef: v.string() },
  returns: v.array(consentStateView),
  handler: async (ctx, args) => {
    const states = await ctx.db
      .query("consentState")
      .withIndex("by_subject", (q) => q.eq("subjectRef", args.subjectRef))
      .collect();
    return states.map(stateView);
  },
});

/**
 * Page the immutable consent ledger for one `(subjectRef, purpose)` pair,
 * newest-first via the `by_subject_purpose_at` index. Takes the standard Convex
 * `paginationOpts` and returns the standard paginated envelope (`page`, `isDone`,
 * `continueCursor`) — the full proof trail for an audit or a data subject request.
 */
export const history = query({
  args: {
    subjectRef: v.string(),
    purpose: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(consentEventView),
    isDone: v.boolean(),
    continueCursor: v.string(),
    splitCursor: v.optional(v.union(v.string(), v.null())),
    pageStatus: v.optional(
      v.union(
        v.literal("SplitRecommended"),
        v.literal("SplitRequired"),
        v.null(),
      ),
    ),
  }),
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("consentEvents")
      .withIndex("by_subject_purpose_at", (q) =>
        q.eq("subjectRef", args.subjectRef).eq("purpose", args.purpose),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    return { ...result, page: result.page.map(eventView) };
  },
});
