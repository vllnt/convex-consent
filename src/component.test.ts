/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./component/_generated/api.js";
import schema from "./component/schema.js";

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

  test("getStatesForSubject orders purposes by code unit, uppercase before lowercase", async () => {
    const t = setup();
    for (const purpose of ["ads", "Alpha", "beta"]) {
      await t.mutation(api.mutations.record, { subjectRef: "o", purpose, decision: "granted", version: "1" });
    }
    const states = await t.query(api.queries.getStatesForSubject, { subjectRef: "o" });
    expect(states.map((s) => s.purpose)).toEqual(["Alpha", "ads", "beta"]);
  });
});
