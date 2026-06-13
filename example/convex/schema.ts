import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * The example host app's own table. It is host-side state living entirely outside
 * the component's sandboxed consent tables — used to prove the component never
 * reaches into host tables (and the host never into the component's, except
 * through the exported client). Here it models the host's own purpose catalog,
 * which the host owns (the component is purpose-agnostic).
 */
export default defineSchema({
  purposes: defineTable({
    key: v.string(),
    requiredVersion: v.string(),
  }).index("by_key", ["key"]),
});
