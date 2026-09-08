"use client";
import { useCallback, useEffect, useState } from "react";
import { Activity, Check, X, AlertTriangle, RefreshCw } from "lucide-react";
import { useLang } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS, type UserRole } from "@/types";

interface Health {
  db: { ok: boolean; latencyMs: number; name: string; writable: boolean; replicaSet: string | null };
  app: { node: string; uptimeSec: number; env: string };
  counts: { orders: number; pending: number; stuck: number; samples: number; users: number };
  thresholds: { warnHours: number; lateHours: number };
  staffing: { role: string; active: number; present: number; stages: number[]; hasDeputy: boolean }[];
}

export default function HealthPage() {
  const { lang, t } = useLang();
  const [h, setH] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/health");
      if (!res.ok) { setError(`HTTP ${res.status}`); setH(null); }
      else { setError(""); setH(await res.json()); }
    } catch {
      setError(t("Could not reach the server.", "تعذّر الوصول إلى الخادم."));
    }
    setLoading(false);
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const uptime = (s: number) =>
    s < 3600 ? `${Math.round(s / 60)} ${t("min", "د")}`
      : s < 86400 ? `${Math.round(s / 3600)} ${t("h", "س")}`
      : `${Math.round(s / 86400)} ${t("d", "ي")}`;

  // A role with nobody present cannot move an order, and if the stage has no
  // deputy nothing else can either — that is the row worth reading first.
  const gaps = (h?.staffing ?? []).filter((s) => s.present === 0);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight flex items-center gap-2">
            <Activity size={22} className="text-slate-500" />
            {t("System Health", "صحة النظام")}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {t("Is the system able to do its job right now?", "هل النظام قادر على أداء عمله الآن؟")}
          </p>
        </div>
        <Button variant="outline" className="gap-2" onClick={load} disabled={loading}>
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          {t("Refresh", "تحديث")}
        </Button>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
      {loading && !h && <p className="text-sm text-slate-400">{t("Checking…", "جارٍ الفحص…")}</p>}

      {h && (
        <>
          {gaps.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
              <p className="text-sm font-medium text-amber-900 flex items-center gap-2 mb-1.5">
                <AlertTriangle size={16} />
                {t("Roles with nobody available", "أدوار لا يتوفّر فيها أحد")}
              </p>
              <ul className="text-sm text-amber-800 space-y-1">
                {gaps.map((s) => (
                  <li key={s.role}>
                    <strong>{ROLE_LABELS[s.role as UserRole]?.[lang] ?? s.role}</strong>
                    {" — "}
                    {t(`stage ${s.stages.join(", ")}`, `المرحلة ${s.stages.join("، ")}`)}
                    {s.active === 0
                      ? t(" · no active user at all", " · لا يوجد مستخدم فعّال أصلاً")
                      : t(" · everyone is away", " · الجميع غائبون")}
                    {!s.hasDeputy && (
                      <span className="font-medium">
                        {t(" · no deputy for this stage, so orders stop here", " · لا نائب لهذه المرحلة، فتتوقّف الطلبيات عندها")}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <Panel title={t("Database", "قاعدة البيانات")}>
              <Row label={t("Reachable", "متاحة")} value={<Flag ok={h.db.ok} />} />
              <Row label={t("Accepts writes", "بتقبل الكتابة")} value={<Flag ok={h.db.writable} />} />
              <Row label={t("Response", "زمن الاستجابة")} value={<bdi className="tabular-nums">{h.db.latencyMs} ms</bdi>} />
              <Row label={t("Name", "الاسم")} value={<bdi className="font-mono text-xs">{h.db.name}</bdi>} />
              <Row
                label={t("Replica set", "مجموعة النسخ")}
                value={
                  h.db.replicaSet
                    ? <bdi className="font-mono text-xs">{h.db.replicaSet}</bdi>
                    : <span className="text-slate-500">{t("standalone", "مستقلة")}</span>
                }
              />
            </Panel>

            <Panel title={t("Application", "التطبيق")}>
              <Row label={t("Environment", "البيئة")} value={<bdi className="font-mono text-xs">{h.app.env}</bdi>} />
              <Row label={t("Node", "نود")} value={<bdi className="font-mono text-xs">{h.app.node}</bdi>} />
              <Row label={t("Running for", "قيد التشغيل منذ")} value={<bdi>{uptime(h.app.uptimeSec)}</bdi>} />

              {/* The aging thresholds, readable from the running system. They
                  decide a colour on five screens and whether the "orders are
                  stuck" alert appears at all, so guessing them from a shade of
                  amber is not good enough. */}
              <div className="pt-2 mt-1 border-t border-slate-100 space-y-2">
                <Row
                  label={
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm bg-amber-500" />
                      {t("Turns amber after", "يصير كهرمانياً بعد")}
                    </span>
                  }
                  value={<bdi className="tabular-nums">{h.thresholds.warnHours} {t("h", "ساعة")}</bdi>}
                />
                <Row
                  label={
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm bg-red-500" />
                      {t("Turns red after", "يصير أحمر بعد")}
                    </span>
                  }
                  value={<bdi className="tabular-nums font-medium">{h.thresholds.lateHours} {t("h", "ساعة")}</bdi>}
                />
                <p className="text-xs text-slate-400 leading-relaxed">
                  {t(
                    "Applies to the clock on every order row, the stuck-orders alert, the chain bars, and the count above.",
                    "ينطبق على المؤقّت في كل صف طلبية، وتنبيه الطلبيات المتوقّفة، وأشرطة السلسلة، والعدد أعلاه."
                  )}
                </p>
              </div>
            </Panel>

            <Panel title={t("Workload", "حجم العمل")}>
              <Row label={t("Orders", "الطلبيات")} value={<bdi className="tabular-nums">{h.counts.orders}</bdi>} />
              <Row label={t("In progress", "قيد الإجراء")} value={<bdi className="tabular-nums">{h.counts.pending}</bdi>} />
              <Row
                label={t(
                  `Waiting over ${h.thresholds.lateHours} hours`,
                  `منتظرة أكثر من ${h.thresholds.lateHours} ساعة`
                )}
                value={
                  <bdi className={"tabular-nums " + (h.counts.stuck ? "text-red-700 font-medium" : "")}>
                    {h.counts.stuck}
                  </bdi>
                }
              />
              <Row label={t("Lab samples", "عيّنات المختبر")} value={<bdi className="tabular-nums">{h.counts.samples}</bdi>} />
              <Row label={t("Active users", "مستخدمون فعّالون")} value={<bdi className="tabular-nums">{h.counts.users}</bdi>} />
            </Panel>

            <Panel title={t("Staffing along the chain", "التغطية على طول السلسلة")}>
              {/* The caption belongs once at the top, not repeated on all seven
                  rows where it drowned out the numbers it was explaining. */}
              <p className="text-xs text-slate-400 -mt-1 pb-1 text-end">
                {t("available / total", "متاح / إجمالي")}
              </p>
              <ul className="divide-y divide-slate-100 -my-1">
                {h.staffing.map((s) => (
                  <li key={s.role} className="flex items-center justify-between gap-3 py-1.5">
                    <span className="text-sm text-slate-700 min-w-0 truncate">
                      <span className="font-mono text-xs text-slate-400 me-1.5">{s.stages.join("·")}</span>
                      {ROLE_LABELS[s.role as UserRole]?.[lang] ?? s.role}
                    </span>
                    <span className="text-sm whitespace-nowrap tabular-nums">
                      <bdi className={s.present ? "text-slate-900 font-medium" : "text-red-700 font-medium"}>
                        {s.present}
                      </bdi>
                      <span className="text-slate-400"> / {s.active}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-xl border border-slate-200 shadow-sm">
      <h2 className="text-sm font-medium text-slate-900 px-4 py-3 border-b border-slate-100">{title}</h2>
      <div className="p-4 space-y-2 text-sm">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-800 text-end">{value}</span>
    </div>
  );
}

function Flag({ ok }: { ok: boolean }) {
  const { t } = useLang();
  return (
    <span className={`inline-flex items-center gap-1 ${ok ? "text-emerald-700" : "text-red-700"}`}>
      {ok ? <Check size={14} /> : <X size={14} />}
      {ok ? t("yes", "نعم") : t("no", "لا")}
    </span>
  );
}
