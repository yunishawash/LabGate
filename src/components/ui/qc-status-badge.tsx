"use client";
import { CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { LAB_STATUS_LABELS, type LabStatus } from "@/types";
import { useLang } from "@/components/layout/AppShell";

interface QcStatusBadgeProps {
  status?: LabStatus | string;
  size?: "sm" | "xs";
}

const STYLES: Record<LabStatus, { cls: string; icon: React.ReactNode }> = {
  pass:    { cls: "bg-green-100 text-green-700", icon: <CheckCircle2 size={10} /> },
  warning: { cls: "bg-amber-100 text-amber-700", icon: <AlertTriangle size={10} /> },
  fail:    { cls: "bg-red-100 text-red-700",     icon: <XCircle size={10} /> },
};

/**
 * Reads the language itself rather than taking a `lang` prop. The CMMS version
 * defaulted to English and expected every caller to pass it — which meant one
 * forgotten prop left English text sitting in an Arabic table. Nothing to
 * forget now.
 */
export function QcStatusBadge({ status = "pass", size = "sm" }: QcStatusBadgeProps) {
  const { lang } = useLang();
  const key = (status in STYLES ? status : "pass") as LabStatus;
  const style = STYLES[key];
  const cls = size === "xs" ? "text-xs px-1.5 py-0.5" : "text-xs px-2 py-0.5";

  return (
    <span className={`inline-flex items-center gap-1 rounded-full font-medium whitespace-nowrap ${style.cls} ${cls}`}>
      {style.icon}
      {LAB_STATUS_LABELS[key][lang]}
    </span>
  );
}
