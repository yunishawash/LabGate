"use client";
import { useCallback, useEffect, useState } from "react";
import { UserCheck, Plus, Trash2 } from "lucide-react";
import { useLang } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { formatDate, toDateInputValue } from "@/lib/utils";
import { SALES_STAGES } from "@/lib/salesWorkflow";
import { useNow } from "@/lib/useNow";
import { ROLE_LABELS, type UserRole } from "@/types";
import type { UserRow } from "@/app/(dashboard)/users/page";

interface Delegation {
  _id: string;
  role: string;
  toUserId: string;
  toUserName: string;
  from: string;
  to: string;
  reason?: string;
  isActive: boolean;
}

const SELECT =
  "h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-700 " +
  "outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 cursor-pointer";

/**
 * Named stand-ins, listed with their expiry.
 *
 * Separate from the automatic deputy: a deputy may act only while the primary is
 * away, whereas a delegation is authority handed over deliberately and works
 * regardless. Both are shown here because from a manager's point of view the
 * question is the same one — "who can sign for this desk this week".
 */
export function DelegationPanel({ users, onChanged }: { users: UserRow[]; onChanged: () => void }) {
  const { lang, t } = useLang();
  const [rows, setRows] = useState<Delegation[]>([]);
  const [adding, setAdding] = useState(false);
  const [role, setRole] = useState("");
  const [toUserId, setToUserId] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/delegations");
      const d = await res.json();
      setRows(d.delegations ?? []);
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Only roles that actually own a stage can be delegated — handing over a role
  // that signs nothing would be a no-op with a confusing audit entry.
  const delegableRoles = Array.from(new Set(SALES_STAGES.map((s) => s.role)));

  const create = async () => {
    if (!role || !toUserId || !to) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/delegations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, toUserId, from: toDateInputValue(new Date()), to, reason }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError((d as { error?: string }).error || `Error ${res.status}`);
        setBusy(false);
        return;
      }
    } catch {
      setError(t("Network error — please try again.", "خطأ في الشبكة — يُرجى المحاولة مرة أخرى."));
      setBusy(false);
      return;
    }
    setBusy(false);
    setAdding(false);
    setRole(""); setToUserId(""); setTo(""); setReason("");
    load();
    onChanged();
  };

  const revoke = async (id: string) => {
    await fetch(`/api/delegations/${id}`, { method: "DELETE" }).catch(() => {});
    load();
    onChanged();
  };

  /**
   * `isActive` is the server's truth and always applies; the expiry check is a
   * refinement that needs a clock, and a clock read during render is neither
   * pure nor ever refreshed. Until `useNow` lands, show the server's answer.
   */
  const now = useNow(60_000);
  const live = rows.filter(
    (r) => r.isActive && (now === null || new Date(r.to).getTime() >= now)
  );

  return (
    <section className="bg-white rounded-xl border border-slate-200 shadow-sm">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
        <h2 className="text-sm font-medium text-slate-900 flex items-center gap-2">
          <UserCheck size={16} className="text-slate-500" />
          {t("Delegations in force", "التفويضات السارية")}
        </h2>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setAdding(!adding)}>
          <Plus size={14} />
          {t("Appoint a stand-in", "تعيين نائب")}
        </Button>
      </div>

      <div className="p-4 space-y-3">
        {adding && (
          <div className="rounded-lg border border-slate-200 p-3 space-y-2.5">
            <div className="grid sm:grid-cols-3 gap-2.5">
              <div className="space-y-1">
                <Label>{t("Role to hand over", "الدور المراد نقله")}</Label>
                <Combobox
                  triggerClassName={SELECT + " w-full"}
                  value={role}
                  onChange={setRole}
                  placeholder={t("Choose…", "اختر…")}
                  options={delegableRoles.map((r) => ({ value: r, label: ROLE_LABELS[r as UserRole]?.[lang] ?? r }))}
                />
              </div>
              <div className="space-y-1">
                <Label>{t("To", "إلى")}</Label>
                <Combobox
                  triggerClassName={SELECT + " w-full"}
                  value={toUserId}
                  onChange={setToUserId}
                  placeholder={t("Choose…", "اختر…")}
                  options={users.filter((u) => u.isActive).map((u) => ({
                    value: u._id,
                    label: (lang === "ar" && u.nameAr) || u.name,
                    hint: ROLE_LABELS[u.role]?.[lang] ?? u.role,
                  }))}
                />
              </div>
              <div className="space-y-1">
                <Label>{t("Until", "لحد")} *</Label>
                <Input type="date" value={to} min={toDateInputValue(new Date())} onChange={(e) => setTo(e.target.value)} className="h-9" />
              </div>
            </div>
            <div className="space-y-1">
              <Label>{t("Reason", "السبب")}</Label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("Annual leave, travel…", "إجازة، سفر…")} />
            </div>
            {/* An end date is required by the API, not merely encouraged: a
                delegation with no expiry is a permanent transfer of signing
                authority made by accident. */}
            <p className="text-xs text-slate-400">
              {t(
                "An end date is required — a delegation without one would hand over signing authority permanently.",
                "تاريخ الانتهاء مطلوب — التفويض بدونه يسلّم صلاحية التوقيع بصفة دائمة."
              )}
            </p>
            {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
            <div className="flex gap-2">
              <Button size="sm" onClick={create} disabled={busy || !role || !toUserId || !to}>
                {busy ? t("Saving…", "جارٍ الحفظ…") : t("Appoint", "تعيين")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setAdding(false); setError(""); }}>
                {t("Cancel", "إلغاء")}
              </Button>
            </div>
          </div>
        )}

        {live.length === 0 ? (
          <p className="text-sm text-slate-400">
            {t("Nobody is standing in for anybody right now.", "لا أحد ينوب عن أحد حالياً.")}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 -my-1.5">
            {live.map((d) => (
              <li key={d._id} className="py-2 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-800">
                    <strong>{d.toUserName}</strong>{" "}
                    {t("is signing as", "يوقّع بصفة")}{" "}
                    {ROLE_LABELS[d.role as UserRole]?.[lang] ?? d.role}
                  </p>
                  <p className="text-xs text-slate-500">
                    {t("until", "لحد")} <bdi>{formatDate(d.to)}</bdi>
                    {d.reason && <span className="text-slate-400"> — {d.reason}</span>}
                  </p>
                </div>
                <button
                  onClick={() => revoke(d._id)}
                  title={t("Revoke now", "إلغاء فوراً")}
                  className="w-8 h-8 rounded-lg grid place-items-center text-slate-400 hover:text-red-700 hover:bg-red-50 cursor-pointer flex-shrink-0"
                >
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
