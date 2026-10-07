"use client";
import { useEffect, useState } from "react";
import { KeyRound, Eye, EyeOff } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLang } from "@/components/layout/AppShell";
import type { UserRow } from "@/app/(dashboard)/users/page";

/** What `POST /api/users` and `PUT /api/users/[id]` both enforce. Repeated
 *  here only so the person is told before the round trip, never instead. */
const MIN_LENGTH = 6;

/**
 * Resetting one person's password, and nothing else.
 *
 * The key button used to open the full user-edit dialog — the same one the
 * pencil opens, with a password field buried among name, email, role and
 * permissions. Two buttons doing the identical thing is a button that lies,
 * and reaching a password through a form that can also change somebody's role
 * invites a slip on the way past.
 *
 * So the edit dialog no longer carries a password at all when editing, and
 * this does one job: set a new password for an account that already exists.
 * (Creating a user still sets the first password in the create form — there is
 * no account to reset yet.)
 */
export function PasswordDialog({
  open, user, onClose, onSaved,
}: { open: boolean; user: UserRow | null; onClose: () => void; onSaved: () => void }) {
  const { lang, t } = useLang();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [reveal, setReveal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setPassword("");
    setConfirm("");
    setReveal(false);
    setError("");
  }, [open]);

  const tooShort = password.length > 0 && password.length < MIN_LENGTH;
  /**
   * Typed twice, because nobody can read what they typed into a password box
   * and the person who pays for a typo here is the one locked out — not the
   * administrator making it.
   */
  const mismatch = confirm.length > 0 && password !== confirm;
  const ready = password.length >= MIN_LENGTH && password === confirm;

  const save = async () => {
    if (!ready || !user) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/users/${user._id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // Only the password. The route whitelists its fields, so nothing else
        // about this account can move as a side effect of a reset.
        body: JSON.stringify({ password }),
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

  const who = user ? (lang === "ar" && user.nameAr) || user.name : "";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound size={17} className="text-slate-500" />
            {t("Set a new password", "تعيين كلمة سر جديدة")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* Whose account this is, said once and plainly: this dialog changes
              how one named person signs in. */}
          <p className="text-sm text-slate-600">
            {t("For", "للمستخدم")} <bdi className="font-medium text-slate-900">{who}</bdi>
            <bdi className="block text-xs text-slate-400 mt-0.5">{user?.email}</bdi>
          </p>

          <div className="space-y-1.5">
            <Label htmlFor="pw-new">{t("New password", "كلمة السر الجديدة")} *</Label>
            <div className="relative">
              <Input
                id="pw-new"
                type={reveal ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                dir="ltr"
                autoComplete="new-password"
                className="pe-10"
              />
              {/* Revealing beats a "leave blank" hint: the administrator can
                  check what they typed before handing it over. */}
              <button
                type="button"
                onClick={() => setReveal((r) => !r)}
                className="absolute end-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                title={reveal ? t("Hide", "إخفاء") : t("Show", "إظهار")}
                aria-label={reveal ? t("Hide password", "إخفاء كلمة السر") : t("Show password", "إظهار كلمة السر")}
              >
                {reveal ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            <p className={`text-xs ${tooShort ? "text-red-600" : "text-slate-400"}`}>
              {t(
                `At least ${MIN_LENGTH} characters.`,
                `${MIN_LENGTH} أحرف على الأقل.`
              )}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pw-confirm">{t("Confirm password", "تأكيد كلمة السر")} *</Label>
            <Input
              id="pw-confirm"
              type={reveal ? "text" : "password"}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              dir="ltr"
              autoComplete="new-password"
            />
            {mismatch && (
              <p className="text-xs text-red-600">
                {t("The two entries do not match.", "الإدخالان غير متطابقين.")}
              </p>
            )}
          </div>

          <p className="text-xs text-slate-400">
            {/* No em-dash: at this size it lands on a line break and the bidi
                algorithm shuffles it against the Arabic around it. */}
            {t(
              "The change takes effect immediately and is written to the audit trail. The system does not tell them, so you must.",
              "يسري التغيير فورًا ويُسجَّل في سجلّ التدقيق. والنظام لا يُبلغ المستخدم، فأبلغه أنت بكلمة سره الجديدة."
            )}
          </p>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>{t("Cancel", "إلغاء")}</Button>
          <Button onClick={save} disabled={saving || !ready}>
            {saving ? t("Saving…", "جارٍ الحفظ…") : t("Set password", "تعيين كلمة السر")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
