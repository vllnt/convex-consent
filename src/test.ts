/// <reference types="vite/client" />
import type { GenericSchema, SchemaDefinition } from "convex/server";
import type { TestConvex } from "convex-test";
import schema from "./component/schema.js";

const modules = import.meta.glob("./component/**/*.ts");

/**
 * Mounts the consent component in a `convex-test` instance built from any host
 * schema, so consuming apps can test integration:
 * `import { register } from "@vllnt/convex-consent/test"`.
 *
 * Needs Vite's `import.meta.glob`, so run it under Vitest.
 *
 * @param t - The host app's `convexTest(hostSchema, modules)` instance.
 * @param name - The mount name; defaults to `"consent"`, the name used by `app.use(component)`.
 * @example
 * const t = convexTest(schema, modules);
 * register(t);
 * register(t, "marketing");
 */
export function register<TSchema extends GenericSchema>(
  t: TestConvex<SchemaDefinition<TSchema, boolean>>,
  name = "consent",
): void {
  t.registerComponent(name, schema, modules);
}
