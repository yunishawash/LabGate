"use client";
import { useCallback, useEffect, useState } from "react";
import { BarChart3, Download, X } from "lucide-react";
import { useLang } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate, toDateInputValue } from "@/lib/utils";
import { SALES_STAGES } from "@/lib/salesWorkflow";

/**
 * Hours, told at the scale a person would use.
 *
 * The first version printed "0 h" for every row because most signatures land in
 * minutes — a table of zeros that looked broken and hid the one desk that took
 * a day and a half.
 */
function useHours() {
  const { t } = useLang();
  return (h: number | null) => {
    if (h === null) return null;
    if (h < 1) return `${Math.max(1, Math.round(h * 60))} ${t("min", "د")}`;
    if (h < 48) return `${Math.round(h * 10) / 10} ${t("h", "س")}`;
    return `${Math.round(h / 24)} ${t("d", "ي")}`;
  };
}

type ReportKey = "cycleTime" | "rejections" | "variance" | "customers" | "coverage";

const TABS: { key: ReportKey; en: string; ar: string; question: [string, string] }[] = [
  { key: "cycleTime",  en: "Cycle time",  ar: "زمن الدورة",
    question: ["Which desk holds orders the longest?", "أي مكتب يحتجز الطلبيات أطول مدّة؟"] },
  { key: "rejections", en: "Rejections",  ar: "الرفض",
    question: ["Why do orders die, and where?", "لماذا تتوقّف الطلبيات، وأين؟"] },
  { key: "variance",   en: "Weight variance", ar: "فروقات الوزن",
    question: ["Are we shipping what we sold?", "هل نشحن ما بعناه فعلاً؟"] },
  { key: "customers",  en: "Customers",   ar: "الزبائن",
    question: ["Who are our real customers?", "من هم زبائننا الحقيقيون؟"] },
  { key: "coverage",   en: "Coverage",    ar: "التغطية",
    question: ["How often is a desk signed by somebody else?", "كم مرّة يوقّع شخص غير صاحب المكتب؟"] },
];

const EXPORTS: { type: string; en: string; ar: string }[] = [
  { type: "orders",    en: "Orders",     ar: "الطلبيات" },
  { type: "pipeline",  en: "Pipeline",   ar: "خط السير" },
  { type: "cycleTime", en: "Cycle time", ar: "زمن الدورة" },
];

export default function ReportsPage() {
  const { lang, t } = useLang();
  const [tab, setTab] = useState<ReportKey>("cycleTime");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<Record<string, never> | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams({ report: tab });
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    try {
      const res = await fetch(`/api/reports?${p}`);
      setData(res.ok ? await res.json() : null);
    } catch {
      setData(null);
    }
    setLoading(false);
  }, [tab, from, to]);

  useEffect(() => { load(); }, [load]);

  const stageName = (i: number | null | undefined) => {
    const s = SALES_STAGES.find((x) => x.index === i);
    if (!s) return "—";
    return lang === "ar" ? s.groupAr ?? s.ar : s.groupEn ?? s.en;
  };

  const download = (type: string) => {
    const p = new URLSearchParams({ type, lang });
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    // `assign()` rather than assigning to `location.href`: React Compiler
    // rejects writing to a global, and the response is Content-Disposition:
    // attachment, so the browser downloads it without leaving the page.
    window.location.assign(`/api/export?${p}`);
  };

  const active = TABS.find((x) => x.key === tab)!;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight flex items-center gap-2">
            <BarChart3 size={22} className="text-slate-500" />
            {t("Reports", "التقارير")}
          </h1>
          <p className="text-sm text-slate-500 mt-1">{active.question[lang === "ar" ? 1 : 0]}</p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {EXPORTS.map((e) => (
            <Button key={e.type} variant="outline" size="sm" className="gap-1.5" onClick={() => download(e.type)}>
              <Download size={14} />
              {lang === "ar" ? e.ar : e.en}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1 border-b border-slate-200 flex-wrap">
          {TABS.map((x) => (
            <button
              key={x.key}
              onClick={() => setTab(x.key)}
              className={
                "px-3 py-2 text-sm border-b-2 -mb-px cursor-pointer transition-colors " +
                (tab === x.key
                  ? "border-sky-500 text-sky-700 font-medium"
                  : "border-transparent text-slate-500 hover:text-slate-800")
              }
            >
              {lang === "ar" ? x.ar : x.en}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 ms-auto">
          <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40" />
          <Input type="date" value={to} min={from || undefined} max={toDateInputValue(new Date())} onChange={(e) => setTo(e.target.value)} className="h-9 w-40" />
          {(from || to) && (
            <button onClick={() => { setFrom(""); setTo(""); }} className="h-9 px-2 rounded-lg text-sm text-slate-500 hover:bg-slate-100 cursor-pointer flex items-center gap-1">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 overflow-x-auto">
        {loading && <p className="text-sm text-slate-400">{t("Loading…", "جارٍ التحميل…")}</p>}
        {!loading && !data && (
          <p className="text-sm text-red-600">{t("Could not load this report.", "تعذّر تحميل التقرير.")}</p>
        )}

        {!loading && data && tab === "cycleTime" && <CycleTime data={data} stageName={stageName} />}
        {!loading && data && tab === "rejections" && <RejectionReport data={data} stageName={stageName} />}
        {!loading && data && tab === "variance" && <VarianceReport data={data} />}
        {!loading && data && tab === "customers" && <CustomerReport data={data} />}
        {!loading && data && tab === "coverage" && <CoverageReport data={data} stageName={stageName} />}
      </div>
    </div>
  );
}

// ── shared table shell ─────────────────────────────────────────────────────
function Table({ headers, children }: { headers: (string | null)[]; children: React.ReactNode }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-xs text-slate-500 border-b border-slate-200">
          {headers.map((h, i) => (
            <th key={i} className={"font-medium py-2 whitespace-nowrap " + (i === 0 ? "text-start" : "text-end px-3")}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">{children}</tbody>
    </table>
  );
}

const Num = ({ v, cls = "" }: { v: number | string | null; cls?: string }) => (
  <td className={`py-2 px-3 text-end tabular-nums whitespace-nowrap ${cls}`}>
    <bdi>{v ?? "—"}</bdi>
  </td>
);

function Bar({ value, peak, tone = "sky" }: { value: number; peak: number; tone?: "sky" | "red" | "amber" }) {
  const bg = { sky: "bg-sky-500", red: "bg-red-500", amber: "bg-amber-500" }[tone];
  return (
    <span className="inline-block w-24 h-2.5 bg-slate-100 rounded-sm overflow-hidden align-middle">
      <span className={`block h-full ${bg} rounded-sm`} style={{ width: `${Math.min(100, (value / peak) * 100)}%` }} />
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-slate-400 py-3">{children}</p>;
}

// ── cycle time ─────────────────────────────────────────────────────────────
function CycleTime({ data }: { data: Record<string, never>; stageName: (i?: number | null) => string }) {
  const { lang, t } = useLang();
  const hours = useHours();
  /**
   * Named by STEP here, not by stage: index 7 holds two signatures, and calling
   * both rows "Lab results sign-off" made a correct table look duplicated. The
   * timeline wants the group name — it shows one node — and this wants the
   * individual one, because it is measuring the two signatures separately.
   */
  const stepName = (key: string) => {
    const s = SALES_STAGES.find((x) => x.key === key);
    return s ? (lang === "ar" ? s.ar : s.en) : key;
  };
  const rows = (data.byStage ?? []) as unknown as {
    stageKey: string; stageIndex: number; n: number;
    avgHours: number | null; p90Hours: number | null; maxHours: number | null;
    people: { name: string; n: number; avgHours: number | null }[];
  }[];
  if (!rows.length) return <Empty>{t("No completed steps in this period.", "لا توجد خطوات مكتملة في هذه الفترة.")}</Empty>;
  const peak = Math.max(1, ...rows.map((r) => r.avgHours ?? 0));

  return (
    <>
      <Table headers={[t("Stage", "المرحلة"), t("Signed", "توقيعات"), t("Average", "المتوسط"), null, t("p90", "الشريحة ٩٠"), t("Longest", "الأطول")]}>
        {rows.map((r) => (
          <tr key={r.stageKey}>
            <td className="py-2 text-slate-800">
              <span className="font-mono text-xs text-slate-400 me-1.5">{r.stageIndex}</span>
              {stepName(r.stageKey)}
              {r.people.length > 1 && (
                <span className="block text-xs text-slate-400">
                  {r.people.map((p) => `${p.name} (${hours(p.avgHours)})`).join(" · ")}
                </span>
              )}
            </td>
            <Num v={r.n} />
            <Num v={hours(r.avgHours)} cls="text-slate-900 font-medium" />
            <td className="py-2 px-3 text-end"><Bar value={r.avgHours ?? 0} peak={peak} /></td>
            {/* p90 is the honest headline: an average hides the one order that
                sat for three days behind nine that moved in an hour. */}
            <Num v={hours(r.p90Hours)} />
            <Num v={hours(r.maxHours)} cls="text-slate-400" />
          </tr>
        ))}
      </Table>
      <p className="text-xs text-slate-400 mt-3">
        {t(
          "p90 = nine out of ten signatures came faster than this. Computed in the app, not the database: this MongoDB is 6.x and $percentile needs 7+.",
          "الشريحة ٩٠ تعني أنّ تسعة من كل عشرة توقيعات كانت أسرع من هذا. تُحسَب في التطبيق لا في قاعدة البيانات: هذه النسخة MongoDB 6، و$percentile يتطلّب النسخة 7 فأعلى."
        )}
      </p>
    </>
  );
}

// ── rejections ─────────────────────────────────────────────────────────────
function RejectionReport({ data, stageName }: { data: Record<string, never>; stageName: (i?: number | null) => string }) {
  const { lang, t } = useLang();
  const byStage = (data.byStage ?? []) as unknown as {
    stageIndex: number | null; count: number; kg: number; reached: number; ratePct: number | null; rejectors: string[];
  }[];
  const recent = (data.recent ?? []) as unknown as {
    _id: string; orderNumber: string; customer: string; customerAr?: string;
    totalWeightKg: number; updatedAt: string; rejection?: { reason?: string; byName?: string; stageIndex?: number | null };
  }[];
  if (!byStage.length) return <Empty>{t("No rejections in this period.", "لا توجد حالات رفض في هذه الفترة.")}</Empty>;
  const peak = Math.max(1, ...byStage.map((s) => s.count));

  return (
    <>
      <Table headers={[t("Stage", "المرحلة"), t("Rejected", "مرفوضة"), null, t("Reached it", "وصلتها"), t("Rate", "النسبة"), t("Tons lost", "أطنان مفقودة")]}>
        {byStage.map((s) => (
          <tr key={String(s.stageIndex)}>
            <td className="py-2 text-slate-800">
              {stageName(s.stageIndex)}
              {s.rejectors.length > 0 && (
                <span className="block text-xs text-slate-400">{s.rejectors.join(" · ")}</span>
              )}
            </td>
            <Num v={s.count} cls="text-slate-900 font-medium" />
            <td className="py-2 px-3 text-end"><Bar value={s.count} peak={peak} tone="red" /></td>
            <Num v={s.reached} cls="text-slate-400" />
            {/* The denominator is orders that REACHED the stage, not all orders:
                2 of 3 at finance is a different fact from 2 of 90. */}
            <Num v={s.ratePct !== null ? `${s.ratePct}%` : null} cls={((s.ratePct ?? 0) > 20 ? "text-red-700 font-medium" : "")} />
            <Num v={(s.kg / 1000).toFixed(1)} />
          </tr>
        ))}
      </Table>

      <h3 className="text-sm font-medium text-slate-900 mt-5 mb-2">{t("Most recent", "الأحدث")}</h3>
      <ul className="divide-y divide-slate-100">
        {recent.slice(0, 12).map((o) => (
          <li key={o._id} className="py-2">
            <div className="flex items-baseline gap-2 flex-wrap">
              <bdi className="font-mono text-xs text-red-700">{o.orderNumber}</bdi>
              <span className="text-sm text-slate-700">{(lang === "ar" && o.customerAr) || o.customer}</span>
              <span className="text-xs text-slate-400">{stageName(o.rejection?.stageIndex)}</span>
              <bdi className="text-xs text-slate-400 ms-auto">{formatDate(o.updatedAt)}</bdi>
            </div>
            <p className="text-xs text-slate-500">
              {o.rejection?.byName} — {o.rejection?.reason}
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}

// ── variance ───────────────────────────────────────────────────────────────
function VarianceReport({ data }: { data: Record<string, never> }) {
  const { lang, t } = useLang();
  const rows = (data.byCustomer ?? []) as unknown as {
    customerId: string; name: string; nameAr: string;
    orders: number; orderedKg: number; actualKg: number; avgPct: number | null;
  }[];
  const outliers = (data.outliers ?? []) as unknown as {
    _id: string; orderNumber: string; customer: string; customerAr?: string;
    totalWeightKg: number; actualNetWeightKg: number; variancePct: number; postedAt: string;
  }[];
  const overall = data.overall as unknown as { orders: number; orderedKg: number; actualKg: number } | null;
  if (!rows.length) return <Empty>{t("No posted orders in this period.", "لا توجد طلبيات مُرحَّلة في هذه الفترة.")}</Empty>;

  const diff = overall ? overall.actualKg - overall.orderedKg : 0;
  const diffPct = overall && overall.orderedKg ? (diff / overall.orderedKg) * 100 : 0;

  return (
    <>
      {overall && (
        <div className="flex flex-wrap gap-6 mb-4 pb-4 border-b border-slate-100">
          <div>
            <p className="text-xs text-slate-500">{t("Posted orders", "طلبيات مرحّلة")}</p>
            <bdi className="text-xl font-semibold tabular-nums">{overall.orders}</bdi>
          </div>
          <div>
            <p className="text-xs text-slate-500">{t("Ordered", "المطلوب")}</p>
            <bdi className="text-xl font-semibold tabular-nums">{(overall.orderedKg / 1000).toFixed(1)} {t("t", "طن")}</bdi>
          </div>
          <div>
            <p className="text-xs text-slate-500">{t("Actual", "الفعلي")}</p>
            <bdi className="text-xl font-semibold tabular-nums">{(overall.actualKg / 1000).toFixed(1)} {t("t", "طن")}</bdi>
          </div>
          <div>
            <p className="text-xs text-slate-500">{t("Net variance", "صافي الفرق")}</p>
            <bdi className={`text-xl font-semibold tabular-nums ${Math.abs(diffPct) > 0.5 ? "text-amber-700" : "text-slate-900"}`}>
              {diff > 0 ? "+" : ""}{(diff / 1000).toFixed(2)} {t("t", "طن")} ({diffPct > 0 ? "+" : ""}{diffPct.toFixed(2)}%)
            </bdi>
          </div>
        </div>
      )}

      <Table headers={[t("Customer", "الزبون"), t("Orders", "الطلبيات"), t("Ordered (t)", "المطلوب (طن)"), t("Actual (t)", "الفعلي (طن)"), t("Avg variance", "متوسط الفرق")]}>
        {rows.map((r) => (
          <tr key={r.customerId}>
            <td className="py-2 text-slate-800">{(lang === "ar" && r.nameAr) || r.name}</td>
            <Num v={r.orders} />
            <Num v={(r.orderedKg / 1000).toFixed(3)} />
            <Num v={(r.actualKg / 1000).toFixed(3)} />
            <Num
              v={r.avgPct !== null ? `${r.avgPct > 0 ? "+" : ""}${r.avgPct}%` : null}
              cls={Math.abs(r.avgPct ?? 0) > 0.5 ? "text-amber-700 font-medium" : ""}
            />
          </tr>
        ))}
      </Table>

      {outliers.length > 0 && (
        <>
          <h3 className="text-sm font-medium text-slate-900 mt-5 mb-2">
            {t("Beyond ±1% — look at the load, not the average", "أكبر من ±١٪ — راجع الحمولة نفسها لا المتوسّط")}
          </h3>
          <Table headers={[t("Order", "الطلبية"), t("Ordered", "المطلوب"), t("Actual", "الفعلي"), t("Variance", "الفرق"), t("Posted", "الترحيل")]}>
            {outliers.slice(0, 15).map((o) => (
              <tr key={o._id}>
                <td className="py-2">
                  <bdi className="font-mono text-xs text-sky-700">{o.orderNumber}</bdi>
                  <span className="text-slate-600 ms-2">{(lang === "ar" && o.customerAr) || o.customer}</span>
                </td>
                <Num v={(o.totalWeightKg / 1000).toFixed(3)} />
                <Num v={(o.actualNetWeightKg / 1000).toFixed(3)} />
                <Num v={`${o.variancePct > 0 ? "+" : ""}${o.variancePct}%`} cls="text-amber-700 font-medium" />
                <Num v={formatDate(o.postedAt)} cls="text-slate-400" />
              </tr>
            ))}
          </Table>
        </>
      )}
    </>
  );
}

// ── customers ──────────────────────────────────────────────────────────────
function CustomerReport({ data }: { data: Record<string, never> }) {
  const { lang, t } = useLang();
  const hours = useHours();
  const rows = (data.rows ?? []) as unknown as {
    customerId: string; name: string; nameAr: string;
    orders: number; orderedKg: number; posted: number; postedKg: number;
    rejected: number; rejectionPct: number; avgCycleHours: number | null; labFails: number;
  }[];
  if (!rows.length) return <Empty>{t("No orders in this period.", "لا توجد طلبيات في هذه الفترة.")}</Empty>;
  const peak = Math.max(1, ...rows.map((r) => r.orderedKg));

  return (
    <Table
      headers={[
        t("Customer", "الزبون"), t("Orders", "الطلبيات"), t("Ordered (t)", "المطلوب (طن)"), null,
        t("Posted", "مرحّلة"), t("Rejected", "مرفوضة"), t("Rejection rate", "نسبة الرفض"),
        t("Avg cycle", "متوسط الدورة"), t("Lab fails", "رسوب مخبري"),
      ]}
    >
      {rows.map((r) => (
        <tr key={r.customerId}>
          <td className="py-2 text-slate-800">{(lang === "ar" && r.nameAr) || r.name}</td>
          <Num v={r.orders} />
          <Num v={(r.orderedKg / 1000).toFixed(1)} cls="text-slate-900 font-medium" />
          <td className="py-2 px-3 text-end"><Bar value={r.orderedKg} peak={peak} /></td>
          <Num v={r.posted} />
          <Num v={r.rejected} />
          <Num v={`${r.rejectionPct}%`} cls={r.rejectionPct > 20 ? "text-red-700 font-medium" : "text-slate-500"} />
          <Num v={hours(r.avgCycleHours)} />
          <Num v={r.labFails || "—"} cls={r.labFails ? "text-red-700" : "text-slate-300"} />
        </tr>
      ))}
    </Table>
  );
}

// ── coverage ───────────────────────────────────────────────────────────────
function CoverageReport({ data, stageName }: { data: Record<string, never>; stageName: (i?: number | null) => string }) {
  const { t } = useLang();
  const rows = (data.byStage ?? []) as unknown as {
    stageIndex: number; total: number; kinds: Record<string, number>; people: string[]; coveredPct: number;
  }[];
  if (!rows.length) return <Empty>{t("No signatures in this period.", "لا توجد توقيعات في هذه الفترة.")}</Empty>;

  return (
    <>
      <Table headers={[t("Stage", "المرحلة"), t("Signatures", "توقيعات"), t("By the owner", "من صاحب المكتب"), t("Deputy", "نائب"), t("Delegate", "مفوّض"), t("Covered", "مغطّاة")]}>
        {rows.map((r) => (
          <tr key={r.stageIndex}>
            <td className="py-2 text-slate-800">
              <span className="font-mono text-xs text-slate-400 me-1.5">{r.stageIndex}</span>
              {stageName(r.stageIndex)}
              {r.people.length > 0 && (
                <span className="block text-xs text-slate-400">{r.people.join(" · ")}</span>
              )}
            </td>
            <Num v={r.total} />
            <Num v={r.kinds.primary ?? 0} />
            <Num v={r.kinds.deputy ?? 0} cls={r.kinds.deputy ? "text-amber-700" : "text-slate-300"} />
            <Num v={r.kinds.delegate ?? 0} cls={r.kinds.delegate ? "text-amber-700" : "text-slate-300"} />
            <Num v={`${r.coveredPct}%`} cls={r.coveredPct > 30 ? "text-amber-700 font-medium" : "text-slate-500"} />
          </tr>
        ))}
      </Table>
      <p className="text-xs text-slate-400 mt-3">
        {t(
          "A desk covered much of the time is a staffing fact, not a fault. It is visible only because every signature records who it was made on behalf of.",
          "المكتب الذي يُغطَّى كثيراً واقع توظيفي لا خطأ. ولا يظهر إلّا لأنّ كل توقيع يسجّل الشخص الذي وُقِّع نيابةً عنه."
        )}
      </p>
    </>
  );
}
