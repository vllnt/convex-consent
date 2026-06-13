/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    mutations: {
      record: FunctionReference<
        "mutation",
        "internal",
        {
          decision: "granted" | "denied" | "withdrawn";
          proof?: any;
          purpose: string;
          subjectRef: string;
          version: string;
        },
        { at: number },
        Name
      >;
      withdraw: FunctionReference<
        "mutation",
        "internal",
        { proof?: any; purpose: string; subjectRef: string },
        { at: number },
        Name
      >;
      prune: FunctionReference<
        "mutation",
        "internal",
        { batch: number; before?: number },
        number,
        Name
      >;
    };
    queries: {
      check: FunctionReference<
        "query",
        "internal",
        { purpose: string; requiredVersion?: string; subjectRef: string },
        {
          at: number | null;
          decision: "granted" | "denied" | "withdrawn" | null;
          granted: boolean;
          stale: boolean;
          version: string | null;
        },
        Name
      >;
      getState: FunctionReference<
        "query",
        "internal",
        { purpose: string; subjectRef: string },
        null | {
          at: number;
          decision: "granted" | "denied" | "withdrawn";
          purpose: string;
          subjectRef: string;
          version: string;
        },
        Name
      >;
      getStatesForSubject: FunctionReference<
        "query",
        "internal",
        { subjectRef: string },
        Array<{
          at: number;
          decision: "granted" | "denied" | "withdrawn";
          purpose: string;
          subjectRef: string;
          version: string;
        }>,
        Name
      >;
      history: FunctionReference<
        "query",
        "internal",
        {
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
          purpose: string;
          subjectRef: string;
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            at: number;
            decision: "granted" | "denied" | "withdrawn";
            proof?: any;
            purpose: string;
            subjectRef: string;
            version: string;
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        },
        Name
      >;
    };
  };
