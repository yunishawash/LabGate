"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Phone, User, MapPin } from "lucide-react";
import { useLang } from "@/components/layout/AppShell";
import { StatCard } from "@/components/ui/stat-card";
import { QcStatusBadge } from "@/components/ui/qc-status-badge";
import { StatusSplitBar } from "@/components/ui/lab-charts";
import { formatDate } from "@/lib/utils";
import { ORDER_STATUS_LABELS, ORDER_STATUS_BADGE, type SalesOrderStatus } from "@/types";
import { SALES_STAGES } from "@/lib/salesWorkflow";

interface Profile {
  customer: { _id: string; name: string; nameAr?: string; code?: string; phone?: string; contactName?: string; address?: string };
  commercial: null | {
    orders: number; posted: number; rejected: number; pending: number;
    orderedKg: number; postedKg: number; actualKg: number; lostToRejectionKg: number;
  };
  quality: { samples: number; pass: number; warning: number; fail: number; inSpecPct: number | null; lastSampleDate: string | null };
  recentOrders: { _id: string; orderNumber: string; referenceNo?: string; orderDate: string; status: SalesOrderStatus; currentStageIndex: number; totalWeightKg: number; actualNetWeightKg?: number | null; varianceKg?: number | null }[];
  recentSamples: { _id: string; sampleNumber: string; sampleDate: string; product: string; overallStatus: string; orderNumber?: string }[];
}

const tons = (kg: number) => (kg / 1000).toFixed(3);

export default function CustomerProfilePage() {
  const { lang, t } = useLang();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();

  const [data, setData] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/customers/${id}`);
      if (!res.ok) {
        setError(t("This customer could not be found.", "لم نعثر على هذا الزبون."));
        setLoading(false);
        return;
      }
      setData(await res.json());
    } catch {
      setError(t("Network error — please try again.", "خطأ في الشبكة — يُرجى المحاولة مرة أخرى."));
    }
    setLoading(false);
  }, [id, t]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <p className="text-sm text-slate-400">{t("Loading…", "جارٍ التحميل…")}</p>;
  if (error || !data) {
    return <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>;
  }

  const { customer, commercial, quality, recentOrders, recentSamples } = data;
  const stageLabel = (i: number) => {
    const s = SALES_STAGES.find((x) => x.index === i);
    return s ? `${i}/8 · ${lang === "ar" ? s.ar : s.en}` : `${i}/8`;
  };

  return (
    <div className="space-y-5">
      <button
        onClick={() => router.push("/customers")}
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 cursor-pointer"
      >
        <ArrowLeft size={14} className="rtl:rotate-180" />
        {t("All customers", "كل الزبائن")}
      </button>

      <div>
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
          {(lang === "ar" && customer.nameAr) || customer.name}
        </h1>
        <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-sm text-slate-500">
          {customer.code && <span className="font-mono">{customer.code}</span>}
          {customer.contactName && (
            <span className="inline-flex items-center gap-1.5"><User size={13} />{customer.contactName}</span>
          )}
          {customer.phone && (
            <span className="inline-flex items-center gap-1.5"><Phone size={13} /><bdi>{customer.phone}</bdi></span>
          )}
          {customer.address && (
            <span className="inline-flex items-center gap-1.5"><MapPin size={13} />{customer.address}</span>
          )}
        </div>
      </div>

      {/* Commercial and quality on ONE screen — the whole reason both halves key
          on the same customer row. */}
      {commercial && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-slate-700">{t("Commercial", "تجارياً")}</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard title={t("Orders", "الطلبيات")} value={commercial.orders} color="blue" />
            <StatCard title={t("Tons posted", "أطنان مرحّلة")} value={tons(commercial.postedKg)} color="green" />
            <StatCard title={t("In progress", "قيد الإجراء")} value={commercial.pending} color="yellow" />
            <StatCard
              title={t("Tons lost to rejection", "أطنان مفقودة بسبب الرفض")}
              value={tons(commercial.lostToRejectionKg)}
              color={commercial.lostToRejectionKg > 0 ? "red" : "default"}
            />
          </div>
          {commercial.posted > 0 && commercial.actualKg > 0 && (
            <p className="text-xs text-slate-500">
              {t("Shipped against ordered:", "المشحون مقابل المطلوب:")}{" "}
              <bdi className="tabular-nums">{tons(commercial.actualKg)}</bdi> /{" "}
              <bdi className="tabular-nums">{tons(commercial.postedKg)}</bdi> t
              {" · "}
              <bdi className={"tabular-nums font-medium " + (Math.abs(commercial.actualKg - commercial.postedKg) / (commercial.postedKg || 1) <= 0.01 ? "text-emerald-700" : "text-amber-700")}>
                {commercial.actualKg >= commercial.postedKg ? "+" : ""}
                {(((commercial.actualKg - commercial.postedKg) / (commercial.postedKg || 1)) * 100).toFixed(2)}%
              </bdi>
            </p>
          )}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-slate-700">{t("Quality", "الجودة")}</h2>
        {quality.samples === 0 ? (
          <p className="text-sm text-slate-400">{t("No samples recorded for this customer.", "لا توجد عيّنات مسجّلة لهذا الزبون.")}</p>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
              <span className="text-sm text-slate-600">
                {t("Samples", "العيّنات")}{" "}
                <bdi className="font-medium text-slate-900 tabular-nums">{quality.samples}</bdi>
              </span>
              <span className="text-sm text-slate-600">
                {t("In spec", "نسبة المطابقة")}{" "}
                <bdi className="font-medium text-slate-900 tabular-nums">{quality.inSpecPct}%</bdi>
              </span>
              {quality.lastSampleDate && (
                <span className="text-sm text-slate-500">
                  {t("Last tested", "آخر فحص")} <bdi>{formatDate(quality.lastSampleDate)}</bdi>
                </span>
              )}
            </div>
            <StatusSplitBar split={{ pass: quality.pass, warning: quality.warning, fail: quality.fail }} />
          </div>
        )}
      </section>

      <div className="grid lg:grid-cols-2 gap-4">
        {commercial && (
          <section className="space-y-2">
            <h2 className="text-sm font-medium text-slate-700">{t("Recent orders", "آخر الطلبيات")}</h2>
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100">
              {recentOrders.length === 0 ? (
                <p className="p-6 text-center text-sm text-slate-400">{t("None yet.", "ولا واحدة بعد.")}</p>
              ) : recentOrders.map((o) => (
                <Link key={o._id} href={`/orders/${o._id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50/60">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-slate-900 font-medium">{o.orderNumber}</div>
                    <bdi className="text-xs text-slate-400 block">{formatDate(o.orderDate)}</bdi>
                  </div>
                  <bdi className="text-sm tabular-nums text-slate-600">{tons(o.totalWeightKg)} t</bdi>
                  <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${ORDER_STATUS_BADGE[o.status]}`}>
                    {o.status === "Pending" ? stageLabel(o.currentStageIndex) : ORDER_STATUS_LABELS[o.status][lang]}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className="space-y-2">
          <h2 className="text-sm font-medium text-slate-700">{t("Recent samples", "آخر العيّنات")}</h2>
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100">
            {recentSamples.length === 0 ? (
              <p className="p-6 text-center text-sm text-slate-400">{t("None yet.", "ولا واحدة بعد.")}</p>
            ) : recentSamples.map((s) => (
              <div key={s._id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-slate-900 font-medium">{s.sampleNumber}</div>
                  <bdi className="text-xs text-slate-400 block">{formatDate(s.sampleDate)}</bdi>
                </div>
                <span className="text-sm text-slate-600 truncate max-w-24">{s.product}</span>
                <QcStatusBadge status={s.overallStatus} size="xs" />
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
