"use client";
import Link from "next/link";
import { Hammer, ArrowLeft } from "lucide-react";
import { useLang } from "./AppShell";

/**
 * An honest placeholder for a nav destination that is planned but not built.
 *
 * The sidebar was built to its final shape early so per-role filtering could be
 * proven — which left it promising pages that 404. A page saying "not yet, here
 * is when" is far better than a browser error: it tells the person the link is
 * real and the work is scheduled, rather than looking broken.
 */
export function NotBuiltYet({
  titleEn, titleAr, phase, whatEn, whatAr,
}: {
  titleEn: string;
  titleAr: string;
  /** The checklist step that delivers this screen. */
  phase: string;
  whatEn: string;
  whatAr: string;
}) {
  const { t, lang } = useLang();

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
        {lang === "ar" ? titleAr : titleEn}
      </h1>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 max-w-xl">
        <div className="w-11 h-11 rounded-xl bg-slate-100 grid place-items-center mb-4">
          <Hammer size={20} className="text-slate-400" />
        </div>
        <h2 className="text-base font-medium text-slate-900">
          {t("Not built yet", "لم تُبنَ بعد")}
        </h2>
        <p className="text-sm text-slate-500 mt-1.5">
          {lang === "ar" ? whatAr : whatEn}
        </p>
        <p className="text-xs text-slate-400 mt-4 font-mono">
          {t("Checklist step", "خطوة في القائمة")} {phase}
        </p>

        <Link
          href="/lab"
          className="inline-flex items-center gap-1.5 mt-6 text-sm text-sky-700 hover:text-sky-900"
        >
          <ArrowLeft size={14} className="rtl:rotate-180" />
          {t("Go to the Lab, which is working", "انتقل إلى المختبر، وهو جاهز للعمل")}
        </Link>
      </div>
    </div>
  );
}
