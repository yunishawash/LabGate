"use client";
import { useSession } from "next-auth/react";
import {
  Eye, Info, Lock, XCircle, UserCheck, Clock, ChevronDown,
  ArrowRight, FilePlus2, Wallet, ShieldCheck, Cog, FlaskConical, Stamp, Scale,
  type LucideIcon,
} from "lucide-react";
import { useLang } from "@/components/layout/AppShell";
import { SALES_STAGES } from "@/lib/salesWorkflow";
import { ROLE_LABELS, type UserRole } from "@/types";

/**
 * This role's visibility rule, in one plain sentence.
 *
 * A system that deliberately hides rows owes the person an explanation, or the
 * first question every day is "why can't I see order X?".
 */
export function VisibilityBanner() {
  const { lang, t } = useLang();
  const { data: session } = useSession();
  const role = (session?.user?.role ?? "") as UserRole;
  const roleLabel = ROLE_LABELS[role]?.[lang] ?? role;

  const sentence = (() => {
    if (role === "admin") return t("You can see every order.", "ترى جميع الطلبيات.");
    if (role === "general_manager") {
      return t(
        "You can see all orders from the moment they are created, and may reject one at any stage.",
        "ترى جميع الطلبيات منذ لحظة إنشائها، ويمكنك رفض أي منها في أي مرحلة."
      );
    }
    if (role === "sales_coordinator") {
      return t(
        "You can see the orders you raised.",
        "ترى الطلبيات التي أنشأتها."
      );
    }
    const first = SALES_STAGES.find((s) => s.role === role || s.deputyRole === role);
    if (!first) return t("You have no part in the order chain.", "ليس لك دور في سلسلة الطلبيات.");
    return t(
      `You see an order once it reaches stage ${first.index} — ${first.en}.`,
      `ترى الطلبية عند وصولها إلى المرحلة ${first.index} — ${first.ar}.`
    );
  })();

  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-sky-200 bg-sky-50/70 px-3 py-2">
      <Eye size={15} className="text-sky-600 mt-0.5 flex-shrink-0" />
      <p className="text-sm text-slate-700">
        <span className="font-medium">{t("Visibility for", "صلاحية الاطّلاع لدور")} {roleLabel}</span>
        <span className="text-slate-400 mx-1.5">·</span>
        {sentence}
      </p>
    </div>
  );
}

const RULES = [
  { icon: Eye,       en: ["What you can see", "Orders reach you when the person before you approves."],
                     ar: ["ما الذي تراه", "تصلك الطلبية بعد أن يعتمدها من قبلك."] },
  { icon: Clock,     en: ["Current stage", "Where the order is now, and how long it has been there. Red past two days."],
                     ar: ["المرحلة الحالية", "أين الطلبية الآن، ومنذ متى. تتحوّل إلى الأحمر بعد يومين."] },
  { icon: UserCheck, en: ["Waiting for", "Who must act next. Stage 7 needs both managers."],
                     ar: ["منتظر من", "من عليه التصرّف. المرحلة ٧ تتطلّب توقيع المديرَين معاً."] },
  { icon: XCircle,   en: ["Rejection is permanent", "A rejected order is closed. A new one must be raised."],
                     ar: ["الرفض نهائي", "الطلبية المرفوضة تُغلَق نهائياً. يجب إنشاء طلبية جديدة."] },
  { icon: Lock,      en: ["No editing after approval", "Once anyone approves, the quantities are frozen."],
                     ar: ["لا تعديل بعد الاعتماد", "بمجرّد اعتماد أي شخص، تُجمَّد الكميات."] },
  { icon: Info,      en: ["Deputy signatures", "A stand-in is always recorded as “on behalf of…”."],
                     ar: ["توقيع النائب", "النائب بينكتب دايماً “بالإنابة عن…”."] },
];

/**
 * The rules, restated where they are used.
 *
 * These are unusual enough that nobody retains them from one training session,
 * and the people who need them most open this screen occasionally. Cheaper on
 * the page than explained twice a week.
 */
/**
 * The six invariants, under the table rather than beside it. As a sidebar it
 * cost the "Waiting for" column the width it needs to show a name and a role,
 * and this is reference material somebody reads once — the table is the tool.
 */
export function HowToReadPanel() {
  const { lang, t } = useLang();
  return (
    <details className="bg-white rounded-xl border border-slate-200 shadow-sm group" open>
      <summary className="px-4 py-3 text-sm font-medium text-slate-900 cursor-pointer list-none flex items-center gap-2">
        <ChevronDown size={15} className="text-slate-400 transition-transform group-open:rotate-0 -rotate-90 rtl:rotate-90 rtl:group-open:rotate-0" />
        {t("How to read this view", "كيف تقرأ هذه الشاشة")}
      </summary>
      <div className="px-4 pb-4 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {RULES.map((r, i) => {
          const [title, body] = lang === "ar" ? r.ar : r.en;
          const Icon = r.icon;
          return (
            <div key={i} className="flex items-start gap-2.5">
              <Icon size={14} className="text-slate-400 mt-0.5 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-700">{title}</p>
                <p className="text-xs text-slate-500 leading-relaxed">{body}</p>
              </div>
            </div>
          );
        })}
      </div>
    </details>
  );
}

/**
 * Eight clickable chips with live counts — General Manager and admin ONLY.
 *
 * Hidden for everyone else for a structural reason, not a cosmetic one: only
 * the GM can see orders at every stage, so a "stage 2 (0)" chip would tell a
 * finance manager the plant is empty when it simply is not his to see. A
 * control that lies to six of the eight roles should not be shown to them.
 */
/**
 * One icon per stage.
 *
 * Kept here rather than on `StageDef`: `salesWorkflow.ts` is imported by API
 * routes, and hanging a lucide component off the stage table would pull the
 * icon library into the server bundle for a decision that is purely visual.
 * Keyed by index, because stage 7 is two stages sharing one box.
 */
const STAGE_ICON: Record<number, LucideIcon> = {
  1: FilePlus2,      // raised
  2: UserCheck,      // sales manager
  3: Wallet,         // finance
  4: ShieldCheck,    // general manager
  5: Cog,            // technical / production
  6: FlaskConical,   // the lab
  7: Stamp,          // the two signatures
  8: Scale,          // weighbridge
};

/**
 * The chain as a flow, not as a row of chips: eight stops with an arrow between
 * each, so the screen says "orders start here and finish there" before anybody
 * reads a word. Clicking a stop filters the table to it.
 *
 * Direction needs no code path of its own — `dir="rtl"` already reverses the
 * flex order, so the arrows only have to be flipped as glyphs (`rtl:rotate-180`,
 * the same fix the table chevrons needed). Reordering by hand would fight the
 * browser and break the moment a stage is added.
 *
 * A stop holding nothing is not clickable. Filtering to an empty stage teaches
 * the person nothing and costs them a round trip to undo, and the count is
 * already on screen — showing it greyed says "nothing here" more honestly than
 * a button that leads to an empty table.
 *
 * General Manager and admin only, by the client's decision: every other role
 * sees the chain from their own stage onward, so six of the eight stops would
 * read zero for reasons that have nothing to do with the workload.
 */
export function StageJumpBar({
  counts, grandTotal, active, onPick,
}: {
  counts: Record<number, number>;
  /** The "Shown" total sitting right next to this bar on screen — passed in
   *  explicitly rather than re-derived, so the reconciling sentence below is
   *  always the SAME number the reader can see two inches away, never a
   *  second, independently-computed "total" that could quietly drift from it. */
  grandTotal: number;
  active: string;
  onPick: (stage: string) => void;
}) {
  const { lang, t } = useLang();
  const { data: session } = useSession();
  const role = session?.user?.role ?? "";
  if (role !== "admin" && role !== "general_manager") return null;

  const liveTotal = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3">
      <div className="flex items-baseline justify-between gap-3 px-1 pb-2">
        <div>
          <h3 className="text-sm font-medium text-slate-900">
            {t("Where every order stands", "أين وصلت كل طلبية")}
          </h3>
          {/*
            The counts are the LIVE pipeline only — an order rejected at a
            stage stays frozen there forever but isn't "waiting" anymore, so
            it isn't counted here. That is also exactly why this number and
            "Shown" don't match, and without saying so a reader watching 429
            orders overall but ~20 on this strip reasonably reads it as a bug.
            Naming both counts, and the gap between them, answers the question
            before it gets asked.
          */}
          <p className="text-xs text-slate-400">
            {liveTotal === grandTotal
              ? t("Orders currently in progress at each stage", "الطلبيات قيد الإجراء حالياً في كل مرحلة")
              : t(
                  `${liveTotal} in progress now, out of ${grandTotal} shown below — the rest are already posted or rejected`,
                  `${liveTotal} قيد الإجراء الآن، من إجمالي ${grandTotal} المعروضة أدناه — والباقي إمّا مُرحَّل أو مرفوض`
                )}
          </p>
        </div>
        <span className="text-xs text-slate-400 whitespace-nowrap">
          {active === "all"
            ? t("Click a stage to filter", "انقر على مرحلة للتصفية")
            : t("Click again to clear", "انقر مرة ثانية للإلغاء")}
        </span>
      </div>

      {/* The strip scrolls rather than squashing: eight stops with labels need
          real width, and a wrapped chain stops reading as a sequence. */}
      <div className="overflow-x-auto pb-1">
        <div className="flex items-start w-max mx-auto px-1">
          {Array.from({ length: 8 }, (_, n) => n + 1).map((i, n) => {
            const stage = SALES_STAGES.find((s) => s.index === i)!;
            const label = lang === "ar"
              ? stage.groupAr ?? stage.ar
              : stage.groupEn ?? stage.en;
            const count = counts[i] ?? 0;
            const on = active === String(i);
            const empty = count === 0;
            const Icon = STAGE_ICON[i];

            return (
              <div key={i} className="flex items-start">
                {n > 0 && (
                  <ArrowRight
                    size={16}
                    aria-hidden
                    className="text-slate-300 mt-5 mx-0.5 flex-shrink-0 rtl:rotate-180"
                  />
                )}
                <button
                  type="button"
                  disabled={empty}
                  onClick={() => onPick(on ? "all" : String(i))}
                  title={`${i} · ${label}`}
                  aria-pressed={on}
                  className={
                    "w-[104px] flex flex-col items-center gap-1 rounded-lg px-1.5 py-2 transition-colors " +
                    (empty
                      ? "cursor-not-allowed"
                      : on
                        ? "bg-sky-50 cursor-pointer"
                        : "cursor-pointer hover:bg-slate-50")
                  }
                >
                  <span className="relative">
                    <span
                      className={
                        "w-11 h-11 rounded-full grid place-items-center border-2 transition-colors " +
                        (on
                          ? "bg-sky-600 border-sky-600 text-white"
                          : empty
                            ? "bg-slate-50 border-slate-100 text-slate-300"
                            : "bg-white border-sky-200 text-sky-700")
                      }
                    >
                      <Icon size={19} />
                    </span>
                    {/* The stage number, on the badge itself — people say
                        "it is stuck at three", not "it is at finance". */}
                    <span
                      className={
                        "absolute -top-1 -start-1 w-5 h-5 rounded-full grid place-items-center " +
                        "text-[10px] font-semibold tabular-nums border " +
                        (empty
                          ? "bg-white border-slate-100 text-slate-300"
                          : "bg-slate-900 border-slate-900 text-white")
                      }
                    >
                      {i}
                    </span>
                  </span>

                  <span
                    className={
                      "text-[11px] leading-tight text-center line-clamp-2 min-h-7 " +
                      (empty ? "text-slate-300" : on ? "text-sky-900 font-medium" : "text-slate-600")
                    }
                  >
                    {label}
                  </span>

                  <bdi
                    className={
                      "text-sm tabular-nums " +
                      (empty ? "text-slate-300" : on ? "text-sky-800 font-semibold" : "text-slate-900 font-semibold")
                    }
                  >
                    {count}
                  </bdi>
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {liveTotal === 0 && (
        <p className="text-xs text-slate-400 text-center pt-1">
          {t("No orders are in progress right now.", "لا توجد طلبيات قيد الإجراء حالياً.")}
        </p>
      )}
    </div>
  );
}
