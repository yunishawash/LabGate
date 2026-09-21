"use client";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { LayoutDashboard } from "lucide-react";
import { useLang } from "@/components/layout/AppShell";
import { ROLE_LABELS, type UserRole } from "@/types";
import type { BlockKey } from "@/lib/dashboardBlocks";
import {
  WaitingOnMe, MyOrders, Pipeline, Stuck, ThisMonth, ThisMonthCompact,
  LabQueue, Quality, ReadyToWeigh, Coverage,
} from "@/components/dashboard/blocks";
import { VolumeTrend, QualityTrend, ProductMix } from "@/components/dashboard/charts";
import { DashboardFilterBar, EMPTY_FILTERS, type DashboardFilters } from "@/components/dashboard/FilterBar";

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
 */
const ANALYTICS: BlockKey[] = ["volumeTrend", "qualityTrend", "productMix"];

/**
 * Two fixed three-up rows, used only when a role's block list has every
 * member of the row — a role missing one of them (e.g. no `pipeline`) falls
 * through to the generic wide/narrow/analytics layout below instead of a
 * lopsided row. Overdue orders + the whole chain + volume both answer "what's
 * moving right now", so they share a row at equal thirds; quality-over-time
 * and product-mix are given equal (40%) room since both are charts, with this
 * month's four numbers stacked in the remaining 20% rather than repeating the
 * full 4-up `ThisMonth` grid at an unreadable width.
 */
const ROW1: BlockKey[] = ["stuck", "pipeline", "volumeTrend"];
const ROW2: BlockKey[] = ["qualityTrend", "productMix", "thisMonth"];

export default function DashboardPage() {
  const { data: session } = useSession();
  const { lang, t } = useLang();
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<DashboardFilters>(EMPTY_FILTERS);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (filters.from) p.set("from", filters.from);
      if (filters.to) p.set("to", filters.to);
      if (filters.customerId) p.set("customerId", filters.customerId);
      if (filters.productId) p.set("productId", filters.productId);
      const qs = p.toString();
      const res = await fetch(`/api/dashboard${qs ? `?${qs}` : ""}`);
      setPayload(res.ok ? await res.json() : null);
    } catch {
      setPayload(null);
    }
    setLoading(false);
  }, [filters]);

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
  const hasRow1 = ROW1.every((k) => blocks.includes(k));
  const hasRow2 = ROW2.every((k) => blocks.includes(k));
  const consumed: BlockKey[] = [...(hasRow1 ? ROW1 : []), ...(hasRow2 ? ROW2 : [])];

  const wide = blocks.filter((b) => WIDE.includes(b) && !consumed.includes(b));
  const analytics = blocks.filter((b) => ANALYTICS.includes(b) && !consumed.includes(b));
  const narrow = blocks.filter((b) => !WIDE.includes(b) && !ANALYTICS.includes(b) && !consumed.includes(b));

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

      {/* Scopes every chart/widget below it. The "waiting on you" queues
          above (and the wide `stuck` fallback / narrow grid, when a role
          lacks the full row) intentionally do not read it — see the prop
          comment on DashboardFilterBar. */}
      {(hasRow1 || hasRow2) && <DashboardFilterBar value={filters} onChange={setFilters} />}

      {/* Fixed three-up: overdue orders, the whole chain, volume — equal
          thirds, all answering "what's moving right now". */}
      {hasRow1 && (
        <div className="grid gap-4 lg:grid-cols-3 items-stretch">
          <div>{render("stuck")}</div>
          <div>{render("pipeline")}</div>
          <div>{render("volumeTrend")}</div>
        </div>
      )}

      {/* Fixed three-up: quality and product-mix charts at 40% each, this
          month's numbers stacked in the remaining 20%. */}
      {hasRow2 && (
        <div className="grid gap-4 lg:grid-cols-5 items-stretch">
          <div className="lg:col-span-2">{render("qualityTrend")}</div>
          <div className="lg:col-span-2">{render("productMix")}</div>
          <div>
            <ThisMonthCompact data={(payload!.data as Record<string, never>).thisMonth} />
          </div>
        </div>
      )}

      {/* Alerts and month figures run the full width; the rest pair up. Stuck
          orders come first for the roles that get them — an alert below the fold
          is not an alert. */}
      {wide.filter((b) => b === "stuck").map((b) => <div key={b}>{render(b)}</div>)}

      {narrow.length > 0 && (
        // A lone card left over in an odd-sized set spans both columns rather
        // than sitting beside empty space — `:last-child:nth-child(odd)` is
        // true only when the total count is odd AND this is the final item.
        <div className="grid gap-4 lg:grid-cols-2 items-stretch lg:[&>*:last-child:nth-child(odd)]:col-span-2">
          {narrow.map((b) => <div key={b}>{render(b)}</div>)}
        </div>
      )}

      {analytics.includes("volumeTrend") && <div>{render("volumeTrend")}</div>}
      {(() => {
        const rest = analytics.filter((b) => b !== "volumeTrend");
        return rest.length > 0 ? (
          <div className="grid gap-4 lg:grid-cols-2 items-stretch lg:[&>*:last-child:nth-child(odd)]:col-span-2">
            {rest.map((b) => <div key={b}>{render(b)}</div>)}
          </div>
        ) : null;
      })()}

      {wide.filter((b) => b !== "stuck").map((b) => <div key={b}>{render(b)}</div>)}
    </div>
  );
}
