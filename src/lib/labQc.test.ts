import { describe, it, expect } from "vitest";
import {
  warningBand, evaluate, deviationFromTarget, rollUpStatus,
  stdDev, coefficientOfVariation, rate,
} from "./labQc";

describe("warningBand", () => {
  it("is 15% of the range width when both bounds are known", () => {
    expect(warningBand(0, 100)).toBe(15);
    expect(warningBand(10, 20)).toBeCloseTo(1.5);
  });

  it("is 15% of the distance to target for a one-sided spec", () => {
    expect(warningBand(null, 100, 80)).toBeCloseTo(3);   // n_m_t-style: max + target
    expect(warningBand(10, null, 20)).toBeCloseTo(1.5);  // n_l_t-style: min + target
  });

  it("is null when there is no natural scale", () => {
    expect(warningBand(null, null, 50)).toBeNull();
    expect(warningBand(null, null)).toBeNull();
    expect(warningBand(10, null)).toBeNull(); // one bound, no target: nothing to measure against
  });
});

describe("evaluate", () => {
  it("operator none always passes, regardless of value or bounds", () => {
    expect(evaluate(9999, 0, 1, "none")).toBe("pass");
    expect(evaluate(-9999, 0, 1, "none")).toBe("pass");
  });

  describe("n_m_t (not more than)", () => {
    it("is boundary-inclusive at max when there is no band", () => {
      // No target and no min → warningBand is null → hard limit only.
      expect(evaluate(100, null, 100, "n_m_t")).toBe("pass");
    });
    it("fails just over max", () => {
      expect(evaluate(100.01, null, 100, "n_m_t")).toBe("fail");
    });
    it("warns inside the band below max, when a target gives it a scale", () => {
      // band = |max-target|*0.15 = |100-80|*0.15 = 3
      expect(evaluate(99, null, 100, "n_m_t", 80)).toBe("warning");
      expect(evaluate(95, null, 100, "n_m_t", 80)).toBe("pass"); // outside the 3-unit band
    });
  });

  describe("n_l_t (not less than)", () => {
    it("is boundary-inclusive at min when there is no band", () => {
      expect(evaluate(10, 10, null, "n_l_t")).toBe("pass");
    });
    it("fails just under min", () => {
      expect(evaluate(9.99, 10, null, "n_l_t")).toBe("fail");
    });
    it("warns inside the band above min, when a target gives it a scale", () => {
      // band = |target-min|*0.15 = |20-10|*0.15 = 1.5
      expect(evaluate(11, 10, null, "n_l_t", 20)).toBe("warning");
      expect(evaluate(15, 10, null, "n_l_t", 20)).toBe("pass"); // outside the 1.5-unit band
    });
  });

  describe("range", () => {
    // min=0, max=100 → band = 100*0.15 = 15
    it("fails outside either edge", () => {
      expect(evaluate(-1, 0, 100, "range")).toBe("fail");
      expect(evaluate(101, 0, 100, "range")).toBe("fail");
    });
    it("hard-limit failure wins even where the value would otherwise be in-band", () => {
      // -0.01 is only just below min, well within band-distance of it, but it's
      // still out of range — being out of range always wins (source order:
      // hard limits are checked before the band).
      expect(evaluate(-0.01, 0, 100, "range")).toBe("fail");
    });
    it("warns inside the band near either edge", () => {
      expect(evaluate(10, 0, 100, "range")).toBe("warning");  // within 15 of min
      expect(evaluate(90, 0, 100, "range")).toBe("warning");  // within 15 of max
    });
    it("passes dead center", () => {
      expect(evaluate(50, 0, 100, "range")).toBe("pass");
    });
    it("degenerate range (min === max): only the exact value passes", () => {
      expect(evaluate(5, 5, 5, "range")).toBe("pass");
      expect(evaluate(5.01, 5, 5, "range")).toBe("fail");
      expect(evaluate(4.99, 5, 5, "range")).toBe("fail");
    });
    it("with both bounds null, no hard limit can ever trip", () => {
      expect(evaluate(999999, null, null, "range")).toBe("pass");
      expect(evaluate(-999999, null, null, "range")).toBe("pass");
    });
  });
});

describe("deviationFromTarget", () => {
  it("is null with no target", () => {
    expect(deviationFromTarget(5, null)).toBeNull();
    expect(deviationFromTarget(5, undefined)).toBeNull();
  });
  it("is null when target is exactly zero (divide-by-zero guard)", () => {
    expect(deviationFromTarget(5, 0)).toBeNull();
  });
  it("is 0 when the value equals the target", () => {
    expect(deviationFromTarget(100, 100)).toBe(0);
  });
  it("is signed and relative", () => {
    expect(deviationFromTarget(110, 100)).toBeCloseTo(0.1);
    expect(deviationFromTarget(90, 100)).toBeCloseTo(-0.1);
  });
});

describe("rollUpStatus", () => {
  it("any fail beats everything", () => {
    expect(rollUpStatus(["pass", "warning", "fail"])).toBe("fail");
    expect(rollUpStatus(["fail"])).toBe("fail");
    expect(rollUpStatus(["fail", "fail"])).toBe("fail");
  });
  it("warning beats pass when there's no fail", () => {
    expect(rollUpStatus(["pass", "warning"])).toBe("warning");
  });
  it("all pass is pass", () => {
    expect(rollUpStatus(["pass", "pass"])).toBe("pass");
  });
  it("an empty list is defined as pass", () => {
    expect(rollUpStatus([])).toBe("pass");
  });
});

describe("stdDev", () => {
  it("is null for fewer than 2 points", () => {
    expect(stdDev([])).toBeNull();
    expect(stdDev([5])).toBeNull();
  });
  it("is 0 for two identical values", () => {
    expect(stdDev([5, 5])).toBe(0);
  });
  it("matches a hand-computed sample standard deviation (n-1)", () => {
    // mean 2, variance (1+0+1)/2 = 1, stdDev = 1
    expect(stdDev([1, 2, 3])).toBeCloseTo(1);
    // classic textbook set: mean 5, variance 32/7, stdDev ≈ 2.1381
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.1381, 3);
  });
});

describe("coefficientOfVariation", () => {
  it("is null for fewer than 2 points", () => {
    expect(coefficientOfVariation([])).toBeNull();
    expect(coefficientOfVariation([5])).toBeNull();
  });
  it("is null when the mean is zero (separate divide-by-zero guard from stdDev)", () => {
    expect(stdDev([-5, 5])).not.toBeNull(); // stdDev itself is fine here
    expect(coefficientOfVariation([-5, 5])).toBeNull(); // but mean is 0, so CV is undefined
  });
  it("matches a hand-computed case", () => {
    // mean 2, stdDev 1 → CV = 1/2 * 100 = 50
    expect(coefficientOfVariation([1, 2, 3])).toBeCloseTo(50);
  });
});

describe("rate", () => {
  it("excellent: >=95% in spec and CV<5 (or no CV)", () => {
    expect(rate(95, null)).toBe("excellent");
    expect(rate(95, 4.9)).toBe("excellent");
    expect(rate(99, 0)).toBe("excellent");
  });
  it("95% in-spec with CV exactly 5 falls to good, not excellent", () => {
    expect(rate(95, 5)).toBe("good");
  });
  it("good: >=85% in spec and CV<=10 (or no CV)", () => {
    expect(rate(85, 10)).toBe("good");
    expect(rate(90, null)).toBe("good");
  });
  it("just under 85% in-spec is needs_attention regardless of CV", () => {
    expect(rate(84.99, 0)).toBe("needs_attention");
    expect(rate(84.99, null)).toBe("needs_attention");
  });
  it("high in-spec% does not save a bad variability score", () => {
    // 95% in spec would be excellent/good on its own, but CV=11 clears
    // neither the excellent (<5) nor the good (<=10) bar.
    expect(rate(95, 11)).toBe("needs_attention");
  });
});
