"use client";
import { useMemo } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ReferenceArea,
} from "recharts";
import { useLang } from "@/components/layout/AppShell";
import { CHART } from "@/components/ui/lab-charts";
import { warningBand } from "@/lib/labQc";
import type { LabStatus } from "@/types";

export interface LabTrendPoint {
  sampleNumber: string;
  date: string;
  value: number;
  status: LabStatus;
  batchId?: string;
  /** Shown in the tooltip only when set — the Lab page's own Results-tab
   *  chart spans every customer at once, so knowing which one each point
   *  belongs to matters there; a customer's own quality profile is already
   *  scoped to one customer, so it's omitted there. */
  customer?: string;
}

const AXIS_TICK = { fontSize: 11, fill: "#64748b" };
const GRID = "#f1f5f9";

/**
 * Value-over-time control chart for one QC parameter — one series, with
 * min/max/target reference lines and a shaded warning band, the way the QA
 * department reads a control chart. Moved from the GWMC lab module per SPEC
 * §11.1's chart catalog ("the control chart, one series over time with the
 * amber warning band").
 *
 * Colors come from this app's one validated palette (`CHART` in
 * lab-charts.tsx), not a second hardcoded copy of the same three colors.
 *
 * RTL: follows this app's own already-shipped pattern for trend-over-time
 * charts (`dashboard/charts.tsx`'s `VolumeTrend`/`QualityTrend` —
 * `dir="ltr"` + reverse the data array) rather than SPEC §11.1's literal
 * `reversed` axis prop. That prop caused a real rendering bug the one time
 * it was tried in this app (a `YAxis orientation="right"` not reserving its
 * gutter — BUILD_CHECKLIST.md, 2026-09-06); that was a horizontal bar chart,
 * not this chart shape, but the array-reversal approach already covers
 * exactly this shape correctly, so there's no reason to risk the untested one
 * for a chart it was never proven against.
 */
export function LabTrendChart({
  data, min, max, target, unit, height = 280,
}: {
  data: LabTrendPoint[];
  min?: number | null;
  max?: number | null;
  target?: number | null;
  unit?: string;
  height?: number;
}) {
  const { lang, t, isRtl } = useLang();

  const chartData = useMemo(() => (isRtl ? [...data].reverse() : data), [data, isRtl]);
  const band = warningBand(min ?? null, max ?? null, target ?? null);

  if (!data.length) {
    return (
      <div className="h-40 grid place-items-center text-sm text-slate-400">
        {t("No readings for this parameter yet.", "لا توجد قراءات لهذا البارامتر بعد.")}
      </div>
    );
  }

  const dateLabel = (v: string) =>
    new Date(v).toLocaleDateString(lang === "ar" ? "ar" : "en", {
      month: "short", day: "numeric", numberingSystem: "latn",
    });

  return (
    <div style={{ height }} dir="ltr">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="date" tick={AXIS_TICK} axisLine={{ stroke: "#e2e8f0" }} tickLine={false}
            tickFormatter={dateLabel} />
          <YAxis
            tick={AXIS_TICK} axisLine={false} tickLine={false} width={44} domain={["auto", "auto"]}
            label={unit ? { value: unit, position: "insideTopLeft", fontSize: 11, fill: "#94a3b8" } : undefined}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as LabTrendPoint;
              return (
                <div
                  dir={isRtl ? "rtl" : "ltr"}
                  className="bg-white border border-slate-200 rounded-lg shadow-sm px-3 py-2 text-xs"
                >
                  <div className="text-slate-500">{dateLabel(p.date)}</div>
                  <div className="font-medium text-slate-900 mt-0.5">
                    {p.value}{unit ? ` ${unit}` : ""}
                  </div>
                  <div className="text-slate-400 mt-0.5">
                    {p.sampleNumber}{p.customer ? ` · ${p.customer}` : ""}
                  </div>
                </div>
              );
            }}
          />
          {/* Warning band: shaded independently per side, since a one-sided
              spec (n_m_t/n_l_t) only has one edge to be "close to". */}
          {max != null && band != null && band > 0 && (
            <ReferenceArea y1={max - band} y2={max} fill={CHART.warning} fillOpacity={0.08} strokeWidth={0} />
          )}
          {min != null && band != null && band > 0 && (
            <ReferenceArea y1={min} y2={min + band} fill={CHART.warning} fillOpacity={0.08} strokeWidth={0} />
          )}
          {min != null && (
            <ReferenceLine y={min} stroke={CHART.fail} strokeDasharray="4 4"
              label={{ value: t("Min", "الحد الأدنى"), position: "insideBottomLeft", fontSize: 10, fill: CHART.fail }} />
          )}
          {max != null && (
            <ReferenceLine y={max} stroke={CHART.fail} strokeDasharray="4 4"
              label={{ value: t("Max", "الحد الأقصى"), position: "insideTopLeft", fontSize: 10, fill: CHART.fail }} />
          )}
          {target != null && (
            <ReferenceLine y={target} stroke="#94a3b8" strokeDasharray="2 3"
              label={{ value: t("Target", "الهدف"), position: "insideTopRight", fontSize: 10, fill: "#94a3b8" }} />
          )}
          <Line
            dataKey="value" type="monotone" stroke={CHART.pass} strokeWidth={2} connectNulls
            dot={(props: { cx?: number; cy?: number; payload?: LabTrendPoint }) => {
              const st = props.payload?.status;
              const color = st === "fail" ? CHART.fail : st === "warning" ? CHART.warning : CHART.pass;
              return (
                <circle
                  key={`${props.cx}-${props.cy}`}
                  cx={props.cx} cy={props.cy} r={3} fill={color} stroke="white" strokeWidth={1}
                />
              );
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
