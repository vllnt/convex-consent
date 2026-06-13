import { ConvexError, v } from "convex/values";
import { api } from "./_generated/api";
import { mutation } from "./_generated/server";
import { consentDecision, jsonValue } from "./validators";

/**
 * Record a consent decision for a `(subjectRef, purpose)` pair. Appends one
 * immutable row to the `consentEvents` ledger — the GDPR proof — and overwrites
 * the `consentState` projection so the next {@link check}/{@link getState} reads
 * the new decision. `at` is stamped from the server clock (`Date.now()` inside
 * the handler — never caller-supplied), so the ledger order cannot be skewed by a
 * client clock.
 *
 * `subjectRef` and `purpose` are opaque host strings; `version` is the policy
 * version the subject consented to (defaults to the host's `defaultVersion` at
 * the client boundary); `proof` is opaque host evidence stored verbatim. The
 * ledger row is the legal record — it is never mutated, only swept by retention
 * `prune`.
 */
export const record = mutation({
  args: {
    subjectRef: v.string(),
    purpose: v.string(),
    decision: consentDecision,
    version: v.string(),
    proof: v.optional(jsonValue),
  },
  returns: v.object({ at: v.number() }),
  handler: async (ctx, args) => {
    const at = Date.now();
    await ctx.db.insert("consentEvents", {
      subjectRef: args.subjectRef,
      purpose: args.purpose,
      decision: args.decision,
      version: args.version,
      proof: args.proof,
      at,
    });

    const existing = await ctx.db
      .query("consentState")
      .withIndex("by_subject_purpose", (q) =>
        q.eq("subjectRef", args.subjectRef).eq("purpose", args.purpose),
      )
      .unique();
    const projection = {
      subjectRef: args.subjectRef,
      purpose: args.purpose,
      decision: args.decision,
      version: args.version,
      at,
    };
    if (existing === null) {
      await ctx.db.insert("consentState", projection);
    } else {
      await ctx.db.patch(existing._id, projection);
    }
    return { at };
  },
});

/**
 * Withdraw a previously-granted consent — the GDPR Art. 7(3) "as easy to withdraw
 * as to give" path. Appends a `withdrawn` event and projects it, but ONLY when the
 * subject currently holds a `granted` decision for the purpose; withdrawing
 * something never granted is a no-op error rather than a silent ledger entry, so
 * the audit trail stays meaningful.
 *
 * @throws `ConvexError({ code: "NO_CONSENT" })` when no consent was ever recorded
 *   for the pair.
 * @throws `ConvexError({ code: "NOT_GRANTED" })` when the current decision is not
 *   `granted` (already `denied`/`withdrawn`) — there is nothing to withdraw.
 */
export const withdraw = mutation({
  args: {
    subjectRef: v.string(),
    purpose: v.string(),
    proof: v.optional(jsonValue),
  },
  returns: v.object({ at: v.number() }),
  handler: async (ctx, args) => {
    const state = await ctx.db
      .query("consentState")
      .withIndex("by_subject_purpose", (q) =>
        q.eq("subjectRef", args.subjectRef).eq("purpose", args.purpose),
      )
      .unique();
    if (state === null) {
      throw new ConvexError({
        code: "NO_CONSENT",
        message: `no consent recorded for "${args.subjectRef}" / "${args.purpose}"`,
      });
    }
    if (state.decision !== "granted") {
      throw new ConvexError({
        code: "NOT_GRANTED",
        message: `consent for "${args.subjectRef}" / "${args.purpose}" is "${state.decision}", not "granted" — nothing to withdraw`,
      });
    }

    const at = Date.now();
    await ctx.db.insert("consentEvents", {
      subjectRef: args.subjectRef,
      purpose: args.purpose,
      decision: "withdrawn",
      version: state.version,
      proof: args.proof,
      at,
    });
    await ctx.db.patch(state._id, { decision: "withdrawn", at });
    return { at };
  },
});

/**
 * Delete up to `batch` superseded ledger events whose `at < before`, oldest first
 * via the `by_at` index, and return the count removed in the first pass. `before`
 * defaults to the server clock (`Date.now()`) when omitted, so the built-in cron
 * sweeps exactly the events stale as of the run. If a full batch was removed there
 * may be more, so the sweep self-reschedules through `ctx.scheduler` until a short
 * batch signals the tail is clean.
 *
 * Only the historical `consentEvents` ledger is pruned — the `consentState`
 * projection is the live gate and is never swept, so a host that prunes old proof
 * still gets the correct current decision. Idempotent: only ever removes
 * already-past-retention rows.
 */
export const prune = mutation({
  args: { before: v.optional(v.number()), batch: v.number() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const before = args.before ?? Date.now();
    const stale = await ctx.db
      .query("consentEvents")
      .withIndex("by_at", (q) => q.lt("at", before))
      .take(args.batch);

    for (const row of stale) {
      await ctx.db.delete(row._id);
    }
    const removed = stale.length;

    if (removed === args.batch) {
      await ctx.scheduler.runAfter(0, api.mutations.prune, {
        before,
        batch: args.batch,
      });
    }
    return removed;
  },
});
