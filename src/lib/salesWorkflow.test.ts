import { describe, it, expect } from "vitest";
import { Types } from "mongoose";
import {
  SALES_STAGES, MIN_STAGE_BY_ROLE, stagesAt, nextStageIndex, isTerminal,
  stageComplete, stageSkipped, nextLiveStageIndex,
  actableStages, canReject, canCreate, canEdit,
  authorityFor, visibilityFilter, andFilters, stageByKey,
  type OrderLike, type StepLike, type Actor,
} from "./salesWorkflow";

const oid = () => new Types.ObjectId().toString();
const ME = oid();
const SOMEONE_ELSE = oid();

/** An order sitting at `stageIndex`, with everything before it approved. */
function orderAt(stageIndex: number, over: Partial<OrderLike> = {}): OrderLike {
  const steps: StepLike[] = SALES_STAGES.map((s) => ({
    stageKey: s.key,
    stageIndex: s.index,
    role: s.role,
    kind: s.kind,
    status: s.index < stageIndex ? (s.index === 1 ? "completed" : "approved") : "pending",
  }));
  return {
    status: "Pending",
    currentStageIndex: stageIndex,
    createdById: SOMEONE_ELSE,
    steps,
    ...over,
  };
}

const actor = (role: string, id = ME): Actor => ({ id, role });

/**
 * An order with no lab-tested product: stage 6 written off at creation, every
 * stage before `stageIndex` signed. The shape `buildInitialSteps` produces for
 * an order of bran, germ, semolina or wheat.
 */
function untestedOrderAt(stageIndex: number, over: Partial<OrderLike> = {}): OrderLike {
  const base = orderAt(stageIndex, over);
  return {
    ...base,
    steps: base.steps.map((s) =>
      s.kind === "data_entry" ? { ...s, status: "skipped" } : s
    ),
  };
}

describe("the stage table", () => {
  it("declares eight visible stages, one slot each", () => {
    expect(new Set(SALES_STAGES.map((s) => s.index)).size).toBe(8);
    expect(SALES_STAGES).toHaveLength(8);
  });

  it("holds stage 7 with a single slot — the GM's signature alone clears the lab results", () => {
    const seven = stagesAt(7);
    expect(seven).toHaveLength(1);
    expect(seven[0].role).toBe("general_manager");
  });

  it("gives stages 5, 7 and 8 no automatic deputy, by client decision", () => {
    for (const key of ["technical_manager_approval", "lab_signoff_gm", "weighbridge_post"]) {
      expect(stageByKey(key)?.deputyRole).toBeUndefined();
    }
  });

  it("stops at stage 8", () => {
    expect(nextStageIndex(7)).toBe(8);
    expect(nextStageIndex(8)).toBeNull();
  });
});

describe("MIN_STAGE_BY_ROLE — the visibility floor", () => {
  it("is derived over deputy roles too, or a deputy could not see what they cover", () => {
    // The accountant owns no stage; he only deputises for finance at stage 3.
    expect(SALES_STAGES.some((s) => s.role === "accountant")).toBe(false);
    expect(MIN_STAGE_BY_ROLE.accountant).toBe(3);
  });

  it("gives each chain role its earliest slot", () => {
    expect(MIN_STAGE_BY_ROLE.sales_coordinator).toBe(1);
    expect(MIN_STAGE_BY_ROLE.sales_manager).toBe(1);      // deputy for stage 1
    expect(MIN_STAGE_BY_ROLE.finance_manager).toBe(3);
    expect(MIN_STAGE_BY_ROLE.general_manager).toBe(4);
    expect(MIN_STAGE_BY_ROLE.technical_manager).toBe(5);
    expect(MIN_STAGE_BY_ROLE.lab_technician).toBe(6);
    expect(MIN_STAGE_BY_ROLE.weighbridge).toBe(8);
  });

  it("has no floor for a role outside the chain", () => {
    expect(MIN_STAGE_BY_ROLE.technician).toBeUndefined();
  });
});

describe("stageComplete", () => {
  it("needs no special case for single-slot stages", () => {
    const o = orderAt(3);
    expect(stageComplete(o, 2)).toBe(true);
    expect(stageComplete(o, 3)).toBe(false);
  });

  it("stage 7 clears on the GM's signature alone", () => {
    const o = orderAt(7);
    expect(stageComplete(o, 7)).toBe(false);
    o.steps.find((s) => s.stageKey === "lab_signoff_gm")!.status = "approved";
    expect(stageComplete(o, 7)).toBe(true);
  });

  it("ignores an orphaned step from a stage reduced from two signatures to one", () => {
    // An order raised before this change can still carry the old
    // `lab_signoff_tm` step, forever "pending", in its stored `steps` array —
    // SALES_STAGES no longer defines it, so it must not block the GM's own
    // signature from completing the stage.
    const o = orderAt(7);
    o.steps.push({ stageKey: "lab_signoff_tm", stageIndex: 7, role: "technical_manager", kind: "approval", status: "pending" });
    o.steps.find((s) => s.stageKey === "lab_signoff_gm")!.status = "approved";
    expect(stageComplete(o, 7)).toBe(true);
  });
});

describe("stageSkipped — a stage written off the route", () => {
  it("is false on a flour order, whose stage 6 is merely pending", () => {
    expect(stageSkipped(orderAt(5), 6)).toBe(false);
  });

  it("is true on an untested order's stage 6", () => {
    expect(stageSkipped(untestedOrderAt(5), 6)).toBe(true);
  });

  it("leaves stage 7 live on an untested order — the GM still signs", () => {
    expect(stageSkipped(untestedOrderAt(5), 7)).toBe(false);
  });

  it("never reports a signed stage as skipped", () => {
    const o = untestedOrderAt(7);
    for (const i of [1, 2, 3, 4, 5]) expect(stageSkipped(o, i)).toBe(false);
  });

  /**
   * The trap this function has to be used around, stated as a test so nobody
   * "fixes" it: `rejectOrder` marks every pending step skipped so the ladder
   * can say "never reached", which makes this true for stages that were simply
   * never arrived at. That is why only a LIVE order may be asked.
   */
  it("also reports true for merely-unreached stages on a rejected order", () => {
    const killed = orderAt(3, { status: "Rejected" });
    killed.steps = killed.steps.map((s) =>
      s.status === "pending" ? { ...s, status: "skipped" } : s
    );
    expect(stageSkipped(killed, 6)).toBe(true);
    expect(stageSkipped(killed, 8)).toBe(true);
  });
});

describe("nextLiveStageIndex — where an order actually goes next", () => {
  it("matches nextStageIndex on a flour order", () => {
    const o = orderAt(5);
    for (const i of [1, 2, 3, 4, 5, 6, 7]) {
      expect(nextLiveStageIndex(o, i)).toBe(nextStageIndex(i));
    }
  });

  it("jumps 5 → 7 on an untested order, skipping the lab", () => {
    expect(nextLiveStageIndex(untestedOrderAt(5), 5)).toBe(7);
  });

  it("returns null at the final stage, which is what posts the order", () => {
    expect(nextLiveStageIndex(orderAt(8), 8)).toBeNull();
    expect(nextLiveStageIndex(untestedOrderAt(8), 8)).toBeNull();
  });

  /**
   * `currentStageIndex` is monotonic, and the entire visibility model is one
   * indexed range query because of it. Skipping may only ever move the pointer
   * further forward.
   */
  it("is strictly forward-only, on both routes", () => {
    for (const o of [orderAt(5), untestedOrderAt(5)]) {
      for (const i of [1, 2, 3, 4, 5, 6, 7, 8]) {
        const n = nextLiveStageIndex(o, i);
        expect(n === null || n > i).toBe(true);
      }
    }
  });

  it("does not skip stage 6 just because it is already signed", () => {
    // A completed stage is not a skipped one: an order that HAS been through
    // the lab must still be reported as having 7 next, not 8.
    const done = orderAt(7);
    expect(nextLiveStageIndex(done, 6)).toBe(7);
  });
});

describe("actableStages", () => {
  it("offers the slot to the role that owns it", () => {
    expect(actableStages(orderAt(3), actor("finance_manager")).map((s) => s.key))
      .toEqual(["finance_manager_approval"]);
  });

  it("offers nothing to a role whose turn has not come", () => {
    expect(actableStages(orderAt(3), actor("weighbridge"))).toHaveLength(0);
  });

  it("offers stage 7 to the GM only — the technical manager has no slot there", () => {
    expect(actableStages(orderAt(7), actor("general_manager")).map((s) => s.key))
      .toEqual(["lab_signoff_gm"]);
    expect(actableStages(orderAt(7), actor("technical_manager"))).toHaveLength(0);
  });

  it("stops offering stage 7 once the GM has signed", () => {
    const o = orderAt(7);
    o.steps.find((s) => s.stageKey === "lab_signoff_gm")!.status = "approved";
    expect(actableStages(o, actor("general_manager"))).toHaveLength(0);
  });

  it("offers admin the single stage-7 slot", () => {
    expect(actableStages(orderAt(7), actor("admin"))).toHaveLength(1);
  });

  it("offers nothing on a terminal order — rejection is final", () => {
    expect(actableStages(orderAt(3, { status: "Rejected" }), actor("finance_manager"))).toHaveLength(0);
    expect(actableStages(orderAt(8, { status: "Posted" }), actor("weighbridge"))).toHaveLength(0);
  });
});

describe("canReject", () => {
  it("lets the GM kill a live order at any stage, per the client's rule", () => {
    for (const i of [2, 3, 5, 6, 8]) {
      expect(canReject(orderAt(i), actor("general_manager"))).toBe(true);
    }
  });

  it("lets an approver reject only on their own live slot", () => {
    expect(canReject(orderAt(3), actor("finance_manager"))).toBe(true);
    expect(canReject(orderAt(5), actor("finance_manager"))).toBe(false);
  });

  it("never lets the lab reject — stage 6 records data, it does not approve", () => {
    expect(canReject(orderAt(6), actor("lab_technician"))).toBe(false);
  });

  it("is false once the order is terminal, even for the GM", () => {
    expect(canReject(orderAt(4, { status: "Rejected" }), actor("general_manager"))).toBe(false);
  });
});

describe("canCreate and canEdit", () => {
  it("lets the coordinator and the sales manager raise an order", () => {
    expect(canCreate(actor("sales_coordinator"))).toBe(true);
    expect(canCreate(actor("sales_manager"))).toBe(true);
    expect(canCreate(actor("finance_manager"))).toBe(false);
  });

  it("locks editing the moment anyone approves", () => {
    const mine = orderAt(2, { createdById: ME });
    expect(canEdit(mine, actor("sales_coordinator"))).toBe(true);
    expect(canEdit({ ...mine, currentStageIndex: 3 }, actor("sales_coordinator"))).toBe(false);
  });

  it("does not let one coordinator edit another's order", () => {
    expect(canEdit(orderAt(2), actor("sales_coordinator"))).toBe(false);
  });
});

describe("authorityFor — primary, delegate, deputy", () => {
  const financeStage = stageByKey("finance_manager_approval")!;
  const technicalStage = stageByKey("technical_manager_approval")!;

  it("grants the primary regardless of anyone's absence", () => {
    expect(authorityFor(financeStage, actor("finance_manager"), { primaryRoleIsAbsent: false }))
      .toEqual({ kind: "primary" });
  });

  it("refuses the deputy while the primary is present — a deputy is not a second approver", () => {
    expect(authorityFor(financeStage, actor("accountant"), { primaryRoleIsAbsent: false }))
      .toBeNull();
  });

  it("grants the deputy once every holder of the role is away", () => {
    expect(authorityFor(financeStage, actor("accountant"), { primaryRoleIsAbsent: true }))
      .toEqual({ kind: "deputy", forRole: "finance_manager" });
  });

  it("grants a named delegate whether or not the primary is away", () => {
    expect(authorityFor(financeStage, actor("sales_coordinator"), {
      liveDelegationRoles: ["finance_manager"], primaryRoleIsAbsent: false,
    })).toEqual({ kind: "delegate", forRole: "finance_manager" });
  });

  it("grants nobody a deputy slot on stages that have none", () => {
    expect(authorityFor(technicalStage, actor("finance_manager"), { primaryRoleIsAbsent: true }))
      .toBeNull();
  });

  it("still allows a named delegate on a stage with no deputy", () => {
    expect(authorityFor(technicalStage, actor("finance_manager"), {
      liveDelegationRoles: ["technical_manager"],
    })).toEqual({ kind: "delegate", forRole: "technical_manager" });
  });
});

describe("visibilityFilter — the confidentiality model", () => {
  const stageOf = (f: Record<string, unknown>): number | undefined => {
    const or = (f.$or ?? []) as Record<string, { $gte?: number }>[];
    const clause = or.find((c) => c.currentStageIndex);
    return clause?.currentStageIndex?.$gte;
  };

  it("gives admin everything with no $or at all", () => {
    const f = visibilityFilter(actor("admin"));
    expect(f).toEqual({ isActive: true });
  });

  it("gives the GM everything — he sees an order from creation", () => {
    const f = visibilityFilter(actor("general_manager"));
    expect(f).toEqual({ isActive: true });
  });

  it("floors each role at its earliest stage", () => {
    expect(stageOf(visibilityFilter(actor("finance_manager")))).toBe(3);
    expect(stageOf(visibilityFilter(actor("technical_manager")))).toBe(5);
    expect(stageOf(visibilityFilter(actor("lab_technician")))).toBe(6);
    expect(stageOf(visibilityFilter(actor("weighbridge")))).toBe(8);
    // Owns no stage; floored at the one he deputises for.
    expect(stageOf(visibilityFilter(actor("accountant")))).toBe(3);
  });

  it("restricts the coordinator to his own orders — no stage clause at all", () => {
    const f = visibilityFilter(actor("sales_coordinator"));
    expect(stageOf(f)).toBeUndefined();
    const or = (f.$or ?? []) as Record<string, unknown>[];
    expect(or).toHaveLength(2); // createdById + steps.actedById
  });

  it("always lets anyone see what they created or ever acted on", () => {
    const f = visibilityFilter(actor("weighbridge"));
    const keys = ((f.$or ?? []) as Record<string, unknown>[]).flatMap((c) => Object.keys(c));
    expect(keys).toContain("createdById");
    expect(keys).toContain("steps.actedById");
  });

  it("shows a role outside the chain nothing at all", () => {
    const f = visibilityFilter({ id: "not-an-object-id", role: "technician" });
    expect(f._id).toEqual({ $in: [] });
  });

  it("lowers the floor when a delegation grants an earlier role", () => {
    // The weighbridge normally sees nothing before stage 8. Delegated the
    // finance role, he must be able to see the stage-3 orders he now signs.
    expect(stageOf(visibilityFilter(actor("weighbridge"), ["finance_manager"]))).toBe(3);
  });
});

describe("andFilters", () => {
  it("keeps two $or fragments from silently overwriting each other", () => {
    const visibility = { isActive: true, $or: [{ a: 1 }, { b: 2 }] };
    const search = { $or: [{ c: 3 }] };
    const combined = andFilters(visibility, search) as Record<string, unknown>;

    expect(combined.$and).toHaveLength(2);
    expect(combined.$or).toBeUndefined();
    expect(combined.isActive).toBe(true);
  });

  it("merges plain fragments flatly", () => {
    expect(andFilters({ a: 1 }, { b: 2 }, null)).toEqual({ a: 1, b: 2 });
  });

  it("does not wrap when only one fragment has an operator", () => {
    expect(andFilters({ a: 1 })).toEqual({ a: 1 });
  });
});

describe("isTerminal", () => {
  it("treats Posted and Rejected as ends of the line", () => {
    expect(isTerminal("Posted")).toBe(true);
    expect(isTerminal("Rejected")).toBe(true);
    expect(isTerminal("Pending")).toBe(false);
  });
});
