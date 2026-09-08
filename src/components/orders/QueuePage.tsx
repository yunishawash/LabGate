"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Clock, Inbox } from "lucide-react";
import { useLang } from "@/components/layout/AppShell";
import { formatDate, formatDuration } from "@/lib/utils";
import { useNow } from "@/lib/useNow";
import { agingTone, type OrderRow } from "@/components/orders/cells";
import { QcStatusBadge } from "@/components/ui/qc-status-badge";
import { SALES_STAGES } from "@/lib/salesWorkflow";
import { ROLE_LABELS, type UserRole } from "@/types";

export type QueueKind = "approvals" | "signOff" | "rejections";

/**
 * Approvals, Results Sign-off and Rejections are three destinations, not one
 * list with a filter, because they are different *jobs* done by different people
 * at different moments (SPEC §10.1). They do share a shape, so they share this
 * component — the difference is the query and the columns, not the layout.
 */
export function QueuePage({ kind }: { kind: QueueKind }) {
  const { lang, t } = useLang();
  const router = useRouter();
  const { data: session } = useSession();
  const now = useNow();

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [limit] = useState(25);

  // Stages 2–5 (and the rest) are the ordinary approvals; 7 is the joint
  // sign-off and gets its own destination, so it's excluded here rather than
  // fetched and filtered afterward — a page filtered AFTER pagination is not
  // a reliable page (25 fetched, some dropped, fewer than 25 shown). `mine`
  // keeps each list to what the viewer can actually act on. Sorted oldest
  // stage-entry first, on the server, since that is the order the page
  // promises and a client-side sort can only be trusted over a full result
  // set, not one page of one.
  const query = {
    approvals:  "status=Pending&mine=true&excludeStage=7&sortField=currentStageEnteredAt&sortOrder=asc",
    signOff:    "status=Pending&stage=7&sortField=currentStageEnteredAt&sortOrder=asc",
    rejections: "status=Rejected&sortField=currentStageEnteredAt&sortOrder=asc",
  }[kind];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/orders?${query}&page=${page}&limit=${limit}`);
      const d = await res.json();
      setOrders(d.orders ?? []);
      setTotal(d.total ?? 0);
    } catch {
      setOrders([]);
      setTotal(0);
    }
    setLoading(false);
  }, [query, page, limit]);

  useEffect(() => { load(); }, [load]);

  const role = (session?.user?.role ?? "") as UserRole;
  const meta = {
    approvals: {
      title: t("Approvals", "الاعتمادات"),
      sub: t("Orders waiting for your decision, oldest first.", "الطلبيات التي تنتظر قرارك، الأقدم أولاً."),
      empty: t("Nothing is waiting for your approval.", "لا يوجد شيء ينتظر اعتمادك."),
    },
    signOff: {
      title: t("Results Sign-off", "اعتماد النتائج"),
      sub: t(
        "Lab results awaiting signature. Both the General Manager and the Technical Manager must sign.",
        "نتائج المختبر التي تنتظر التوقيع. يجب أن يوقّع المدير العام والمدير التقني كلاهما."
      ),
      empty: t("No results are waiting for signature.", "لا توجد نتائج تنتظر التوقيع."),
    },
    rejections: {
      title: t("Rejections", "المرفوضة"),
      sub: t("Orders that were closed, and why.", "الطلبيات التي أُغلقت، وسبب إغلاقها."),
      empty: t("No orders have been rejected.", "لا توجد طلبيات مرفوضة."),
    },
  }[kind];

  const stageName = (i?: number) => {
    const s = SALES_STAGES.find((x) => x.index === i);
    if (!s) return "—";
    return lang === "ar" ? s.groupAr ?? s.ar : s.groupEn ?? s.en;
  };

  /** Has this viewer already signed their half of a stage-7 order? */
  const mySignoff = (o: OrderRow) => {
    const mine = o.steps.filter(
      (s) => s.stageIndex === 7 && SALES_STAGES.find((x) => x.key === s.stageKey)?.role === role
    );
    if (!mine.length) return null;
    return mine[0].status === "approved" || mine[0].status === "completed";
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight flex items-center gap-2">
          <Inbox size={22} className="text-slate-500" />
          {meta.title}
          {total > 0 && (
            <span className="text-sm font-normal bg-sky-100 text-sky-800 rounded-full px-2 py-0.5 tabular-nums">
              {total}
            </span>
          )}
        </h1>
        <p className="text-sm text-slate-500 mt-1">{meta.sub}</p>
      </div>

      {loading && <p className="text-sm text-slate-400">{t("Loading…", "جارٍ التحميل…")}</p>}

      {!loading && !orders.length && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <p className="text-sm text-slate-500">{meta.empty}</p>
        </div>
      )}

      {!loading && orders.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100">
          {orders.map((o) => {
              const tone = now ? agingTone(o.currentStageEnteredAt, now) : "calm";
              const toneClass = { calm: "text-slate-400", warn: "text-amber-600", late: "text-red-600 font-medium" }[tone];
              const waited = now
                ? formatDuration(now - new Date(o.currentStageEnteredAt).getTime(), lang)
                : "";
              const signed = kind === "signOff" ? mySignoff(o) : null;

              return (
                <div
                  key={o._id}
                  onClick={() => router.push(`/orders/${o._id}`)}
                  className="p-3.5 flex items-center gap-3 flex-wrap cursor-pointer hover:bg-slate-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <bdi className="font-mono text-sm text-sky-700">{o.orderNumber}</bdi>
                      {o.referenceNo && (
                        <bdi className="font-mono text-xs text-slate-400">{o.referenceNo}</bdi>
                      )}
                      <span className="text-sm text-slate-800">
                        {((lang === "ar" && o.customerAr) || o.customer) || "—"}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {kind === "rejections" ? (
                        <>
                          {stageName(o.rejection?.stageIndex ?? undefined)} · {o.rejection?.byName}
                          {o.rejection?.reason && <span className="text-slate-600"> — {o.rejection.reason}</span>}
                        </>
                      ) : (
                        <>
                          {o.currentStageIndex}. {stageName(o.currentStageIndex)}
                          <span className="text-slate-300 mx-1.5">·</span>
                          <bdi>{formatDate(o.orderDate)}</bdi>
                        </>
                      )}
                    </p>
                  </div>

                  {o.labOverallStatus && kind === "signOff" && (
                    <QcStatusBadge status={o.labOverallStatus} size="xs" />
                  )}

                  {/* On the sign-off page the useful fact is not "it is waiting"
                      but "whose signature is missing" — including whether it is
                      yours, which is the only reason you opened this page. */}
                  {kind === "signOff" && signed !== null && (
                    <span
                      className={
                        "text-xs px-2 py-0.5 rounded-full whitespace-nowrap " +
                        (signed ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800 font-medium")
                      }
                    >
                      {signed
                        ? t("You have signed — waiting on the other", "وقّعتَ — في انتظار الآخر")
                        : t("Your signature is missing", "توقيعك ناقص")}
                    </span>
                  )}

                  <bdi className="text-sm tabular-nums text-slate-700 whitespace-nowrap">
                    {((o.totalWeightKg ?? 0) / 1000).toFixed(3)} {t("t", "طن")}
                  </bdi>

                  {kind !== "rejections" && waited && (
                    <span className={`text-xs inline-flex items-center gap-1 whitespace-nowrap ${toneClass}`}>
                      <Clock size={11} />
                      <bdi>{waited}</bdi>
                    </span>
                  )}
                </div>
              );
            })}
        </div>
      )}

      {total > limit && (
        <div className="flex items-center justify-center gap-2">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="h-9 px-3 rounded-lg border border-slate-200 text-sm disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer hover:bg-slate-50"
          >
            {t("Previous", "السابق")}
          </button>
          <span className="text-sm text-slate-500 tabular-nums">
            <bdi>{page} / {Math.max(1, Math.ceil(total / limit))}</bdi>
            <span className="text-slate-300 mx-1.5">·</span>
            <bdi>{total}</bdi> {t("orders", "طلبية")}
          </span>
          <button
            disabled={page >= Math.ceil(total / limit)}
            onClick={() => setPage((p) => p + 1)}
            className="h-9 px-3 rounded-lg border border-slate-200 text-sm disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer hover:bg-slate-50"
          >
            {t("Next", "التالي")}
          </button>
        </div>
      )}

      {kind === "approvals" && !loading && orders.length > 0 && (
        <p className="text-xs text-slate-400">
          {t(
            `Sorted oldest first. You are acting as ${ROLE_LABELS[role]?.en ?? role}.`,
            `مرتّبة الأقدم أولاً. أنت تتصرّف بصفة ${ROLE_LABELS[role]?.ar ?? role}.`
          )}
        </p>
      )}
    </div>
  );
}
