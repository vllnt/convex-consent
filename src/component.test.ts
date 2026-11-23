/// <reference types="vite/client" />
import { convexTest } from "convex-test";
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
});

describe("consent component — ref length limits", () => {
  const long = "x".repeat(MAX_REF_LENGTH + 1);

  test.each(["subjectRef", "purpose", "version"] as const)("record rejects an over-long %s", async (field) => {
    const t = setup();
    await expect(
      t.mutation(api.mutations.record, {
        subjectRef: "u",
        purpose: "p",
        decision: "granted",
        version: "1",
        [field]: long,
      }),
    ).rejects.toThrow(/INVALID_ARGUMENT|at most/);
  });

  test("withdraw rejects an over-long purpose", async () => {
    const t = setup();
    await expect(t.mutation(api.mutations.withdraw, { subjectRef: "u", purpose: long })).rejects.toThrow(
      /INVALID_ARGUMENT|at most/,
    );
  });

  test("record accepts refs at the limit", async () => {
    const t = setup();
    const ok = "x".repeat(MAX_REF_LENGTH);
    const result = await t.mutation(api.mutations.record, {
      subjectRef: ok,
      purpose: ok,
      decision: "granted",
      version: ok,
    });
    expect(result.at).toBeTypeOf("number");
  });
});
