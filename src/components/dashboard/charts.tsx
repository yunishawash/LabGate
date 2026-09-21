"use client";
import {
  ResponsiveContainer, ComposedChart, LineChart, PieChart, Pie, Cell,
  Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from "recharts";
import { useLang } from "@/components/layout/AppShell";
import { Card } from "@/components/dashboard/blocks";
import { TrendingUp, LineChart as LineChartIcon, PieChart as PieChartIcon } from "lucide-react";

/**
 * Colours for these three charts, copied from `globals.css` rather than read
 * through a CSS variable.
 *
 * `chart-pass/warning/fail` and `chart-seq-1/2/3` are reused verbatim — same
 * hex, same meaning (red is still rejection, the same blue ramp is still
 * "posted"). The one new set is `CATEGORICAL`, for the product donut, where
 * eight ADJACENT slices need to stay distinguishable from each other with no
 * inherent order between them — a job the sequential ramp isn't built for.
 * It's the Okabe–Ito palette (Okabe & Ito, 2008), the standard colour-blind–
 * safe categorical set, chosen over inventing one because eight
 * simultaneously-adjacent categories is exactly the case that palette was
 * built and peer-reviewed for. Grey is reserved for "Others" specifically —
 * grey reading as "the miscellaneous bucket" is closer to universal than any
 * hue would be.
 */
const PASS = "#047857", WARNING = "#f59e0b", FAIL = "#b91c1c";
const SEQ_3 = "#2a78d6";
const CATEGORICAL = ["#E69F00", "#56B4E9", "#009E73", "#F0E442", "#0072B2", "#D55E00", "#CC79A7"];
const OTHERS_GREY = "#999999";

const AXIS_TICK = { fontSize: 11, fill: "#64748b" };
const GRID = "#f1f5f9";

/** `{year, month(0-11)}` → a short month name in the viewer's language.
 *  `numberingSystem: "latn"` is deliberate — the house rule is Latin digits
 *  everywhere, Arabic only for words; this call has no digits in its output,
 *  but pinning it stops a future locale change from quietly picking one up. */
function monthLabel(year: number, month: number, lang: "en" | "ar"): string {
  return new Date(year, month, 1).toLocaleDateString(lang === "ar" ? "ar" : "en", {
    month: "short",
    numberingSystem: "latn",
  });
}

/**
 * Recharts lays out its SVG left-to-right regardless of the page's `dir` —
 * unlike a flex row, an `<svg>` doesn't read `direction` for element order.
 * So for a time-series chart to read right-to-left in Arabic (most recent
 * month nearest the reading start, same as the stage flow bar), the DATA
 * array itself is reversed. Nothing else about the chart changes.
 */
function orient<T>(data: T[], lang: "en" | "ar"): T[] {
  return lang === "ar" ? [...data].reverse() : data;
}

const tons = (kg: number) => Math.round((kg / 1000) * 10) / 10;

// ── K · Volume trend — tonnage bars + rejection-rate line ──────────────────
export function VolumeTrend({
  data,
}: { data: { year: number; month: number; kg: number; orders: number; rejectionRatePct: number | null }[] }) {
  const { lang, t } = useLang();
  const chartData = orient(
    data.map((d) => ({ ...d, label: monthLabel(d.year, d.month, lang), tons: tons(d.kg) })),
    lang
  );
  const hasAny = data.some((d) => d.orders > 0);

  return (
    <Card
      title={t("Volume & rejection rate", "الحجم ونسبة الرفض")}
      icon={<TrendingUp size={16} className="text-slate-500" />}
    >
      {!hasAny ? (
        <p className="text-sm text-slate-500">{t("No posted orders in the last 12 months.", "لا توجد طلبيات مرحّلة خلال آخر 12 شهراً.")}</p>
      ) : (
        <>
          <div className="h-64" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="label" tick={AXIS_TICK} axisLine={{ stroke: "#e2e8f0" }} tickLine={false} />
                <YAxis
                  yAxisId="tons" tick={AXIS_TICK} axisLine={false} tickLine={false} width={38}
                  label={{ value: t("t", "طن"), position: "insideTopLeft", fontSize: 11, fill: "#94a3b8" }}
                />
                <YAxis
                  yAxisId="rate" orientation="right" tick={AXIS_TICK} axisLine={false} tickLine={false} width={34}
                  domain={[0, (max: number) => Math.max(20, Math.ceil(max / 10) * 10)]}
                  label={{ value: "%", position: "insideTopRight", fontSize: 11, fill: "#94a3b8" }}
                />
                <Tooltip
                  formatter={(value, name) =>
                    name === "tons"
                      ? [`${value} ${t("t", "طن")}`, t("Posted", "مرحّلة")]
                      : [`${value}%`, t("Rejection rate", "نسبة الرفض")]
                  }
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                />
                <Bar yAxisId="tons" dataKey="tons" name="tons" fill={SEQ_3} radius={[3, 3, 0, 0]} maxBarSize={28} />
                <Line
                  yAxisId="rate" dataKey="rejectionRatePct" name="rate" type="monotone"
                  stroke={FAIL} strokeWidth={2} dot={{ r: 3, fill: FAIL }} connectNulls
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            {t(
              "Bars = tons posted per month. Line = share of that month's orders that were ultimately rejected.",
              "الأعمدة = الأطنان المرحّلة كل شهر. الخط = نسبة طلبيات ذلك الشهر التي رُفضت في النهاية."
            )}
          </p>
        </>
      )}
    </Card>
  );
}

// ── L · Quality trend — in-spec % by month, against a target line ──────────
export function QualityTrend({
  data,
}: { data: { year: number; month: number; samples: number; inSpecPct: number | null }[] }) {
  const { lang, t } = useLang();
  const TARGET = 85;
  const chartData = orient(
    data.map((d) => ({ ...d, label: monthLabel(d.year, d.month, lang) })),
    lang
  );
  const hasAny = data.some((d) => d.samples > 0);

  return (
    <Card
      title={t("Quality over time", "الجودة عبر الوقت")}
      icon={<LineChartIcon size={16} className="text-slate-500" />}
    >
      {!hasAny ? (
        <p className="text-sm text-slate-500">{t("No lab samples in the last 12 months.", "لا توجد عيّنات مختبر خلال آخر 12 شهراً.")}</p>
      ) : (
        <>
          <div className="h-56" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="label" tick={AXIS_TICK} axisLine={{ stroke: "#e2e8f0" }} tickLine={false} />
                <YAxis domain={[0, 100]} tick={AXIS_TICK} axisLine={false} tickLine={false} width={34}
                  tickFormatter={(v: number) => `${v}%`} />
                <Tooltip
                  formatter={(value, _name, item) => {
                    const samples = (item?.payload as { samples?: number } | undefined)?.samples ?? 0;
                    return [
                      value == null ? t("No samples", "لا عيّنات") : `${value}% (${samples} ${t("samples", "عيّنة")})`,
                      t("In spec", "مطابق"),
                    ];
                  }}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                />
                {/* The target line is what turns a number into a verdict — a dip
                    reads as "bad" only because there is a line to fall below. */}
                <ReferenceLine
                  y={TARGET} stroke="#cbd5e1" strokeDasharray="4 4"
                  label={{ value: t("Target", "الهدف"), position: "insideTopRight", fontSize: 10, fill: "#94a3b8" }}
                />
                <Line
                  dataKey="inSpecPct" type="monotone" stroke={PASS} strokeWidth={2}
                  connectNulls
                  dot={(props: { cx?: number; cy?: number; payload?: { inSpecPct?: number | null } }) => {
                    const v = props.payload?.inSpecPct;
                    const below = v != null && v < TARGET;
                    return (
                      <circle
                        key={`${props.cx}-${props.cy}`}
                        cx={props.cx} cy={props.cy} r={below ? 4 : 3}
                        fill={below ? FAIL : PASS} stroke="white" strokeWidth={1}
                      />
                    );
                  }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            {t(
              "Warnings count as in spec. A red point is a month that fell below target.",
              "التحذيرات محسوبة ضمن المطابق. النقطة الحمراء شهر انخفض عن الهدف."
            )}
          </p>
        </>
      )}
    </Card>
  );
}

// ── M · Product mix — tonnage share, last 12 months ─────────────────────────
export function ProductMix({
  data,
}: { data: { totalKg: number; slices: { productId: string; product: string; productAr: string; kg: number }[] } }) {
  const { lang, t } = useLang();
  if (!data.slices.length) {
    return (
      <Card title={t("Product mix", "توزيع الأصناف")} icon={<PieChartIcon size={16} className="text-slate-500" />}>
        <p className="text-sm text-slate-500">{t("No posted orders in the last 12 months.", "لا توجد طلبيات مرحّلة خلال آخر 12 شهراً.")}</p>
      </Card>
    );
  }

  const slices = data.slices.map((s, i) => ({
    ...s,
    name: (lang === "ar" && s.productAr) || s.product,
    pct: data.totalKg ? Math.round((s.kg / data.totalKg) * 1000) / 10 : 0,
    color: s.product === "Others" ? OTHERS_GREY : CATEGORICAL[i % CATEGORICAL.length],
  }));

  return (
    <Card title={t("Product mix", "توزيع الأصناف")} icon={<PieChartIcon size={16} className="text-slate-500" />}>
      <div className="flex flex-col sm:flex-row items-center gap-4">
        {/* Matches Quality trend's h-56 chart area, so the two cards read at
            the same height when they sit side by side in the dashboard row. */}
        <div className="relative h-56 w-56 flex-shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={slices} dataKey="kg" nameKey="name"
                innerRadius={52} outerRadius={80} paddingAngle={1.5} strokeWidth={1} stroke="#fff"
              >
                {slices.map((s) => <Cell key={s.productId || "others"} fill={s.color} />)}
              </Pie>
              <Tooltip
                formatter={(value, name, item) => {
                  const pct = (item?.payload as { pct?: number } | undefined)?.pct ?? 0;
                  return [`${tons(Number(value))} ${t("t", "طن")} (${pct}%)`, name];
                }}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
              />
            </PieChart>
          </ResponsiveContainer>
          {/* The centre of a donut is otherwise dead space — the total is the
              one number worth putting there. */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <bdi className="text-lg font-semibold text-slate-900 tabular-nums">{tons(data.totalKg)}</bdi>
            <span className="text-[11px] text-slate-400">{t("tons", "طن")}</span>
          </div>
        </div>
        <ul className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
          {slices.map((s) => (
            <li key={s.productId || "others"} className="flex items-center gap-2 text-xs min-w-0">
              <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: s.color }} />
              <span className="text-slate-600 truncate flex-1">{s.name}</span>
              <bdi className="tabular-nums text-slate-900 font-medium whitespace-nowrap">{s.pct}%</bdi>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-xs text-slate-400 mt-3">
        {t("By tonnage shipped, posted orders only, last 12 months.", "بحسب الأطنان المشحونة، الطلبيات المرحّلة فقط، آخر 12 شهراً.")}
      </p>
    </Card>
  );
}
