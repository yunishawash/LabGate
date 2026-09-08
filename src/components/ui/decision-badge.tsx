"use client";
import { CheckCircle2, XCircle, Clock } from "lucide-react";
import { LAB_DECISION_LABELS, type LabDecision } from "@/types";
import { useLang } from "@/components/layout/AppShell";

interface DecisionBadgeProps {
  decision?: LabDecision | string;
  size?: "sm" | "xs";
}

const STYLES: Record<LabDecision, { cls: string; icon: React.ReactNode }> = {
  accepted: { cls: "bg-green-100 text-green-700", icon: <CheckCircle2 size={10} /> },
  rejected: { cls: "bg-red-100 text-red-700",     icon: <XCircle size={10} /> },
  pending:  { cls: "bg-slate-100 text-slate-500", icon: <Clock size={10} /> },
};

export function DecisionBadge({ decision = "pending", size = "sm" }: DecisionBadgeProps) {
  const { lang } = useLang();
  const key = (decision in STYLES ? decision : "pending") as LabDecision;
  const style = STYLES[key];
  const cls = size === "xs" ? "text-xs px-1.5 py-0.5" : "text-xs px-2 py-0.5";

  return (
    <span className={`inline-flex items-center gap-1 rounded-full font-medium whitespace-nowrap ${style.cls} ${cls}`}>
      {style.icon}
      {LAB_DECISION_LABELS[key][lang]}
    </span>
  );
}
