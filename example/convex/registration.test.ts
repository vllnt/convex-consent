import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { register } from "../../src/test";

const modules = import.meta.glob("./**/*.ts");

test("register accepts a host schema with its own tables and named mounts", async () => {
  const t = convexTest(schema, modules);
  register(t);
  register(t, "other");

  await t.run(async (ctx) => {
    await ctx.db.insert("purposes", { key: "analytics", requiredVersion: "1" });
  });
  await t.mutation(api.example.record, {
    subjectRef: "user_1",
    purpose: "analytics",
    decision: "granted",
    version: "1",
  });

  const gate = await t.query(api.example.check, {
    subjectRef: "user_1",
    purpose: "analytics",
    requiredVersion: "1",
  });
  expect(gate.granted).toBe(true);
  const purposes = await t.run((ctx) => ctx.db.query("purposes").collect());
  expect(purposes).toHaveLength(1);
});
