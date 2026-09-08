"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bell, CheckCheck, Clock, XCircle, PackageCheck, AlertTriangle, FlaskConical, Trash2,
} from "lucide-react";
import { useLang } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils";
import { useUnreadCount } from "@/lib/useUnreadCount";
import type { LucideIcon } from "lucide-react";

interface Note {
  _id: string;
  type: string;
  title: string; titleAr: string;
  message: string; messageAr: string;
  salesOrderId?: string | null;
  labSampleId?: string | null;
  isRead: boolean;
  createdAt: string;
}

/**
 * Icon and tone per type. A stalled order is not the same event as an approval
 * request, and a bell that renders both identically is a bell people stop
 * reading.
 */
const STYLE: Record<string, { icon: LucideIcon; tone: string }> = {
  order_pending:  { icon: Clock,         tone: "bg-sky-50 text-sky-700" },
  order_rejected: { icon: XCircle,       tone: "bg-red-50 text-red-700" },
  order_posted:   { icon: PackageCheck,  tone: "bg-emerald-50 text-emerald-700" },
  order_stalled:  { icon: AlertTriangle, tone: "bg-amber-50 text-amber-700" },
  lab_fail:       { icon: FlaskConical,  tone: "bg-red-50 text-red-700" },
};

/**
 * Where a notification leads.
 *
 * One helper, not an `if (n.salesOrderId)` at the click site: the CMMS hard-codes
 * `pmTaskId` in its handler, so every notification of a newer kind silently
 * became unclickable. A row that cannot be opened is worse than no row.
 */
function linkFor(n: Note): string | null {
  if (n.salesOrderId) return `/orders/${n.salesOrderId}`;
  if (n.labSampleId) return "/lab";
  return null;
}

export default function NotificationsPage() {
  const { lang, t } = useLang();
  const router = useRouter();
  const { refetch: refetchBadge } = useUnreadCount(true);

  const [notes, setNotes] = useState<Note[]>([]);
  const [unread, setUnread] = useState(0);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/notifications?limit=60${onlyUnread ? "&unread=true" : ""}`);
      const d = await res.json();
      setNotes(d.notifications ?? []);
      setUnread(d.unread ?? 0);
    } catch {
      setNotes([]);
    }
    setLoading(false);
  }, [onlyUnread]);

  useEffect(() => { load(); }, [load]);

  const markAll = async () => {
    await fetch("/api/notifications", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markAllRead: true }),
    });
    load();
    refetchBadge();
  };

  const open = async (n: Note) => {
    if (!n.isRead) {
      await fetch(`/api/notifications/${n._id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isRead: true }),
      }).catch(() => {});
      refetchBadge();
    }
    const href = linkFor(n);
    if (href) router.push(href);
    else load();
  };

  const remove = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await fetch(`/api/notifications/${id}`, { method: "DELETE" }).catch(() => {});
    load();
    refetchBadge();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight flex items-center gap-2">
            <Bell size={22} className="text-slate-500" />
            {t("Notifications", "الإشعارات")}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {unread > 0
              ? t(`${unread} unread`, `${unread} غير مقروء`)
              : t("Everything is read.", "كل شيء مقروء.")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setOnlyUnread(!onlyUnread)}
            className={
              "h-9 px-3 rounded-lg text-sm cursor-pointer border " +
              (onlyUnread
                ? "border-sky-400 bg-sky-50 text-sky-800"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300")
            }
          >
            {t("Unread only", "غير المقروء فقط")}
          </button>
          {unread > 0 && (
            <Button variant="outline" className="gap-2" onClick={markAll}>
              <CheckCheck size={15} />
              {t("Mark all read", "تعليم الكل كمقروء")}
            </Button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100">
        {loading && <p className="p-4 text-sm text-slate-400">{t("Loading…", "جارٍ التحميل…")}</p>}
        {!loading && !notes.length && (
          <p className="p-6 text-sm text-slate-400 text-center">
            {onlyUnread
              ? t("Nothing unread.", "لا يوجد شيء غير مقروء.")
              : t("No notifications yet.", "لا توجد إشعارات بعد.")}
          </p>
        )}
        {notes.map((n) => {
          const style = STYLE[n.type] ?? { icon: Bell, tone: "bg-slate-100 text-slate-600" };
          const Icon = style.icon;
          return (
            <div
              key={n._id}
              onClick={() => open(n)}
              className={
                "flex items-start gap-3 p-3.5 cursor-pointer hover:bg-slate-50 group " +
                (n.isRead ? "" : "bg-sky-50/40")
              }
            >
              <span className={`w-9 h-9 rounded-lg grid place-items-center flex-shrink-0 ${style.tone}`}>
                <Icon size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <p className={`text-sm ${n.isRead ? "text-slate-700" : "text-slate-900 font-medium"}`}>
                  {(lang === "ar" && n.titleAr) || n.title}
                </p>
                <p className="text-sm text-slate-500 mt-0.5 break-words">
                  {(lang === "ar" && n.messageAr) || n.message}
                </p>
                <bdi className="text-xs text-slate-400 mt-1 block">{formatDateTime(n.createdAt)}</bdi>
              </div>
              {!n.isRead && (
                <span className="w-2 h-2 rounded-full bg-sky-500 mt-2 flex-shrink-0" aria-hidden />
              )}
              <button
                onClick={(e) => remove(e, n._id)}
                className="w-8 h-8 rounded-lg grid place-items-center text-slate-300 hover:text-red-600 hover:bg-red-50 cursor-pointer opacity-0 group-hover:opacity-100 flex-shrink-0"
                aria-label={t("Delete", "حذف")}
              >
                <Trash2 size={15} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
