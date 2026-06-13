import type { TestConvex } from "convex-test";
import schema from "./component/schema";

const modules = import.meta.glob("./component/**/*.ts");

/**
 * Register this component with a `convex-test` instance so consuming apps can
 * test integration: `import { register } from "@vllnt/convex-consent/test"`.
 */
export function register(
  t: TestConvex<typeof schema>,
  name = "consent",
): void {
  t.registerComponent(name, schema, modules);
}
