"use client";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { LayoutDashboard } from "lucide-react";
import { useLang } from "@/components/layout/AppShell";
import { ROLE_LABELS, type UserRole } from "@/types";
import type { BlockKey } from "@/lib/dashboardBlocks";
import {
  WaitingOnMe, MyOrders, ThisMonth, ThisMonthCompact,
  LabQueue, Quality, ReadyToWeigh, Coverage, StatsRow,
} from "@/components/dashboard/blocks";
import { QualityTrend, ProductMix, OrdersByCity, TonsByCity } from "@/components/dashboard/charts";
import { DashboardFilterBar, EMPTY_FILTERS, type DashboardFilters } from "@/components/dashboard/FilterBar";

interface Payload {
  role: string;
  blocks: BlockKey[];
  data: Record<string, unknown>;
  inChain: number;
}

/** Blocks that span the full width; the rest sit in a two-column grid. */
const WIDE: BlockKey[] = ["thisMonth", "coverage"];

/**
 * The year-long trend charts get their own zone, below the day-to-day
 * blocks, so the page reads top-to-bottom as "what needs me today" → "how is
 * the plant doing over time" rather than interleaving the two questions.
 */
const ANALYTICS: BlockKey[] = ["qualityTrend", "productMix", "ordersByCity", "tonsByCity"];

/**
 * `ROW1` = the orders-by-city bars beside this month's compact numbers.
 *
 * "Volume & rejection rate" used to hold this slot alone. It was removed
 * outright (2026-10-07, client request), not relocated: it was a dual-Y-axis
 * combo chart (tons on one scale, rejection % on an independently-chosen
 * second scale), which is the textbook chart mistake — the alignment between
 * two arbitrary scales invents a visual relationship that may not be in the
 * data. A later rebuild split it into two single-axis charts sharing one time
 * axis, which was honest but still answered a question the data itself does
 * not support: Pearson r between monthly tons and rejection rate came out to
 * 0.24 across a full year of orders — no meaningful linear relationship.
 * Neither chart form nor cohort-alignment was the actual problem; there
 * simply isn't a volume/rejection story to tell here. Per-stage and
 * per-reason "where do we lose orders" is a real, data-rich question — see
 * the Rejections report on the Reports page, not the dashboard.
 *
 * `ROW2` = quality trend, product mix and tonnage-by-city, three-up: the
 * plant-wide "how are we doing" charts on one line, in the order a reader
 * would ask them — are we in spec, what are we shipping, where does it go.
 */
const ROW1: BlockKey[] = ["ordersByCity", "thisMonth"];
const ROW2: BlockKey[] = ["qualityTrend", "productMix", "tonsByCity"];

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
      case "thisMonth":    return <ThisMonth data={d[key]} />;
      case "labQueue":     return <LabQueue data={d[key]} />;
      case "quality":      return <Quality data={d[key]} />;
      case "readyToWeigh": return <ReadyToWeigh data={d[key]} />;
      case "coverage":     return <Coverage data={d[key]} />;
      case "qualityTrend": return <QualityTrend data={d[key]} />;
      case "productMix":   return <ProductMix data={d[key]} />;
      case "ordersByCity": return <OrdersByCity data={d[key]} />;
      case "tonsByCity":   return <TonsByCity data={d[key]} />;
      // "volumeTrend" deliberately has no case — see the ROW1 comment above.
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

      {/* The quick-glance KPI strip, same idea as the CMMS dashboard's own
          top row — every number here already exists elsewhere on this same
          payload, this just surfaces it before anything else on the page. */}
      {payload && (
        <StatsRow
          inChain={payload.inChain}
          stuck={(payload.data as Record<string, never>).stuck}
          thisMonth={(payload.data as Record<string, never>).thisMonth}
        />
      )}

      {/* Scopes every chart/widget below it. The "waiting on you" queues
          above (and the narrow grid, when a role lacks the full row)
          intentionally do not read it — see the prop comment on
          DashboardFilterBar. */}
      {(hasRow1 || hasRow2) && <DashboardFilterBar value={filters} onChange={setFilters} />}

      {/* Orders by city, beside this month's compact numbers. The bars get
          three quarters of the row — sixteen city labels, rotated, need the
          width — and the stats column keeps the same compact shape it had in
          the old three-up row. */}
      {hasRow1 && (
        <div className="grid gap-4 lg:grid-cols-4 items-stretch">
          <div className="lg:col-span-3">{render("ordersByCity")}</div>
          <div>
            <ThisMonthCompact data={(payload!.data as Record<string, never>).thisMonth} />
          </div>
        </div>
      )}

      {/* Quality trend, product mix and tonnage-by-city, evenly split — all
          three are the same shape of question (a trend line, two donuts),
          so an even three-way split reads as one family of chart rather than
          favouring one of them. */}
      {hasRow2 && (
        <div className="grid gap-4 lg:grid-cols-3 items-stretch">
          <div>{render("qualityTrend")}</div>
          <div>{render("productMix")}</div>
          <div>{render("tonsByCity")}</div>
        </div>
      )}

      {narrow.length > 0 && (
        // A lone card left over in an odd-sized set spans both columns rather
        // than sitting beside empty space — `:last-child:nth-child(odd)` is
        // true only when the total count is odd AND this is the final item.
        <div className="grid gap-4 lg:grid-cols-2 items-stretch lg:[&>*:last-child:nth-child(odd)]:col-span-2">
          {narrow.map((b) => <div key={b}>{render(b)}</div>)}
        </div>
      )}

      {/* Whatever ROW1/ROW2 didn't consume for THIS role (e.g. a role that
          has tonsByCity but not qualityTrend/productMix) still gets its
          chart, just without the fixed layout a full row assumes. */}
      {analytics.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2 items-stretch lg:[&>*:last-child:nth-child(odd)]:col-span-2">
          {analytics.map((b) => <div key={b}>{render(b)}</div>)}
        </div>
      )}

      {wide.map((b) => <div key={b}>{render(b)}</div>)}
    </div>
  );
}
