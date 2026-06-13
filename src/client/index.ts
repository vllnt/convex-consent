import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
  PaginationOptions,
  PaginationResult,
} from "convex/server";
import type {
  ConsentCheck,
  ConsentDecision,
  ConsentEvent,
  ConsentOptions,
  ConsentState,
  Parser,
  RecordOptions,
} from "./types.js";
import { DEFAULT_PRUNE_BATCH, DEFAULT_VERSION } from "../shared.js";

/**
 * The component's raw ledger event, before the client narrows opaque host proof.
 * `proof` is `unknown` here; the {@link Consent} client runs the host validator
 * over it at its typed boundary.
 */
type RawEvent = {
  subjectRef: string;
  purpose: string;
  decision: ConsentDecision;
  version: string;
  proof?: unknown;
  at: number;
};

/**
 * The consent component's function references, as exposed on the host via
 * `components.consent`. The host's stored `proof` is opaque here (`unknown`); the
 * {@link Consent} client narrows it at its own typed boundary.
 */
export interface ConsentComponent {
  mutations: {
    record: FunctionReference<
      "mutation",
      "internal",
      {
        subjectRef: string;
        purpose: string;
        decision: ConsentDecision;
        version: string;
        proof?: unknown;
      },
      { at: number }
    >;
    withdraw: FunctionReference<
      "mutation",
      "internal",
      { subjectRef: string; purpose: string; proof?: unknown },
      { at: number }
    >;
    prune: FunctionReference<
      "mutation",
      "internal",
      { before?: number; batch: number },
      number
    >;
  };
  queries: {
    check: FunctionReference<
      "query",
      "internal",
      { subjectRef: string; purpose: string; requiredVersion?: string },
      ConsentCheck
    >;
    getState: FunctionReference<
      "query",
      "internal",
      { subjectRef: string; purpose: string },
      ConsentState | null
    >;
    getStatesForSubject: FunctionReference<
      "query",
      "internal",
      { subjectRef: string },
      ConsentState[]
    >;
    history: FunctionReference<
      "query",
      "internal",
      { subjectRef: string; purpose: string; paginationOpts: PaginationOptions },
      PaginationResult<RawEvent>
    >;
  };
}

interface RunQueryCtx {
  runQuery<Q extends FunctionReference<"query", "internal">>(
    reference: Q,
    args: FunctionArgs<Q>,
  ): Promise<FunctionReturnType<Q>>;
}

interface RunMutationCtx {
  runMutation<M extends FunctionReference<"mutation", "internal">>(
    reference: M,
    args: FunctionArgs<M>,
  ): Promise<FunctionReturnType<M>>;
}

/**
 * Consumer-facing client for the consent ledger (GDPR Art. 6/7). The host records
 * a subject's decision for a purpose with `record` (or revokes one with
 * `withdraw`) — each call appends an immutable ledger event (the legal proof) and
 * updates the O(1) current-state projection. Before processing, the host calls
 * `check` to gate: "may I process `<purpose>` for `<subject>`?". `subjectRef` and
 * `purpose` are opaque host strings; the host owns meaning and auth. Pass
 * `proofValidator` to narrow the opaque stored `proof` to `TProof` at the
 * boundary — there is no unchecked cast.
 *
 * @typeParam TProof - The host's consent-proof type (defaults to `unknown`).
 *
 * @example
 * ```ts
 * const consent = new Consent(components.consent, {
 *   defaultVersion: "2024-policy",
 *   proofValidator: v.object({ policyHash: v.string() }).parse,
 * });
 * await consent.record(ctx, "user_42", "analytics", "granted", {
 *   proof: { policyHash },
 * });
 * const gate = await consent.check(ctx, "user_42", "analytics", "2024-policy");
 * if (gate.granted) {
 *   // process the personal data
 * }
 * ```
 */
export class Consent<TProof = unknown> {
  private readonly defaultVersion: string;
  private readonly proofValidator: Parser<TProof> | undefined;

  constructor(
    private readonly component: ConsentComponent,
    options: ConsentOptions<TProof> = {},
  ) {
    this.defaultVersion = options.defaultVersion ?? DEFAULT_VERSION;
    this.proofValidator = options.proofValidator;
  }

  /** Narrow an opaque value through the host proof parser; pass `undefined` and an unset parser through. */
  private parseProof(value: unknown): TProof | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (this.proofValidator === undefined) {
      return value as TProof;
    }
    return this.proofValidator(value);
  }

  /** Project a raw component event into the typed, validated client event. */
  private event(raw: RawEvent): ConsentEvent<TProof> {
    return {
      subjectRef: raw.subjectRef,
      purpose: raw.purpose,
      decision: raw.decision,
      version: raw.version,
      proof: this.parseProof(raw.proof),
      at: raw.at,
    };
  }

  /**
   * Record a consent decision for `(subjectRef, purpose)`. Appends an immutable
   * ledger event and updates the current-state projection. `opts.version` defaults
   * to the client's `defaultVersion`; `opts.proof` is opaque host evidence
   * validated against `proofValidator` before storage. Returns the server
   * timestamp stamped on the event.
   */
  record(
    ctx: RunMutationCtx,
    subjectRef: string,
    purpose: string,
    decision: ConsentDecision,
    opts: RecordOptions<TProof> = {},
  ): Promise<{ at: number }> {
    return ctx.runMutation(this.component.mutations.record, {
      subjectRef,
      purpose,
      decision,
      version: opts.version ?? this.defaultVersion,
      proof: opts.proof === undefined ? undefined : this.parseProof(opts.proof),
    });
  }

  /**
   * Withdraw a previously-granted consent (GDPR Art. 7(3)). Appends a `withdrawn`
   * event and updates the projection, but only when the subject currently holds a
   * `granted` decision — the component throws a coded `ConvexError` (`NO_CONSENT`
   * / `NOT_GRANTED`) otherwise so the audit trail stays meaningful.
   */
  withdraw(
    ctx: RunMutationCtx,
    subjectRef: string,
    purpose: string,
    proof?: TProof,
  ): Promise<{ at: number }> {
    return ctx.runMutation(this.component.mutations.withdraw, {
      subjectRef,
      purpose,
      proof: proof === undefined ? undefined : this.parseProof(proof),
    });
  }

  /**
   * The runtime gate: may the host process `purpose` for `subjectRef`? Pass
   * `requiredVersion` to also require the consent be for the current policy
   * version — when the subject granted an older version the result is `stale`
   * (and not `granted`) so the host re-prompts.
   */
  check(
    ctx: RunQueryCtx,
    subjectRef: string,
    purpose: string,
    requiredVersion?: string,
  ): Promise<ConsentCheck> {
    return ctx.runQuery(this.component.queries.check, {
      subjectRef,
      purpose,
      requiredVersion,
    });
  }

  /** The raw current decision for one `(subjectRef, purpose)` pair, or `null`. */
  getState(
    ctx: RunQueryCtx,
    subjectRef: string,
    purpose: string,
  ): Promise<ConsentState | null> {
    return ctx.runQuery(this.component.queries.getState, {
      subjectRef,
      purpose,
    });
  }

  /** Every current decision held by one subject, across all purposes. */
  getStatesForSubject(
    ctx: RunQueryCtx,
    subjectRef: string,
  ): Promise<ConsentState[]> {
    return ctx.runQuery(this.component.queries.getStatesForSubject, {
      subjectRef,
    });
  }

  /**
   * Page the immutable consent ledger for one `(subjectRef, purpose)` pair,
   * newest-first. Returns the standard Convex pagination envelope with each event
   * narrowed to the typed view — the full proof trail for an audit or a data
   * subject request.
   */
  async history(
    ctx: RunQueryCtx,
    subjectRef: string,
    purpose: string,
    paginationOpts: PaginationOptions,
  ): Promise<PaginationResult<ConsentEvent<TProof>>> {
    const result = await ctx.runQuery(this.component.queries.history, {
      subjectRef,
      purpose,
      paginationOpts,
    });
    return { ...result, page: result.page.map((raw) => this.event(raw)) };
  }

  /**
   * Delete superseded ledger events whose `at < before` in bounded batches,
   * oldest first. `before` defaults to the server clock; `batch` caps each pass
   * and the sweep self-reschedules until the tail is clean. The current-state
   * projection is never pruned. Returns the count removed in the first pass. The
   * built-in daily cron drives this automatically.
   */
  prune(
    ctx: RunMutationCtx,
    opts: { before?: number; batch?: number } = {},
  ): Promise<number> {
    return ctx.runMutation(this.component.mutations.prune, {
      before: opts.before,
      batch: opts.batch ?? DEFAULT_PRUNE_BATCH,
    });
  }
}

export type {
  ConsentCheck,
  ConsentDecision,
  ConsentEvent,
  ConsentOptions,
  ConsentState,
  Parser,
  RecordOptions,
};
