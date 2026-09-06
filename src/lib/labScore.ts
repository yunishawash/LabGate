import mongoose from "mongoose";
import LabParameter from "@/models/LabParameter";
import { resolveThreshold } from "@/lib/labThreshold";
import { evaluate, deviationFromTarget, rollUpStatus, type LabOperator, type LabStatus } from "@/lib/labQc";

export interface ScoredResult {
  parameterId: string;
  parameterName: string;
  unit: string;
  value: number;
  operator: LabOperator;
  min: number | null;
  max: number | null;
  target: number | null;
  deviation: number | null;
  status: LabStatus;
}

/**
 * Score raw {parameterId, value} inputs against the limits that apply for a
 * product, producing the frozen result lines stored on a LabSample.
 *
 * Shared by sample create AND sample edit so both paths score identically —
 * a client-supplied status is never trusted on either.
 */
export async function scoreResults(
  productId: string,
  inputResults: { parameterId: string; value: number }[]
): Promise<{ results: ScoredResult[]; overallStatus: LabStatus }> {
  const parameterIds = inputResults.map((r) => r.parameterId);
  const parameters = await LabParameter.find({ _id: { $in: parameterIds } }).lean() as {
    _id: mongoose.Types.ObjectId;
    name: string; unit: string; operator: LabOperator;
    defaultMin: number | null; defaultMax: number | null; defaultTarget: number | null;
  }[];
  const parameterMap = new Map(parameters.map((p) => [p._id.toString(), p]));

  const results = await Promise.all(inputResults.map(async (r) => {
    const param = parameterMap.get(r.parameterId);
    if (!param) throw new Error(`Unknown parameter ${r.parameterId}`);

    const { min, max, target, operator } = await resolveThreshold(r.parameterId, productId, {
      defaultMin: param.defaultMin,
      defaultMax: param.defaultMax,
      defaultTarget: param.defaultTarget,
      operator: param.operator,
    });

    return {
      parameterId: r.parameterId,
      parameterName: param.name,
      unit: param.unit,
      value: r.value,
      operator,
      min,
      max,
      target,
      deviation: deviationFromTarget(r.value, target),
      status: evaluate(r.value, min, max, operator, target),
    };
  }));

  return { results, overallStatus: rollUpStatus(results.map((r) => r.status)) };
}
