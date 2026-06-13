/** Public TypeScript surface for the consent client. */

/**
 * The three consent decisions a subject can hold for a purpose. `granted` and
 * `denied` are explicit answers to the prompt; `withdrawn` revokes a prior grant.
 */
export type ConsentDecision = "granted" | "denied" | "withdrawn";

/**
 * Validates and narrows an opaque stored value to a host type `T` at the client
 * boundary. Receives the raw value the component returned (`unknown`) and MUST
 * return a typed `T` or throw. A `convex/values` validator's `.parse` (or a Zod
 * `.parse`) fits directly; omit it to keep the value unvalidated.
 *
 * @typeParam T - The host's stored type (the consent `proof`).
 */
export type Parser<T> = (value: unknown) => T;

/** One immutable row in the consent ledger — a recorded decision plus its proof. */
export interface ConsentEvent<TProof = unknown> {
  /** The opaque host-supplied subject identifier. */
  subjectRef: string;
  /** The opaque host-supplied purpose key. */
  purpose: string;
  /** The recorded decision. */
  decision: ConsentDecision;
  /** The policy version the subject consented to. */
  version: string;
  /** The opaque host proof recorded with the decision (narrowed if a `proofValidator` is set). */
  proof?: TProof;
  /** Absolute ms timestamp the decision was recorded (server clock). */
  at: number;
}

/** The current decision for one `(subjectRef, purpose)` pair. */
export interface ConsentState {
  /** The opaque host-supplied subject identifier. */
  subjectRef: string;
  /** The opaque host-supplied purpose key. */
  purpose: string;
  /** The latest decision. */
  decision: ConsentDecision;
  /** The policy version of the latest decision. */
  version: string;
  /** Absolute ms timestamp of the latest decision (server clock). */
  at: number;
}

/** The answer to "may I process `purpose` for `subjectRef`?" returned by `check`. */
export interface ConsentCheck {
  /** The gate: `true` only when the latest decision is `granted` and the version matches any requirement. */
  granted: boolean;
  /** `true` when a `granted` decision is for an older version than the one now required — re-prompt. */
  stale: boolean;
  /** The current decision, or `null` if none was ever recorded. */
  decision: ConsentDecision | null;
  /** The current version, or `null` if none was ever recorded. */
  version: string | null;
  /** The current decision timestamp, or `null` if none was ever recorded. */
  at: number | null;
}

/** Per-call options for {@link Consent.record}. */
export interface RecordOptions<TProof> {
  /** The policy version the subject consented to (defaults to the client's `defaultVersion`). */
  version?: string;
  /** The opaque host proof to store (validated against `proofValidator`). */
  proof?: TProof;
}

/** Construction options for the {@link Consent} client. */
export interface ConsentOptions<TProof> {
  /**
   * The policy version stamped on a decision when `record` is called without an
   * explicit `version`. Lets a host bump its policy version in one place. Defaults
   * to `"1"`.
   */
  defaultVersion?: string;
  /**
   * Validates/narrows a stored `proof` to `TProof` at the boundary — applied to
   * the `proof` passed into `record`/`withdraw` (before storage) and the `proof`
   * returned by `history`. Throws on a mismatch. Omit to leave proof unvalidated.
   */
  proofValidator?: Parser<TProof>;
}
