import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, components } from "./_generated/api";
import schema from "./schema";
import { register } from "../../src/test";
import crons, { PRUNE_BATCH, PRUNE_INTERVAL } from "../../src/component/crons";

const modules = import.meta.glob("./**/*.ts");

function setup() {
  const t = convexTest(schema, modules);
  register(t); // default "consent" mount
  register(t, "marketing"); // second named mount — proves mount-safety
  return t;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("consent — record + check (the gate)", () => {
  test("record granted → check passes, state + history reflect it", async () => {
    const t = setup();
    const { at } = await t.mutation(api.example.record, {
      subjectRef: "user_1",
      purpose: "analytics",
      decision: "granted",
      version: "1",
      proof: { ip: "1.2.3.4" },
    });
    expect(at).toBe(0);

    const gate = await t.query(api.example.check, {
      subjectRef: "user_1",
      purpose: "analytics",
    });
    expect(gate.granted).toBe(true);
    expect(gate.stale).toBe(false);
    expect(gate.decision).toBe("granted");
    expect(gate.version).toBe("1");
    expect(gate.at).toBe(0);

    const state = await t.query(api.example.getState, {
      subjectRef: "user_1",
      purpose: "analytics",
    });
    expect(state?.decision).toBe("granted");

    const hist = await t.query(api.example.history, {
      subjectRef: "user_1",
      purpose: "analytics",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(hist.page).toHaveLength(1);
    expect(hist.page[0]?.decision).toBe("granted");
    expect(hist.page[0]?.proof).toEqual({ ip: "1.2.3.4" });
  });

  test("record denied → check fails, not stale", async () => {
    const t = setup();
    await t.mutation(api.example.record, {
      subjectRef: "user_2",
      purpose: "marketing",
      decision: "denied",
      version: "1",
    });
    const gate = await t.query(api.example.check, {
      subjectRef: "user_2",
      purpose: "marketing",
    });
    expect(gate.granted).toBe(false);
    expect(gate.stale).toBe(false);
    expect(gate.decision).toBe("denied");
  });

  test("check on a never-recorded pair returns all-null, not granted", async () => {
    const t = setup();
    const gate = await t.query(api.example.check, {
      subjectRef: "ghost",
      purpose: "analytics",
    });
    expect(gate.granted).toBe(false);
    expect(gate.stale).toBe(false);
    expect(gate.decision).toBeNull();
    expect(gate.version).toBeNull();
    expect(gate.at).toBeNull();
  });

  test("getState on a never-recorded pair returns null", async () => {
    const t = setup();
    expect(
      await t.query(api.example.getState, { subjectRef: "ghost", purpose: "x" }),
    ).toBeNull();
  });
});

describe("consent — current-state reflects the LATEST record (append-only)", () => {
  test("a second record overwrites the projection but appends to the ledger", async () => {
    const t = setup();
    await t.mutation(api.example.record, {
      subjectRef: "u",
      purpose: "analytics",
      decision: "denied",
      version: "1",
    });
    vi.setSystemTime(1_000);
    await t.mutation(api.example.record, {
      subjectRef: "u",
      purpose: "analytics",
      decision: "granted",
      version: "1",
    });

    // current state is the latest decision
    const gate = await t.query(api.example.check, {
      subjectRef: "u",
      purpose: "analytics",
    });
    expect(gate.granted).toBe(true);
    expect(gate.at).toBe(1_000);

    // but the ledger kept BOTH events, newest-first
    const hist = await t.query(api.example.history, {
      subjectRef: "u",
      purpose: "analytics",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(hist.page.map((e) => e.decision)).toEqual(["granted", "denied"]);
  });
});

describe("consent — version staleness", () => {
  test("granted for an older version → stale, not granted; current version → granted", async () => {
    const t = setup();
    await t.mutation(api.example.record, {
      subjectRef: "v",
      purpose: "analytics",
      decision: "granted",
      version: "2023",
    });

    const stale = await t.query(api.example.check, {
      subjectRef: "v",
      purpose: "analytics",
      requiredVersion: "2024",
    });
    expect(stale.granted).toBe(false);
    expect(stale.stale).toBe(true);
    expect(stale.version).toBe("2023");

    const fresh = await t.query(api.example.check, {
      subjectRef: "v",
      purpose: "analytics",
      requiredVersion: "2023",
    });
    expect(fresh.granted).toBe(true);
    expect(fresh.stale).toBe(false);
  });

  test("a denied decision at an old version is never stale (only grants go stale)", async () => {
    const t = setup();
    await t.mutation(api.example.record, {
      subjectRef: "vd",
      purpose: "analytics",
      decision: "denied",
      version: "2023",
    });
    const gate = await t.query(api.example.check, {
      subjectRef: "vd",
      purpose: "analytics",
      requiredVersion: "2024",
    });
    expect(gate.granted).toBe(false);
    expect(gate.stale).toBe(false);
  });

  test.each([
    ["10", "2"],
    ["3", "2"],
  ])(
    "a grant at %s checked against %s is stale (string inequality, not version order)",
    async (stored, required) => {
      const t = setup();
      await t.mutation(api.example.record, {
        subjectRef: "vs",
        purpose: "analytics",
        decision: "granted",
        version: stored,
      });
      const gate = await t.query(api.example.check, {
        subjectRef: "vs",
        purpose: "analytics",
        requiredVersion: required,
      });
      expect(gate.granted).toBe(false);
      expect(gate.stale).toBe(true);
      expect(gate.version).toBe(stored);
    },
  );

  test("a withdrawn decision checked with a requiredVersion is neither stale nor granted", async () => {
    const t = setup();
    await t.mutation(api.example.record, {
      subjectRef: "vw",
      purpose: "analytics",
      decision: "granted",
      version: "1",
    });
    await t.mutation(api.example.withdraw, { subjectRef: "vw", purpose: "analytics" });
    const gate = await t.query(api.example.check, {
      subjectRef: "vw",
      purpose: "analytics",
      requiredVersion: "2",
    });
    expect(gate.decision).toBe("withdrawn");
    expect(gate.granted).toBe(false);
    expect(gate.stale).toBe(false);
  });
});

describe("consent — server-sourced time", () => {
  test("the component record mutation rejects a caller-supplied at", async () => {
    const t = setup();
    await expect(
      t.mutation(components.consent.mutations.record, {
        subjectRef: "clock",
        purpose: "analytics",
        decision: "granted",
        version: "1",
        at: 1,
      } as never),
    ).rejects.toThrow(/Unexpected field `at`/);
    expect(
      await t.query(api.example.getState, { subjectRef: "clock", purpose: "analytics" }),
    ).toBeNull();
  });
});

describe("consent — empty identifiers are rejected", () => {
  test.each(["subjectRef", "purpose", "version"] as const)(
    "record rejects an empty %s and stores nothing",
    async (field) => {
      const t = setup();
      const args = { subjectRef: "s_1", purpose: "analytics", version: "1" };
      await expect(
        t.mutation(api.example.record, {
          ...args,
          [field]: "",
          decision: "granted",
        }),
      ).rejects.toThrow(/INVALID_ARGUMENT/);
      expect(
        await t.query(api.example.getStatesForSubject, { subjectRef: "" }),
      ).toEqual([]);
      expect(
        await t.query(api.example.getState, {
          subjectRef: "s_1",
          purpose: "analytics",
        }),
      ).toBeNull();
    },
  );

  test.each(["subjectRef", "purpose"] as const)(
    "withdraw rejects an empty %s",
    async (field) => {
      const t = setup();
      await expect(
        t.mutation(api.example.withdraw, {
          subjectRef: "s_1",
          purpose: "analytics",
          [field]: "",
        }),
      ).rejects.toThrow(/INVALID_ARGUMENT/);
    },
  );
});

describe("consent — withdraw (GDPR Art. 7(3))", () => {
  test("withdraw a granted consent → no longer granted, ledger records it", async () => {
    const t = setup();
    await t.mutation(api.example.record, {
      subjectRef: "w",
      purpose: "analytics",
      decision: "granted",
      version: "1",
    });
    vi.setSystemTime(500);
    const { at } = await t.mutation(api.example.withdraw, {
      subjectRef: "w",
      purpose: "analytics",
      proof: { reason: "user request" },
    });
    expect(at).toBe(500);

    const gate = await t.query(api.example.check, {
      subjectRef: "w",
      purpose: "analytics",
    });
    expect(gate.granted).toBe(false);
    expect(gate.decision).toBe("withdrawn");

    const hist = await t.query(api.example.history, {
      subjectRef: "w",
      purpose: "analytics",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(hist.page.map((e) => e.decision)).toEqual(["withdrawn", "granted"]);
    expect(hist.page[0]?.proof).toEqual({ reason: "user request" });
  });

  test("withdraw with no prior consent throws NO_CONSENT (adversarial)", async () => {
    const t = setup();
    await expect(
      t.mutation(api.example.withdraw, {
        subjectRef: "never",
        purpose: "analytics",
      }),
    ).rejects.toThrow(/no consent recorded/);
  });

  test("withdraw when current decision is not granted throws NOT_GRANTED (adversarial)", async () => {
    const t = setup();
    await t.mutation(api.example.record, {
      subjectRef: "wd",
      purpose: "analytics",
      decision: "denied",
      version: "1",
    });
    await expect(
      t.mutation(api.example.withdraw, {
        subjectRef: "wd",
        purpose: "analytics",
      }),
    ).rejects.toThrow(/not.*granted/);
    // the original decision is untouched
    const state = await t.query(api.example.getState, {
      subjectRef: "wd",
      purpose: "analytics",
    });
    expect(state?.decision).toBe("denied");
  });

  test("re-withdrawing an already-withdrawn consent throws NOT_GRANTED", async () => {
    const t = setup();
    await t.mutation(api.example.record, {
      subjectRef: "ww",
      purpose: "analytics",
      decision: "granted",
      version: "1",
    });
    await t.mutation(api.example.withdraw, {
      subjectRef: "ww",
      purpose: "analytics",
    });
    await expect(
      t.mutation(api.example.withdraw, {
        subjectRef: "ww",
        purpose: "analytics",
      }),
    ).rejects.toThrow(/not.*granted/);
  });

  test("withdraw keeps the grant's version, not the client defaultVersion", async () => {
    const t = setup();
    await t.mutation(api.example.record, {
      subjectRef: "wv",
      purpose: "analytics",
      decision: "granted",
      version: "2024",
    });
    await t.mutation(api.example.withdraw, { subjectRef: "wv", purpose: "analytics" });
    const state = await t.query(api.example.getState, {
      subjectRef: "wv",
      purpose: "analytics",
    });
    expect(state?.decision).toBe("withdrawn");
    expect(state?.version).toBe("2024");
    const hist = await t.query(api.example.history, {
      subjectRef: "wv",
      purpose: "analytics",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(hist.page.map((e) => [e.decision, e.version])).toEqual([
      ["withdrawn", "2024"],
      ["granted", "2024"],
    ]);
  });

  test("record(..., \"withdrawn\") with no prior grant writes a withdrawn event and state (idempotent revoke)", async () => {
    const t = setup();
    for (const at of [0, 1]) {
      vi.setSystemTime(at);
      await t.mutation(api.example.record, {
        subjectRef: "rw",
        purpose: "analytics",
        decision: "withdrawn",
        version: "1",
      });
    }
    const state = await t.query(api.example.getState, {
      subjectRef: "rw",
      purpose: "analytics",
    });
    expect(state).toEqual({
      subjectRef: "rw",
      purpose: "analytics",
      decision: "withdrawn",
      version: "1",
      at: 1,
    });
    const hist = await t.query(api.example.history, {
      subjectRef: "rw",
      purpose: "analytics",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(hist.page.map((e) => e.decision)).toEqual(["withdrawn", "withdrawn"]);
  });
});

describe("consent — getStatesForSubject", () => {
  test("returns every purpose held by one subject", async () => {
    const t = setup();
    await t.mutation(api.example.record, {
      subjectRef: "multi",
      purpose: "analytics",
      decision: "granted",
      version: "1",
    });
    await t.mutation(api.example.record, {
      subjectRef: "multi",
      purpose: "marketing",
      decision: "denied",
      version: "1",
    });
    const states = await t.query(api.example.getStatesForSubject, {
      subjectRef: "multi",
    });
    expect(states).toHaveLength(2);
    expect(states.map((s) => s.purpose).sort()).toEqual([
      "analytics",
      "marketing",
    ]);
  });

  test("returns an empty array for an unknown subject", async () => {
    const t = setup();
    expect(
      await t.query(api.example.getStatesForSubject, { subjectRef: "none" }),
    ).toEqual([]);
  });
});

describe("consent — history (paginated ledger)", () => {
  test("respects the page size and returns a continue cursor, newest-first", async () => {
    const t = setup();
    for (let i = 0; i < 3; i++) {
      vi.setSystemTime(i);
      await t.mutation(api.example.record, {
        subjectRef: "h",
        purpose: "analytics",
        decision: i % 2 === 0 ? "granted" : "denied",
        version: "1",
      });
    }
    const first = await t.query(api.example.history, {
      subjectRef: "h",
      purpose: "analytics",
      paginationOpts: { cursor: null, numItems: 2 },
    });
    expect(first.page).toHaveLength(2);
    expect(first.isDone).toBe(false);
    // newest-first: at=2 then at=1
    expect(first.page.map((e) => e.at)).toEqual([2, 1]);

    const second = await t.query(api.example.history, {
      subjectRef: "h",
      purpose: "analytics",
      paginationOpts: { cursor: first.continueCursor, numItems: 2 },
    });
    expect(second.page).toHaveLength(1);
    expect(second.isDone).toBe(true);
    expect(second.page[0]?.at).toBe(0);
  });

  test("history on an empty pair returns an empty done page", async () => {
    const t = setup();
    const r = await t.query(api.example.history, {
      subjectRef: "empty",
      purpose: "analytics",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(r.page).toEqual([]);
    expect(r.isDone).toBe(true);
  });
});

describe("consent — host proof validator + defaultVersion (strict client)", () => {
  test("valid proof round-trips and the default version is applied", async () => {
    const t = setup();
    await t.mutation(api.example.recordStrict, {
      subjectRef: "s_ok",
      purpose: "analytics",
      proof: { policyHash: "abc" },
    });
    const gate = await t.query(api.example.check, {
      subjectRef: "s_ok",
      purpose: "analytics",
      requiredVersion: "2024-policy",
    });
    expect(gate.granted).toBe(true);
    expect(gate.version).toBe("2024-policy");

    const hist = await t.query(api.example.historyStrict, {
      subjectRef: "s_ok",
      purpose: "analytics",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(hist.page[0]?.proof).toEqual({ policyHash: "abc" });
  });

  test("invalid proof is rejected before storage (record)", async () => {
    const t = setup();
    await expect(
      t.mutation(api.example.recordStrict, {
        subjectRef: "s_bad",
        purpose: "analytics",
        proof: { policyHash: 123 },
      }),
    ).rejects.toThrow(/invalid proof/);
    // nothing landed
    expect(
      await t.query(api.example.getState, {
        subjectRef: "s_bad",
        purpose: "analytics",
      }),
    ).toBeNull();
  });

  test("invalid proof is rejected on withdraw too", async () => {
    const t = setup();
    await t.mutation(api.example.recordStrict, {
      subjectRef: "s_w",
      purpose: "analytics",
      proof: { policyHash: "abc" },
    });
    await expect(
      t.mutation(api.example.withdrawStrict, {
        subjectRef: "s_w",
        purpose: "analytics",
        proof: { policyHash: 999 },
      }),
    ).rejects.toThrow(/invalid proof/);
  });

  test("the validator's output is stored, not the raw input", async () => {
    const t = setup();
    await t.mutation(api.example.recordStrict, {
      subjectRef: "s_narrow",
      purpose: "analytics",
      proof: { policyHash: "abc", extra: "dropped" },
    });
    // read through the client without a validator: the stored value is the narrowed one
    const hist = await t.query(api.example.history, {
      subjectRef: "s_narrow",
      purpose: "analytics",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(hist.page[0]?.proof).toEqual({ policyHash: "abc" });
  });

  test("a stored proof the validator rejects makes history throw on read", async () => {
    const t = setup();
    // stored by the client without a validator
    await t.mutation(api.example.record, {
      subjectRef: "s_read",
      purpose: "analytics",
      decision: "granted",
      version: "1",
      proof: { policyHash: 123 },
    });
    await expect(
      t.query(api.example.historyStrict, {
        subjectRef: "s_read",
        purpose: "analytics",
        paginationOpts: { cursor: null, numItems: 10 },
      }),
    ).rejects.toThrow(/invalid proof/);
  });

  test("defaultVersion defaults to \"1\" when the client has no options", async () => {
    const t = setup();
    await t.mutation(api.example.record, {
      subjectRef: "dv",
      purpose: "analytics",
      decision: "granted",
    });
    await t.mutation(api.example.recordMarketing, {
      subjectRef: "dv",
      purpose: "analytics",
      decision: "granted",
    });
    expect(
      (await t.query(api.example.getState, { subjectRef: "dv", purpose: "analytics" }))?.version,
    ).toBe("1");
    expect(
      (await t.query(api.example.getMarketingState, { subjectRef: "dv", purpose: "analytics" }))
        ?.version,
    ).toBe("1");
  });
});

describe("consent — mount-safety (independent named mount)", () => {
  test("the same subject+purpose in two mounts is independent", async () => {
    const t = setup();
    await t.mutation(api.example.record, {
      subjectRef: "shared",
      purpose: "analytics",
      decision: "granted",
      version: "1",
    });
    await t.mutation(api.example.recordMarketing, {
      subjectRef: "shared",
      purpose: "analytics",
      decision: "denied",
    });
    expect(
      (await t.query(api.example.getState, {
        subjectRef: "shared",
        purpose: "analytics",
      }))?.decision,
    ).toBe("granted");
    expect(
      (await t.query(api.example.getMarketingState, {
        subjectRef: "shared",
        purpose: "analytics",
      }))?.decision,
    ).toBe("denied");
    expect(await t.mutation(api.example.pruneMarketing, {})).toBe(0);
  });

  test("check and history are isolated between the default and marketing mounts", async () => {
    const t = setup();
    await t.mutation(api.example.record, {
      subjectRef: "iso2",
      purpose: "analytics",
      decision: "granted",
      version: "1",
    });
    await t.mutation(api.example.recordMarketing, {
      subjectRef: "iso2",
      purpose: "ads",
      decision: "denied",
    });
    const pair = (purpose: string) => ({ subjectRef: "iso2", purpose });
    const page = { paginationOpts: { cursor: null, numItems: 10 } };

    // default mount sees only its own analytics grant
    expect((await t.query(api.example.check, pair("analytics"))).granted).toBe(true);
    expect((await t.query(api.example.check, pair("ads"))).decision).toBeNull();
    expect(
      (await t.query(api.example.history, { ...pair("analytics"), ...page })).page,
    ).toHaveLength(1);
    expect((await t.query(api.example.history, { ...pair("ads"), ...page })).page).toEqual([]);

    // marketing mount sees only its own ads denial
    const marketingCheck = await t.query(components.marketing.queries.check, pair("ads"));
    expect(marketingCheck.decision).toBe("denied");
    expect(marketingCheck.granted).toBe(false);
    expect(
      (await t.query(components.marketing.queries.check, pair("analytics"))).decision,
    ).toBeNull();
    const marketingHistory = await t.query(components.marketing.queries.history, {
      ...pair("ads"),
      ...page,
    });
    expect(marketingHistory.page.map((e) => e.decision)).toEqual(["denied"]);
    expect(
      (await t.query(components.marketing.queries.history, { ...pair("analytics"), ...page }))
        .page,
    ).toEqual([]);
  });
});

describe("consent — prune (bounded, ledger-only, self-rescheduling)", () => {
  test("prunes only ledger events past the cutoff, keeps current state", async () => {
    const t = setup();
    // old event
    await t.mutation(api.example.record, {
      subjectRef: "p",
      purpose: "analytics",
      decision: "granted",
      version: "1",
    });
    // a fresh event after the cutoff
    vi.setSystemTime(1_000);
    await t.mutation(api.example.record, {
      subjectRef: "p",
      purpose: "analytics",
      decision: "denied",
      version: "1",
    });

    const removed = await t.mutation(api.example.prune, {
      before: 100,
      batch: 200,
    });
    expect(removed).toBe(1);

    // ledger lost the old row but kept the fresh one
    const hist = await t.query(api.example.history, {
      subjectRef: "p",
      purpose: "analytics",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(hist.page.map((e) => e.at)).toEqual([1_000]);

    // current state (the live gate) is untouched
    const state = await t.query(api.example.getState, {
      subjectRef: "p",
      purpose: "analytics",
    });
    expect(state?.decision).toBe("denied");
  });

  test("prune with no cutoff honors the 365-day retention window", async () => {
    const t = setup();
    await t.mutation(api.example.record, {
      subjectRef: "d",
      purpose: "analytics",
      decision: "granted",
      version: "1",
    });
    vi.setSystemTime(31_536_000_000);
    expect(await t.mutation(api.example.prune, {})).toBe(0);
    vi.setSystemTime(31_536_000_001);
    expect(await t.mutation(api.example.prune, {})).toBe(1);
  });

  test.each([1, 500])("accepts the batch bound %s", async (batch) => {
    const t = setup();
    await t.mutation(api.example.record, {
      subjectRef: "b",
      purpose: "analytics",
      decision: "granted",
      version: "1",
    });
    expect(await t.mutation(api.example.prune, { before: 1, batch })).toBe(1);
  });

  test.each([Number.NaN, 0, -1, 1.5, 501, Infinity])("rejects invalid batch %s", async (batch) => {
    const t = setup();
    await expect(t.mutation(api.example.prune, { batch })).rejects.toThrow(
      /INVALID_BATCH|integer between/,
    );
  });

  test.each([Number.NaN, Infinity, -Infinity])("rejects the non-finite cutoff %s", async (before) => {
    const t = setup();
    await expect(
      t.mutation(api.example.prune, { before }),
    ).rejects.toThrow(/INVALID_BEFORE|finite/);
  });

  test("prune on an empty ledger returns 0", async () => {
    const t = setup();
    expect(
      await t.mutation(api.example.prune, { before: 9_999_999, batch: 200 }),
    ).toBe(0);
  });

  test("prune above the batch size self-reschedules and clears the whole tail", async () => {
    const t = setup();
    for (let i = 0; i < 5; i++) {
      vi.setSystemTime(i);
      await t.mutation(api.example.record, {
        subjectRef: `t${i}`,
        purpose: "analytics",
        decision: "granted",
        version: "1",
      });
    }
    vi.setSystemTime(1_000);
    const firstPass = await t.mutation(api.example.prune, {
      before: 1_000,
      batch: 2,
    });
    expect(firstPass).toBe(2);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    // all 5 ledger events swept
    for (let i = 0; i < 5; i++) {
      const hist = await t.query(api.example.history, {
        subjectRef: `t${i}`,
        purpose: "analytics",
        paginationOpts: { cursor: null, numItems: 10 },
      });
      expect(hist.page).toEqual([]);
    }
  });

  test("a tail that is an exact multiple of the batch is cleared and the sweep stops", async () => {
    const t = setup();
    for (let i = 0; i < 4; i++) {
      vi.setSystemTime(i);
      await t.mutation(api.example.record, {
        subjectRef: "m",
        purpose: "analytics",
        decision: "granted",
        version: "1",
      });
    }
    vi.setSystemTime(1_000);
    expect(await t.mutation(api.example.prune, { before: 1_000, batch: 2 })).toBe(2);
    // the second full pass reschedules once more; the empty third pass stops
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const hist = await t.query(api.example.history, {
      subjectRef: "m",
      purpose: "analytics",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(hist.page).toEqual([]);
    expect(await t.mutation(api.example.prune, { before: 1_000, batch: 2 })).toBe(0);
  });

  test("the default batch is 200 and the scheduler clears the rest", async () => {
    const t = setup();
    for (let i = 0; i < 201; i++) {
      vi.setSystemTime(i);
      await t.mutation(api.example.record, {
        subjectRef: "bulk",
        purpose: "analytics",
        decision: "granted",
        version: "1",
      });
    }
    vi.setSystemTime(1_000);
    const history = () =>
      t.query(api.example.history, {
        subjectRef: "bulk",
        purpose: "analytics",
        paginationOpts: { cursor: null, numItems: 10 },
      });
    expect(await t.mutation(api.example.prune, { before: 1_000 })).toBe(200);
    // oldest first: only the newest event survives the first pass
    expect((await history()).page.map((e) => e.at)).toEqual([200]);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await history()).page).toEqual([]);
  });
});

describe("consent — built-in prune cron", () => {
  test("registers a daily self-rescheduling prune job with the default page size", () => {
    expect(PRUNE_INTERVAL).toEqual({ hours: 24 });
    expect(PRUNE_BATCH).toBe(200);
    expect(Object.keys(crons.crons)).toContain("consent:prune");
    const job = crons.crons["consent:prune"];
    expect(job?.name).toBe("mutations:prune");
    expect(job?.args).toEqual([{ batch: 200 }]);
  });
});

describe("consent — host/component table isolation", () => {
  test("the host purpose catalog lives in the host table, separate from the component", async () => {
    const t = setup();
    await t.mutation(api.example.record, {
      subjectRef: "iso",
      purpose: "analytics",
      decision: "granted",
      version: "1",
    });
    await t.mutation(api.example.addPurpose, {
      key: "analytics",
      requiredVersion: "1",
    });
    // the host catalog is readable from the host table
    expect(await t.query(api.example.getPurpose, { key: "analytics" })).toBe("1");
    // the component consent is unaffected
    expect(
      (await t.query(api.example.getState, {
        subjectRef: "iso",
        purpose: "analytics",
      }))?.decision,
    ).toBe("granted");
    // a purpose in the catalog with no consent row is fine — fully decoupled
    await t.mutation(api.example.addPurpose, {
      key: "orphan",
      requiredVersion: "1",
    });
    expect(await t.query(api.example.getPurpose, { key: "orphan" })).toBe("1");
    expect(
      await t.query(api.example.getState, {
        subjectRef: "iso",
        purpose: "orphan",
      }),
    ).toBeNull();
  });
});
