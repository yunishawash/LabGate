"use client";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { LayoutDashboard } from "lucide-react";
import { useLang } from "@/components/layout/AppShell";
import { ROLE_LABELS, type UserRole } from "@/types";
import type { BlockKey } from "@/lib/dashboardBlocks";
import {
  WaitingOnMe, MyOrders, Pipeline, Stuck, ThisMonth,
  Rejections, LabQueue, Quality, ReadyToWeigh, Coverage,
} from "@/components/dashboard/blocks";
import { VolumeTrend, QualityTrend, ProductMix } from "@/components/dashboard/charts";

interface Payload {
  role: string;
  blocks: BlockKey[];
  data: Record<string, unknown>;
  inChain: number;
}

/** Blocks that span the full width; the rest sit in a two-column grid. */
const WIDE: BlockKey[] = ["stuck", "thisMonth", "coverage"];

/**
 * The year-long trend charts get their own zone, below the day-to-day
 * blocks, so the page reads top-to-bottom as "what needs me today" → "how is
 * the plant doing over time" rather than interleaving the two questions.
 * `volumeTrend` alone is full width (12 months + a dual axis need the room);
 * `qualityTrend` and `productMix` pair up underneath it.
 */
const ANALYTICS: BlockKey[] = ["volumeTrend", "qualityTrend", "productMix"];

export default function DashboardPage() {
  const { data: session } = useSession();
  const { lang, t } = useLang();
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/dashboard");
      setPayload(res.ok ? await res.json() : null);
    } catch {
      setPayload(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const role = (session?.user?.role ?? "") as UserRole;
  // The whole name, not the first word: real staff have two-part names and a
  // greeting that says "Good day, Abdel" to Abdel Rahman reads as a bug.
  const name = session?.user?.name ?? "";

  /**
   * The block list and its order come from the server, not from a role check
   * here. A `if (role === …)` ladder in this file would be a second copy of
   * `ROLE_BLOCKS`, free to drift from the one the API computes with.
   */
  const render = (key: BlockKey) => {
    const d = payload?.data as Record<string, never> | undefined;
    if (!d || d[key] === undefined) return null;
    switch (key) {
      case "waitingOnMe":  return <WaitingOnMe data={d[key]} inChain={payload!.inChain} />;
      case "myOrders":     return <MyOrders data={d[key]} />;
      case "pipeline":     return <Pipeline data={d[key]} />;
      case "stuck":        return <Stuck data={d[key]} />;
      case "thisMonth":    return <ThisMonth data={d[key]} />;
      case "rejections":   return <Rejections data={d[key]} />;
      case "labQueue":     return <LabQueue data={d[key]} />;
      case "quality":      return <Quality data={d[key]} />;
      case "readyToWeigh": return <ReadyToWeigh data={d[key]} />;
      case "coverage":     return <Coverage data={d[key]} />;
      case "volumeTrend":  return <VolumeTrend data={d[key]} />;
      case "qualityTrend": return <QualityTrend data={d[key]} />;
      case "productMix":   return <ProductMix data={d[key]} />;
      default:             return null;
    }
  };

  const blocks = payload?.blocks ?? [];
  const wide = blocks.filter((b) => WIDE.includes(b));
  const analytics = blocks.filter((b) => ANALYTICS.includes(b));
  const narrow = blocks.filter((b) => !WIDE.includes(b) && !ANALYTICS.includes(b));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight flex items-center gap-2">
          <LayoutDashboard size={22} className="text-slate-500" />
          {name ? t(`Good day, ${name}`, `أهلاً ${name}`) : t("Dashboard", "لوحة التحكم")}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {ROLE_LABELS[role]?.[lang] ?? role}
          <span className="text-slate-300 mx-1.5">·</span>
          {t(
            "What is waiting on you, and where everything stands.",
            "ما الذي ينتظرك، وأين وصلت الطلبيات."
          )}
        </p>
      </div>

      {loading && <p className="text-sm text-slate-400">{t("Loading…", "جارٍ التحميل…")}</p>}

      {!loading && !payload && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {t("Could not load the dashboard.", "تعذّر تحميل لوحة التحكم.")}
        </p>
      )}

      {/* Alerts and month figures run the full width; the rest pair up. Stuck
          orders come first for the roles that get them — an alert below the fold
          is not an alert. */}
      {wide.filter((b) => b === "stuck").map((b) => <div key={b}>{render(b)}</div>)}

      {narrow.length > 0 && (
        // A lone card left over in an odd-sized set spans both columns rather
        // than sitting beside empty space — `:last-child:nth-child(odd)` is
        // true only when the total count is odd AND this is the final item.
        <div className="grid gap-4 lg:grid-cols-2 items-start lg:[&>*:last-child:nth-child(odd)]:col-span-2">
          {narrow.map((b) => <div key={b}>{render(b)}</div>)}
        </div>
      )}

      {analytics.includes("volumeTrend") && <div>{render("volumeTrend")}</div>}
      {(() => {
        const rest = analytics.filter((b) => b !== "volumeTrend");
        return rest.length > 0 ? (
          <div className="grid gap-4 lg:grid-cols-2 items-start lg:[&>*:last-child:nth-child(odd)]:col-span-2">
            {rest.map((b) => <div key={b}>{render(b)}</div>)}
          </div>
        ) : null;
      })()}

      {wide.filter((b) => b !== "stuck").map((b) => <div key={b}>{render(b)}</div>)}
    </div>
  );
}
