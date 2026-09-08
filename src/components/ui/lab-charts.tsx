"use client";
import { useLang } from "@/components/layout/AppShell";

/**
 * Chart colours — validated with the dataviz skill's palette checker against a
 * light surface. Do NOT substitute these by eye: the obvious Tailwind choices
 * (#16a34a / #d97706 / #dc2626) FAIL, at ΔE 14.4 between red and amber in
 * normal vision (floor is 15) and ΔE 6.2 between green and amber under
 * protanopia.
 *
 * Amber measures 2.09:1 against the surface, below the 3:1 bar — so every amber
 * mark carries a visible value label. That relief is required, not optional.
 */
export const CHART = {
  pass: "#047857",
  warning: "#f59e0b",
  fail: "#b91c1c",
  seq: ["#b7d3f6", "#6da7ec", "#2a78d6"],
  grid: "#e2e8f0",
  axis: "#94a3b8",
  surface: "#ffffff",
} as const;

/**
 * NOTE: no Recharts import here on purpose. The one chart on this screen is an
 * HTML bar list (see below), which mirrors natively. When a genuinely
 * chart-shaped view arrives — a trend over time — bring Recharts back and apply
 * the mirroring recipe in SPEC §11.1: `reversed` on the value axis,
 * `orientation` on the category axis, flipped `textAnchor`, and a `dir`-aware
 * tooltip. Do not re-add the helper until something uses it.
 */

export interface InSpecRow {
  label: string;
  value: number;      // percentage 0..100
  count: number;
}

/**
 * In-spec percentage per parameter.
 *
 * Deliberately NOT a charting library. Twelve labelled rows with a proportional
 * bar is a layout problem, not a plotting one — and building it in HTML fixes
 * three things Recharts made hard here:
 *   · it mirrors for free under dir="rtl" (a Recharts YAxis with
 *     orientation="right" does not reserve its gutter, so the category labels
 *     were drawn on top of the bars);
 *   · Arabic labels render with the page's own font and shaping, not SVG text;
 *   · a 0% row still shows its label, without a minPointSize fudge.
 * Recharts stays for genuinely chart-shaped things — trends over time.
 *
 * One series, so no legend box: the heading says what is plotted. Colour is a
 * STATUS band (see CHART), never a categorical palette, and every row carries
 * its value as text — which is also the relief the amber contrast warning
 * requires.
 */
export function InSpecChart({ rows }: { rows: InSpecRow[]; height?: number }) {
  const { t } = useLang();

  if (!rows.length) {
    return (
      <div className="h-40 grid place-items-center text-sm text-slate-400">
        {t("Not enough readings yet.", "لا توجد قراءات كافية بعد.")}
      </div>
    );
  }

  const bandColor = (v: number) => (v >= 95 ? CHART.pass : v >= 85 ? CHART.warning : CHART.fail);

  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-3 group">
          <div className="w-48 shrink-0 text-xs text-slate-600 text-end truncate" title={r.label}>
            {r.label}
          </div>
          <div className="flex-1 h-5 relative">
            {/* Hairline gridlines at 25 / 50 / 75 / 100 — recessive, one step off
                the surface, and they mirror with the container. */}
            <div className="absolute inset-0 flex justify-between pointer-events-none">
              {[0, 1, 2, 3, 4].map((n) => (
                <span key={n} className="w-px h-full bg-slate-100" />
              ))}
            </div>
            <div
              className="h-full rounded-e-[4px] transition-[width] duration-300"
              style={{
                width: `${Math.max(r.value, 0.6)}%`,
                backgroundColor: bandColor(r.value),
              }}
              title={`${r.label} — ${r.value}% (${r.count})`}
            />
          </div>
          <bdi className="w-12 shrink-0 text-xs tabular-nums text-slate-600 text-end">
            {r.value.toFixed(0)}%
          </bdi>
        </div>
      ))}
      <div className="flex items-center gap-3 pt-1">
        <div className="w-48 shrink-0" />
        <div className="flex-1 flex justify-between text-[10px] text-slate-400 tabular-nums">
          {[0, 25, 50, 75, 100].map((n) => <bdi key={n}>{n}%</bdi>)}
        </div>
        <div className="w-12 shrink-0" />
      </div>
    </div>
  );
}

export interface StatusSplit { pass: number; warning: number; fail: number }

/**
 * The pass / warning / fail split as one 100% stacked bar. A 2px surface-coloured
 * gap separates the segments — white doing the separating, never a stroke.
 */
export function StatusSplitBar({ split }: { split: StatusSplit }) {
  const { t, lang } = useLang();
  const total = split.pass + split.warning + split.fail;
  if (!total) {
    return <div className="text-sm text-slate-400">{t("No samples in range.", "لا توجد عيّنات ضمن هذا المدى.")}</div>;
  }

  const parts = [
    { key: "pass", value: split.pass, color: CHART.pass, en: "In spec", ar: "مطابق" },
    { key: "warning", value: split.warning, color: CHART.warning, en: "Warning", ar: "تحذير" },
    { key: "fail", value: split.fail, color: CHART.fail, en: "Out of range", ar: "خارج النطاق" },
  ].filter((p) => p.value > 0);

  return (
    <div className="space-y-2">
      <div className="flex h-3 w-full rounded-full overflow-hidden gap-[2px] bg-white">
        {parts.map((p) => (
          <div
            key={p.key}
            style={{ width: `${(p.value / total) * 100}%`, backgroundColor: p.color }}
            title={`${lang === "ar" ? p.ar : p.en}: ${p.value}`}
          />
        ))}
      </div>
      {/* Legend is always present for two or more series, and never colour-alone:
          each swatch is paired with its label and its count. */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {parts.map((p) => (
          <span key={p.key} className="inline-flex items-center gap-1.5 text-slate-600">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: p.color }} />
            {lang === "ar" ? p.ar : p.en}
            <bdi className="tabular-nums text-slate-900 font-medium">{p.value}</bdi>
            <span className="text-slate-400 tabular-nums">
              ({Math.round((p.value / total) * 100)}%)
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
