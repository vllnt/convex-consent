import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { Consent } from "../../src/client";

/**
 * Host-app wrappers. The host owns auth: resolve identity here, then pass an
 * opaque `subjectRef`, a `purpose` key, and opaque `proof` into the client. Time
 * is server-sourced inside the component — there is no `at` override to pass.
 */
const consent = new Consent<{ policyHash: string } | string>(
  components.consent,
);

/** A second client on the named `marketing` mount — proves mount-safe isolation. */
const marketing = new Consent(components.marketing);

/**
 * A strict client that validates proof against a host parser and pins a default
 * policy version — proves the `proofValidator` boundary and `defaultVersion`.
 */
const strict = new Consent<{ policyHash: string }>(components.consent, {
  defaultVersion: "2024-policy",
  proofValidator: (value) => {
    if (
      typeof value !== "object" ||
      value === null ||
      typeof (value as { policyHash?: unknown }).policyHash !== "string"
    ) {
      throw new Error("invalid proof: expected { policyHash: string }");
    }
    return value as { policyHash: string };
  },
});

const decision = v.union(
  v.literal("granted"),
  v.literal("denied"),
  v.literal("withdrawn"),
);

const stateView = v.union(
  v.null(),
  v.object({
    subjectRef: v.string(),
    purpose: v.string(),
    decision,
    version: v.string(),
    at: v.number(),
  }),
);

const checkView = v.object({
  granted: v.boolean(),
  stale: v.boolean(),
  decision: v.union(decision, v.null()),
  version: v.union(v.string(), v.null()),
  at: v.union(v.number(), v.null()),
});

const eventView = v.object({
  subjectRef: v.string(),
  purpose: v.string(),
  decision,
  version: v.string(),
  proof: v.optional(v.any()),
  at: v.number(),
});

const paginated = v.object({
  page: v.array(eventView),
  isDone: v.boolean(),
  continueCursor: v.string(),
  splitCursor: v.optional(v.union(v.string(), v.null())),
  pageStatus: v.optional(
    v.union(v.literal("SplitRecommended"), v.literal("SplitRequired"), v.null()),
  ),
});

export const record = mutation({
  args: {
    subjectRef: v.string(),
    purpose: v.string(),
    decision,
    version: v.optional(v.string()),
    proof: v.optional(v.any()),
  },
  returns: v.object({ at: v.number() }),
  handler: (ctx, a) =>
    consent.record(ctx, a.subjectRef, a.purpose, a.decision, {
      version: a.version,
      proof: a.proof,
    }),
});

export const withdraw = mutation({
  args: { subjectRef: v.string(), purpose: v.string(), proof: v.optional(v.any()) },
  returns: v.object({ at: v.number() }),
  handler: (ctx, a) => consent.withdraw(ctx, a.subjectRef, a.purpose, a.proof),
});

export const check = query({
  args: {
    subjectRef: v.string(),
    purpose: v.string(),
    requiredVersion: v.optional(v.string()),
  },
  returns: checkView,
  handler: (ctx, a) =>
    consent.check(ctx, a.subjectRef, a.purpose, a.requiredVersion),
});

export const getState = query({
  args: { subjectRef: v.string(), purpose: v.string() },
  returns: stateView,
  handler: (ctx, a) => consent.getState(ctx, a.subjectRef, a.purpose),
});

export const getStatesForSubject = query({
  args: { subjectRef: v.string() },
  returns: v.array(
    v.object({
      subjectRef: v.string(),
      purpose: v.string(),
      decision,
      version: v.string(),
      at: v.number(),
    }),
  ),
  handler: (ctx, a) => consent.getStatesForSubject(ctx, a.subjectRef),
});

export const history = query({
  args: {
    subjectRef: v.string(),
    purpose: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginated,
  handler: (ctx, a) =>
    consent.history(ctx, a.subjectRef, a.purpose, a.paginationOpts),
});

export const prune = mutation({
  args: { before: v.optional(v.number()), batch: v.optional(v.number()) },
  returns: v.number(),
  handler: (ctx, a) => consent.prune(ctx, { before: a.before, batch: a.batch }),
});

/** Named-mount variants — prove a second instance is independent. */
export const recordMarketing = mutation({
  args: { subjectRef: v.string(), purpose: v.string(), decision },
  returns: v.object({ at: v.number() }),
  handler: (ctx, a) =>
    marketing.record(ctx, a.subjectRef, a.purpose, a.decision),
});

export const getMarketingState = query({
  args: { subjectRef: v.string(), purpose: v.string() },
  returns: stateView,
  handler: (ctx, a) => marketing.getState(ctx, a.subjectRef, a.purpose),
});

export const pruneMarketing = mutation({
  args: {},
  returns: v.number(),
  handler: (ctx) => marketing.prune(ctx),
});

/** Strict-client variants — exercise the proof validator + defaultVersion. */
export const recordStrict = mutation({
  args: { subjectRef: v.string(), purpose: v.string(), proof: v.any() },
  returns: v.object({ at: v.number() }),
  handler: (ctx, a) =>
    strict.record(ctx, a.subjectRef, a.purpose, "granted", { proof: a.proof }),
});

export const withdrawStrict = mutation({
  args: { subjectRef: v.string(), purpose: v.string(), proof: v.any() },
  returns: v.object({ at: v.number() }),
  handler: (ctx, a) => strict.withdraw(ctx, a.subjectRef, a.purpose, a.proof),
});

export const historyStrict = query({
  args: {
    subjectRef: v.string(),
    purpose: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginated,
  handler: (ctx, a) =>
    strict.history(ctx, a.subjectRef, a.purpose, a.paginationOpts),
});

/**
 * Host-side purpose-catalog helper — writes the host's own `purposes` table,
 * completely outside the component's sandbox, proving host/component table
 * isolation. The component is purpose-agnostic; the catalog is the host's.
 */
export const addPurpose = mutation({
  args: { key: v.string(), requiredVersion: v.string() },
  returns: v.null(),
  handler: async (ctx, { key, requiredVersion }) => {
    await ctx.db.insert("purposes", { key, requiredVersion });
    return null;
  },
});

export const getPurpose = query({
  args: { key: v.string() },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, { key }) => {
    const row = await ctx.db
      .query("purposes")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    return row?.requiredVersion ?? null;
  },
});
