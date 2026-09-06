import LabParameterThreshold from "@/models/LabParameterThreshold";
import type { LabOperator } from "@/lib/labQc";

// Re-export the pure scoring rules so server code can import limits +
// scoring from one place. Client components must import from "@/lib/labQc"
// directly — this file pulls in a Mongoose model and can't run in the browser.
export { evaluate, deviationFromTarget, rollUpStatus, warningBand } from "@/lib/labQc";
export type { LabOperator, LabStatus } from "@/lib/labQc";

export interface ResolvedThreshold {
  min: number | null;
  max: number | null;
  target: number | null;
  operator: LabOperator;
}

/**
 * Resolve the limits that actually apply for one parameter+product pair:
 * a per-product LabParameterThreshold override if one exists, else the
 * parameter's own defaults.
 */
export async function resolveThreshold(
  parameterId: string,
  productId: string,
  parameterDefault: {
    defaultMin: number | null;
    defaultMax: number | null;
    defaultTarget?: number | null;
    operator: LabOperator;
  }
): Promise<ResolvedThreshold> {
  const override = await LabParameterThreshold.findOne({
    parameterId,
    productId,
    isActive: true,
  }).lean() as {
    min?: number | null; max?: number | null; target?: number | null;
    operator?: LabOperator | null;
  } | null;

  if (override) {
    return {
      min: override.min ?? null,
      max: override.max ?? null,
      target: override.target ?? null,
      operator: override.operator ?? parameterDefault.operator,
    };
  }

  return {
    min: parameterDefault.defaultMin,
    max: parameterDefault.defaultMax,
    target: parameterDefault.defaultTarget ?? null,
    operator: parameterDefault.operator,
  };
}
