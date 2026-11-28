/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./component/_generated/api.js";
import schema from "./component/schema.js";
import { MAX_REF_LENGTH } from "./shared.js";

const modules = import.meta.glob("./component/**/*.ts");

function setup() {
  return convexTest(schema, modules);
}

describe("consent component — indexes", () => {
  test("consentState keeps only the by_subject_purpose index", () => {
    const indexes = schema.tables.consentState[" indexes"]().map((index) => index.indexDescriptor);
    expect(indexes).toEqual(["by_subject_purpose"]);
  });

  test("getStatesForSubject returns every purpose of one subject only", async () => {
    const t = setup();
    for (const purpose of ["marketing", "analytics"]) {
      await t.mutation(api.mutations.record, { subjectRef: "u", purpose, decision: "granted", version: "1" });
    }
    await t.mutation(api.mutations.record, { subjectRef: "u2", purpose: "analytics", decision: "denied", version: "1" });
    const states = await t.query(api.queries.getStatesForSubject, { subjectRef: "u" });
    expect(states.map((s) => s.purpose)).toEqual(["analytics", "marketing"]);
    expect(states.every((s) => s.subjectRef === "u")).toBe(true);
  });

  test("getStatesForSubject orders purposes by UTF-8 bytes, uppercase before lowercase", async () => {
    const t = setup();
    for (const purpose of ["ads", "Alpha", "beta"]) {
      await t.mutation(api.mutations.record, { subjectRef: "o", purpose, decision: "granted", version: "1" });
    }
    const states = await t.query(api.queries.getStatesForSubject, { subjectRef: "o" });
    expect(states.map((s) => s.purpose)).toEqual(["Alpha", "ads", "beta"]);
  });
});

/** Resolve to the `ConvexError` code `promise` rejects with; fail if it resolves. */
async function errorCode(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ConvexError) {
      return (error.data as { code?: unknown }).code;
    }
    throw error;
  }
  throw new Error("expected a ConvexError, but the call succeeded");
}

describe("consent component — ref length cap", () => {
  const base = { subjectRef: "u", purpose: "p", decision: "granted", version: "1" } as const;
  const atLimit = "x".repeat(MAX_REF_LENGTH);
  const overLimit = "x".repeat(MAX_REF_LENGTH + 1);

  test("the cap is 512", () => {
    expect(MAX_REF_LENGTH).toBe(512);
  });

  test.each(["subjectRef", "purpose", "version"] as const)("record accepts a %s of exactly 512", async (field) => {
    const t = setup();
    const args = { ...base, [field]: atLimit };
    await expect(t.mutation(api.mutations.record, args)).resolves.toMatchObject({ at: expect.any(Number) });
    expect(await t.query(api.queries.getState, { subjectRef: args.subjectRef, purpose: args.purpose })).toMatchObject({
      version: args.version,
    });
  });

  test.each(["subjectRef", "purpose", "version"] as const)(
    "record rejects a %s of 513 with INVALID_ARGUMENT and writes nothing",
    async (field) => {
      const t = setup();
      const args = { ...base, [field]: overLimit };
      expect(await errorCode(t.mutation(api.mutations.record, args))).toBe("INVALID_ARGUMENT");
      const rows = await t.run(async (ctx) => ({
        events: await ctx.db.query("consentEvents").collect(),
        states: await ctx.db.query("consentState").collect(),
      }));
      expect(rows).toEqual({ events: [], states: [] });
    },
  );

  test("the cap counts Unicode code points: 512 emoji pass, 513 throw", async () => {
    const t = setup();
    const emoji512 = "\u{1F600}".repeat(MAX_REF_LENGTH);
    expect(emoji512.length).toBe(MAX_REF_LENGTH * 2);
    for (const field of ["subjectRef", "purpose", "version"] as const) {
      await expect(
        t.mutation(api.mutations.record, { ...base, purpose: `emoji-${field}`, [field]: emoji512 }),
      ).resolves.toMatchObject({ at: expect.any(Number) });
      expect(
        await errorCode(
          t.mutation(api.mutations.record, { ...base, purpose: `emoji-${field}-2`, [field]: `${emoji512}\u{1F600}` }),
        ),
      ).toBe("INVALID_ARGUMENT");
    }
  });

  test("a new over-long version for an existing short pair throws", async () => {
    const t = setup();
    await t.mutation(api.mutations.record, base);
    expect(await errorCode(t.mutation(api.mutations.record, { ...base, version: overLimit }))).toBe("INVALID_ARGUMENT");
    expect(await t.query(api.queries.getState, { subjectRef: "u", purpose: "p" })).toMatchObject({ version: "1" });
    const page = { numItems: 10, cursor: null };
    expect(
      (await t.query(api.queries.history, { subjectRef: "u", purpose: "p", paginationOpts: page })).page,
    ).toHaveLength(1);
  });

  test("the empty-value check still runs first", async () => {
    const t = setup();
    await expect(
      t.mutation(api.mutations.record, { ...base, subjectRef: overLimit, purpose: "" }),
    ).rejects.toThrow(/purpose must be non-empty/);
  });

  test("a pair stored earlier with over-long values stays readable, re-recordable and withdrawable", async () => {
    const t = setup();
    const ref = { subjectRef: overLimit, purpose: overLimit };
    const page = { numItems: 10, cursor: null };
    await t.run(async (ctx) => {
      await ctx.db.insert("consentEvents", { ...ref, decision: "granted", version: overLimit, at: 1 });
      await ctx.db.insert("consentState", { ...ref, decision: "granted", version: overLimit, at: 1 });
    });

    expect(await t.query(api.queries.check, { ...ref, requiredVersion: overLimit })).toMatchObject({
      granted: true,
      stale: false,
      decision: "granted",
      version: overLimit,
    });
    expect(await t.query(api.queries.getState, ref)).toMatchObject({ decision: "granted", version: overLimit });
    expect(await t.query(api.queries.getStatesForSubject, { subjectRef: overLimit })).toMatchObject([
      { purpose: overLimit, version: overLimit },
    ]);
    expect((await t.query(api.queries.history, { ...ref, paginationOpts: page })).page).toMatchObject([
      { decision: "granted", version: overLimit },
    ]);

    await expect(
      t.mutation(api.mutations.record, { ...ref, decision: "granted", version: overLimit }),
    ).resolves.toMatchObject({ at: expect.any(Number) });
    await expect(t.mutation(api.mutations.withdraw, ref)).resolves.toMatchObject({ at: expect.any(Number) });
    expect(await t.query(api.queries.check, ref)).toMatchObject({ granted: false, decision: "withdrawn" });

    expect(
      await errorCode(t.mutation(api.mutations.record, { ...ref, decision: "granted", version: `${overLimit}z` })),
    ).toBe("INVALID_ARGUMENT");
    await expect(
      t.mutation(api.mutations.record, { ...ref, decision: "granted", version: "2" }),
    ).resolves.toMatchObject({ at: expect.any(Number) });
    expect(await t.query(api.queries.check, { ...ref, requiredVersion: "2" })).toMatchObject({
      granted: true,
      stale: false,
      version: "2",
    });
    expect((await t.query(api.queries.history, { ...ref, paginationOpts: page })).page).toHaveLength(4);
  });
});
