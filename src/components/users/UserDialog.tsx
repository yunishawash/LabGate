"use client";
import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { useLang } from "@/components/layout/AppShell";
import { USER_ROLES, ROLE_LABELS, type UserRole } from "@/types";
import { ALL_PERMISSIONS, MODULE_LABELS, type ModuleKey } from "@/lib/modules";
import { SALES_STAGES } from "@/lib/salesWorkflow";
import type { UserRow } from "@/app/(dashboard)/users/page";

const SELECT_CLASS =
  "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 " +
  "outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 cursor-pointer";

export function UserDialog({
  open, editing, onClose, onSaved,
}: { open: boolean; editing: UserRow | null; onClose: () => void; onSaved: () => void }) {
  const { lang, t } = useLang();

  const [name, setName] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("sales_coordinator");
  const [permissions, setPermissions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    setPassword("");
    if (editing) {
      setName(editing.name);
      setNameAr(editing.nameAr ?? "");
      setEmail(editing.email);
      setRole(editing.role);
      setPermissions(editing.permissions ?? []);
    } else {
      setName(""); setNameAr(""); setEmail("");
      setRole("sales_coordinator");
      setPermissions(["orders"]);
    }
  }, [open, editing]);

  const stages = SALES_STAGES.filter((s) => s.role === role);
  const deputyFor = SALES_STAGES.filter((s) => s.deputyRole === role);
  const roleChanged = !!editing && editing.role !== role;

  const valid =
    name.trim() &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
    (editing ? password === "" || password.length >= 6 : password.length >= 6);

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    setError("");
    const body: Record<string, unknown> = { name, nameAr, email, role, permissions };
    if (password) body.password = password;

    try {
      const res = await fetch(editing ? `/api/users/${editing._id}` : "/api/users", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError((d as { error?: string }).error || `Error ${res.status}`);
        setSaving(false);
        return;
      }
    } catch {
      setError(t("Network error — please try again.", "خطأ في الشبكة — يُرجى المحاولة مرة أخرى."));
      setSaving(false);
      return;
    }
    setSaving(false);
    onSaved();
    onClose();
  };

  const toggle = (p: string) =>
    setPermissions((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? t("Edit user", "تعديل مستخدم") : t("New user", "مستخدم جديد")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("Name", "الاسم")} *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("Name in Arabic", "الاسم بالعربية")}</Label>
              <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} dir="rtl" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{t("Email", "البريد الإلكتروني")} *</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" />
          </div>

          <div className="space-y-1.5">
            <Label>
              {editing ? t("New password (leave blank to keep)", "كلمة سر جديدة (اتركها فاضية للإبقاء)") : t("Password", "كلمة السر")}
              {!editing && " *"}
            </Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" autoComplete="new-password" />
          </div>

          <div className="space-y-1.5">
            <Label>{t("Role", "الدور")} *</Label>
            <Combobox
              triggerClassName={SELECT_CLASS}
              value={role}
              onChange={(v) => setRole(v as UserRole)}
              options={USER_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r]?.[lang] ?? r }))}
            />

            {/*
              The role selector is the most consequential control in the whole
              application: it hands out or takes away the power to sign. Saying
              so at the moment of choosing costs one paragraph and prevents the
              mistake nobody would otherwise notice until an order moved.
            */}
            {(stages.length > 0 || deputyFor.length > 0) && (
              <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900 space-y-0.5">
                {stages.length > 0 && (
                  <p>
                    {t("This role signs stage", "هذا الدور يوقّع المرحلة")}{" "}
                    <strong>{stages.map((s) => s.index).join(", ")}</strong>
                    {" — "}
                    {stages.map((s) => (lang === "ar" ? s.ar : s.en)).join(" · ")}
                  </p>
                )}
                {deputyFor.length > 0 && (
                  <p>
                    {t("Stands in at stage", "ينوب في المرحلة")}{" "}
                    <strong>{deputyFor.map((s) => s.index).join(", ")}</strong>{" "}
                    {t("while the owner is away.", "عند غياب صاحبها.")}
                  </p>
                )}
              </div>
            )}

            {roleChanged && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 flex items-start gap-2">
                <AlertTriangle size={14} className="text-amber-600 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-amber-800">
                  {t(
                    `You are changing an existing user's role. Their old signing power is removed and the new one granted immediately; the change is recorded in the audit trail.`,
                    "أنت تغيّر دور مستخدم قائم. تُسحب صلاحية توقيعه السابقة وتُمنح الجديدة فوراً، ويُسجَّل التغيير في سجل التدقيق."
                  )}
                </p>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>{t("Sections they can open", "الأقسام التي يستطيع فتحها")}</Label>
            <div className="grid grid-cols-2 gap-1.5">
              {ALL_PERMISSIONS.map((p) => (
                <label key={p} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={permissions.includes(p)}
                    onChange={() => toggle(p)}
                    className="w-4 h-4 accent-sky-600 cursor-pointer"
                  />
                  {MODULE_LABELS[p as ModuleKey]?.[lang] ?? p}
                </label>
              ))}
            </div>
            <p className="text-xs text-slate-400">
              {t(
                "The dashboard, queues and notifications are open to everyone signed in.",
                "لوحة التحكم وقوائم الانتظار والإشعارات متاحة لكل من سجّل الدخول."
              )}
            </p>
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>{t("Cancel", "إلغاء")}</Button>
          <Button onClick={save} disabled={saving || !valid}>
            {saving ? t("Saving…", "جارٍ الحفظ…") : editing ? t("Save changes", "حفظ التعديلات") : t("Create user", "إنشاء المستخدم")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
