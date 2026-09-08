"use client";
import { useCallback, useEffect, useState } from "react";
import { UserCog, Plus, Search, X, KeyRound, UserMinus, UserCheck, CalendarOff } from "lucide-react";
import { useLang } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { UserDialog } from "@/components/users/UserDialog";
import { DelegationPanel } from "@/components/users/DelegationPanel";
import { formatDate } from "@/lib/utils";
import { USER_ROLES, ROLE_LABELS, type UserRole } from "@/types";
import { SALES_STAGES } from "@/lib/salesWorkflow";
import { MODULE_LABELS, type ModuleKey } from "@/lib/modules";

export interface UserRow {
  _id: string;
  name: string;
  nameAr?: string;
  email: string;
  role: UserRole;
  permissions: string[];
  isActive: boolean;
  isAbsent?: boolean;
  absentFrom?: string | null;
  absentTo?: string | null;
}

const SELECT =
  "h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-700 " +
  "outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 cursor-pointer";

/** Which stages a role owns — shown beside the role so the consequence of the
 *  dropdown is visible at the moment somebody changes it. */
const STAGES_FOR = (role: string) =>
  SALES_STAGES.filter((s) => s.role === role).map((s) => s.index);

export default function UsersPage() {
  const { lang, t } = useLang();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("all");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(25);

  // Every active user, unfiltered and unpaginated — for the delegation
  // picker below, which needs the WHOLE roster to appoint a stand-in from,
  // not whatever page or role filter the table happens to be showing.
  const [allActiveUsers, setAllActiveUsers] = useState<UserRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (search) p.set("search", search);
    if (role !== "all") p.set("role", role);
    try {
      const res = await fetch(`/api/users?${p}`);
      const d = await res.json();
      setUsers(d.users ?? []);
      setTotal(d.total ?? 0);
    } catch {
      setUsers([]); setTotal(0);
    }
    setLoading(false);
  }, [search, role, page, limit]);

  const loadAllActive = useCallback(async () => {
    try {
      const res = await fetch("/api/users?active=true&limit=1000");
      const d = await res.json();
      setAllActiveUsers(d.users ?? []);
    } catch {
      setAllActiveUsers([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadAllActive(); }, [loadAllActive]);

  const setActive = async (u: UserRow, isActive: boolean, confirmSoleHolder = false) => {
    setError("");
    const res = await fetch(`/api/users/${u._id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive, confirmSoleHolder }),
    });
    if (res.status === 409) {
      // The server refuses to strand a stage silently; the confirmation is the
      // person acknowledging that consequence, not a formality.
      const d = await res.json().catch(() => ({}));
      if (window.confirm(`${(d as { error?: string }).error}\n\n${t("Continue anyway?", "هل تريد المتابعة رغم ذلك؟")}`)) {
        return setActive(u, isActive, true);
      }
      return;
    }
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError((d as { error?: string }).error || `Error ${res.status}`);
      return;
    }
    load();
    loadAllActive();
  };

  const toggleAbsence = async (u: UserRow) => {
    setError("");
    const res = await fetch(`/api/users/${u._id}/absence`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isAbsent: !u.isAbsent }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError((d as { error?: string }).error || `Error ${res.status}`);
      return;
    }
    load();
    loadAllActive();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight flex items-center gap-2">
            <UserCog size={22} className="text-slate-500" />
            {t("Users", "المستخدمون")}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {t(
              "A person's role is what lets them sign. Changing it changes who can approve.",
              "دور الشخص هو ما يمنحه صلاحية التوقيع. وتغييره يغيّر من يملك حق الاعتماد."
            )}
          </p>
        </div>
        <Button className="gap-2" onClick={() => setCreating(true)}>
          <Plus size={16} />
          {t("New user", "مستخدم جديد")}
        </Button>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={15} className="absolute start-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder={t("Name or email", "الاسم أو البريد الإلكتروني")} className="h-9 w-64 ps-8" />
        </div>
        <Combobox
          triggerClassName={SELECT + " w-48"}
          value={role}
          onChange={(v) => { setRole(v); setPage(1); }}
          options={[
            { value: "all", label: t("All roles", "كل الأدوار") },
            ...USER_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r]?.[lang] ?? r })),
          ]}
        />
        {(search || role !== "all") && (
          <button onClick={() => { setSearch(""); setRole("all"); setPage(1); }} className="h-9 px-3 rounded-lg text-sm text-slate-500 hover:bg-slate-100 cursor-pointer flex items-center gap-1.5">
            <X size={14} />
            {t("Clear", "مسح")}
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100">
        {loading && <p className="p-4 text-sm text-slate-400">{t("Loading…", "جارٍ التحميل…")}</p>}
        {!loading && !users.length && (
          <p className="p-6 text-sm text-slate-400 text-center">{t("No users match.", "لا يوجد مستخدمون مطابقون.")}</p>
        )}
        {users.map((u) => {
          const stages = STAGES_FOR(u.role);
          return (
            <div key={u._id} className={"p-3.5 flex items-center gap-3 flex-wrap " + (u.isActive ? "" : "bg-slate-50/60")}>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-900 flex items-baseline gap-2 flex-wrap">
                  <span className={u.isActive ? "font-medium" : "text-slate-500"}>
                    {(lang === "ar" && u.nameAr) || u.name}
                  </span>
                  <bdi className="text-xs text-slate-400 font-mono">{u.email}</bdi>
                  {!u.isActive && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-slate-200 text-slate-600">
                      {t("inactive", "معطّل")}
                    </span>
                  )}
                  {u.isAbsent && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                      {t("away", "غائب")}
                      {u.absentTo && <> {t("until", "لحد")} <bdi>{formatDate(u.absentTo)}</bdi></>}
                    </span>
                  )}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {ROLE_LABELS[u.role]?.[lang] ?? u.role}
                  {/* The stages a role owns, next to the role: this is the only
                      place the consequence of the dropdown is visible. */}
                  {stages.length > 0 && (
                    <span className="text-sky-700">
                      {" · "}
                      {t(`signs stage ${stages.join(", ")}`, `يوقّع المرحلة ${stages.join("، ")}`)}
                    </span>
                  )}
                  {u.permissions.length > 0 && (
                    <span className="text-slate-400">
                      {" · "}
                      {/* Labels, not schema keys: `audit-log` is our word for it,
                          not the reader's — and never in Arabic. */}
                      {u.permissions.map((p) => MODULE_LABELS[p as ModuleKey]?.[lang] ?? p).join("، ")}
                    </span>
                  )}
                </p>
              </div>

              <div className="flex items-center gap-1">
                <IconBtn title={t("Edit", "تعديل")} onClick={() => setEditing(u)}>
                  <UserCog size={15} />
                </IconBtn>
                <IconBtn title={t("Reset password", "إعادة تعيين كلمة السر")} onClick={() => setEditing(u)}>
                  <KeyRound size={15} />
                </IconBtn>
                <IconBtn
                  title={u.isAbsent ? t("Mark as back", "تسجيل رجوع") : t("Mark away", "تسجيل غياب")}
                  onClick={() => toggleAbsence(u)}
                  tone={u.isAbsent ? "amber" : "plain"}
                >
                  <CalendarOff size={15} />
                </IconBtn>
                <IconBtn
                  title={u.isActive ? t("Deactivate", "تعطيل") : t("Activate", "تفعيل")}
                  onClick={() => setActive(u, !u.isActive)}
                  tone={u.isActive ? "red" : "green"}
                >
                  {u.isActive ? <UserMinus size={15} /> : <UserCheck size={15} />}
                </IconBtn>
              </div>
            </div>
          );
        })}
      </div>

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
            <bdi>{total}</bdi> {t("users", "مستخدم")}
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

      <DelegationPanel users={allActiveUsers} onChanged={load} />

      <UserDialog
        open={creating || !!editing}
        editing={editing}
        onClose={() => { setCreating(false); setEditing(null); }}
        onSaved={() => { load(); loadAllActive(); }}
      />
    </div>
  );
}

function IconBtn({
  children, title, onClick, tone = "plain",
}: { children: React.ReactNode; title: string; onClick: () => void; tone?: "plain" | "red" | "green" | "amber" }) {
  const cls = {
    plain: "text-slate-400 hover:text-slate-900 hover:bg-slate-100",
    red: "text-slate-400 hover:text-red-700 hover:bg-red-50",
    green: "text-slate-400 hover:text-emerald-700 hover:bg-emerald-50",
    amber: "text-amber-600 hover:text-amber-800 hover:bg-amber-50",
  }[tone];
  return (
    <button onClick={onClick} title={title} aria-label={title} className={`w-8 h-8 rounded-lg grid place-items-center cursor-pointer ${cls}`}>
      {children}
    </button>
  );
}
