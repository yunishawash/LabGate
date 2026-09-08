"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { ClipboardList, Plus, Search, X, Inbox } from "lucide-react";
import { useLang } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatCard } from "@/components/ui/stat-card";
import { Combobox } from "@/components/ui/combobox";
import { DataTable, type Column } from "@/components/ui/data-table";
import { CurrentStageCell, WaitingOnCell, type OrderRow, type RoleHolders } from "@/components/orders/cells";
import { VisibilityBanner, HowToReadPanel, StageJumpBar } from "@/components/orders/panels";
import { OrderDialog } from "@/components/orders/OrderDialog";
import { formatDate, toDateInputValue } from "@/lib/utils";
import { ORDER_STATUS_LABELS, ORDER_STATUS_BADGE, type ILabCustomer } from "@/types";
import { canCreate } from "@/lib/salesWorkflow";

const SELECT_CLASS =
  "h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-700 " +
  "outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 cursor-pointer";

export default function OrdersPage() {
  const { lang, t } = useLang();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const role = session?.user?.role ?? "";
  const mayCreate = canCreate({ id: session?.user?.id ?? "", role });

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [roleHolders, setRoleHolders] = useState<RoleHolders>({});
  const [stageCounts, setStageCounts] = useState<Record<number, number>>({});
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [loading, setLoading] = useState(true);

  const [customers, setCustomers] = useState<ILabCustomer[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);

  // A `?stage=` in the URL (the dashboard's pipeline board links here) means
  // "show me what's live at this stage" — the same thing the stage bar's own
  // counts mean. Defaulting status to Pending when a stage arrives with no
  // status of its own keeps the number the link promised and the number the
  // table shows in agreement.
  const initialStage = searchParams.get("stage") ?? "all";
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(
    searchParams.get("status") ?? (initialStage !== "all" ? "Pending" : "all")
  );
  const [stage, setStage] = useState(initialStage);
  const [customerId, setCustomerId] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [mine, setMine] = useState(false);

  const hasFilters =
    !!search || status !== "all" || stage !== "all" || customerId !== "all" || !!from || !!to || mine;
  const clearFilters = () => {
    setSearch(""); setStatus("all"); setStage("all"); setCustomerId("all");
    setFrom(""); setTo(""); setMine(false); setPage(1);
  };

  useEffect(() => {
    // This is a PICKER, not the paginated Customers table — it needs the whole
    // register to search over, hence the explicit high limit.
    fetch("/api/customers?limit=1000").then((r) => r.json()).then((d) => setCustomers(d.customers || [])).catch(() => {});
  }, []);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (search) p.set("search", search);
    if (status !== "all") p.set("status", status);
    if (stage !== "all") p.set("stage", stage);
    if (customerId !== "all") p.set("customerId", customerId);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (mine) p.set("mine", "true");

    try {
      const res = await fetch(`/api/orders?${p}`);
      const d = await res.json();
      setOrders(d.orders || []);
      setRoleHolders(d.roleHolders || {});
      setTotal(d.total || 0);
    } catch {
      setOrders([]); setTotal(0);
    }
    setLoading(false);
  }, [page, limit, search, status, stage, customerId, from, to, mine]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  /**
   * The stat cards' own totals — deliberately NOT `orders.filter(...)`.
   *
   * That was the actual bug behind "it shows 429 but the numbers don't add
   * up": `orders` is one PAGE (≤25 rows), so `orders.filter(o => o.status ===
   * "Posted").length` was counting Posted rows on the current page, not
   * Posted orders in the whole system — with 338 posted and a page of 25, the
   * card could show single digits while the true total sat in the hundreds.
   * Same class of bug as the stage-chip mismatch fixed earlier, same fix:
   * a real server-side `total`, not a client-side filter over a slice.
   *
   * Scoped to the same base filters as "Shown" (search / customer / dates) so
   * the four cards stay four lenses on one filtered set — but NOT to `status`
   * or `stage`, which is what each card exists to answer independently of.
   */
  const [postedTotal, setPostedTotal] = useState(0);
  const [rejectedTotal, setRejectedTotal] = useState(0);
  const [waitingOnMeTotal, setWaitingOnMeTotal] = useState(0);

  const loadStatCounts = useCallback(async () => {
    const base = new URLSearchParams({ limit: "1" });
    if (search) base.set("search", search);
    if (customerId !== "all") base.set("customerId", customerId);
    if (from) base.set("from", from);
    if (to) base.set("to", to);

    const withStatus = (s: string) => { const p = new URLSearchParams(base); p.set("status", s); return p; };
    const mineParams = new URLSearchParams(base); mineParams.set("mine", "true");

    try {
      const [posted, rejected, mineRes] = await Promise.all([
        fetch(`/api/orders?${withStatus("Posted")}`).then((r) => r.json()),
        fetch(`/api/orders?${withStatus("Rejected")}`).then((r) => r.json()),
        fetch(`/api/orders?${mineParams}`).then((r) => r.json()),
      ]);
      setPostedTotal(posted.total ?? 0);
      setRejectedTotal(rejected.total ?? 0);
      setWaitingOnMeTotal(mineRes.total ?? 0);
    } catch {
      /* the cards simply show zeros */
    }
  }, [search, customerId, from, to]);

  useEffect(() => { loadStatCounts(); }, [loadStatCounts, orders.length]);

  /**
   * The jump bar's own counts — one real server-side `total` per stage
   * (`status=Pending&stage=N&limit=1`, 8 parallel requests), not a client-side
   * tally over a single `limit=200` fetch. The old version was correct only by
   * coincidence: today's pending count (22) is under 200, but a busier
   * pipeline crossing that line would silently undercount every chip with no
   * error anywhere to catch it — the exact failure mode this whole page's
   * other fix (the chip-vs-table mismatch) exists to prevent.
   */
  const loadStageCounts = useCallback(async () => {
    if (role !== "admin" && role !== "general_manager") return;
    try {
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) => i + 1).map((i) =>
          fetch(`/api/orders?status=Pending&stage=${i}&limit=1`).then((r) => r.json())
        )
      );
      const counts: Record<number, number> = {};
      results.forEach((d, i) => { counts[i + 1] = d.total ?? 0; });
      setStageCounts(counts);
    } catch {
      /* the bar simply shows zeros */
    }
  }, [role]);
  useEffect(() => { loadStageCounts(); }, [loadStageCounts, orders.length]);

  const columns: Column<OrderRow>[] = [
    {
      key: "orderNumber",
      label: t("Order", "الطلبية"),
      render: (o) => (
        <div className="min-w-0">
          <div className="font-medium text-sky-700 whitespace-nowrap">{o.orderNumber}</div>
          {/* The number the office wrote down, under the one we generated. */}
          {o.referenceNo && <bdi className="text-xs text-slate-400 font-mono block whitespace-nowrap">{o.referenceNo}</bdi>}
        </div>
      ),
    },
    {
      key: "customer",
      label: t("Customer", "الزبون"),
      render: (o) => (
        <span className="text-slate-700">{((lang === "ar" && o.customerAr) || o.customer) || "—"}</span>
      ),
    },
    {
      key: "orderDate",
      label: t("Date", "التاريخ"),
      render: (o) => <bdi className="text-slate-600 whitespace-nowrap">{formatDate(o.orderDate)}</bdi>,
    },
    {
      key: "totalBags",
      label: t("Bags", "الأكياس"),
      render: (o) => <bdi className="tabular-nums text-slate-700 whitespace-nowrap">{o.totalBags}</bdi>,
    },
    {
      key: "totalWeightKg",
      label: t("Ordered", "الكمية"),
      render: (o) => <bdi className="tabular-nums text-slate-700 whitespace-nowrap">{(o.totalWeightKg / 1000).toFixed(3)} {t("t", "طن")}</bdi>,
    },
    {
      key: "status",
      label: t("Status", "الحالة"),
      render: (o) => (
        <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${ORDER_STATUS_BADGE[o.status]}`}>
          {ORDER_STATUS_LABELS[o.status][lang]}
        </span>
      ),
    },
    { key: "currentStage", label: t("Current stage", "المرحلة الحالية"), render: (o) => <CurrentStageCell order={o} /> },
    {
      key: "waitingOn",
      label: t("Waiting for", "منتظر من"),
      render: (o) => <WaitingOnCell order={o} roleHolders={roleHolders} />,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight flex items-center gap-2">
            <ClipboardList size={22} className="text-slate-500" />
            {t("Orders Overview", "الطلبيات")}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {t(
              "Every order, where it stands, and who it is waiting for.",
              "كل طلبية، وأين وصلت، ومن ينتظرها."
            )}
          </p>
        </div>
        {mayCreate && (
          <Button className="gap-2" onClick={() => setDialogOpen(true)}>
            <Plus size={16} />
            {t("New order", "طلبية جديدة")}
          </Button>
        )}
      </div>

      <VisibilityBanner />

      <StageJumpBar
        counts={stageCounts}
        grandTotal={total}
        active={stage}
        onPick={(s) => {
          setStage(s);
          setPage(1);
          /**
           * The chip's own count comes from a Pending-only fetch (see
           * `loadStageCounts` below) — it is a count of the live pipeline, not
           * of "everything that ever sat at this stage". A rejected order stays
           * frozen at the stage it died on, so filtering by stage alone with
           * status left on "all" pulled those in too: the chip said 5, the
           * table said 7. Forcing status to match what the chip promised is
           * what keeps the two numbers telling the same story.
           */
          setStatus(s === "all" ? "all" : "Pending");
        }}
      />

      <div className="space-y-3">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <button onClick={() => { setMine(!mine); setPage(1); }} className="text-start cursor-pointer">
              <StatCard
                title={t("Waiting on me", "في انتظاري")}
                value={waitingOnMeTotal}
                icon={<Inbox size={18} />}
                color={mine || waitingOnMeTotal > 0 ? "blue" : "default"}
              />
            </button>
            <StatCard title={t("Shown", "المعروضة")} value={total} color="default" />
            <StatCard title={t("Posted", "مرحّلة")} value={postedTotal} color="green" />
            <StatCard title={t("Rejected", "مرفوضة")} value={rejectedTotal} color="red" />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search size={15} className="absolute start-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <Input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder={t("Order, reference or customer", "رقم الطلبية أو المرجع أو الزبون")}
                className="h-9 w-64 ps-8"
              />
            </div>
            <Combobox
              triggerClassName={SELECT_CLASS + " w-44"}
              value={status}
              onChange={(v) => { setStatus(v); setPage(1); }}
              options={[
                { value: "all", label: t("All statuses", "كل الحالات") },
                { value: "Pending", label: ORDER_STATUS_LABELS.Pending[lang] },
                { value: "Posted", label: ORDER_STATUS_LABELS.Posted[lang] },
                { value: "Rejected", label: ORDER_STATUS_LABELS.Rejected[lang] },
              ]}
            />
            <Combobox
              triggerClassName={SELECT_CLASS + " w-48"}
              value={customerId}
              onChange={(v) => { setCustomerId(v); setPage(1); }}
              placeholder={t("All customers", "كل الزبائن")}
              searchPlaceholder={t("Search customers…", "ابحث عن زبون…")}
              options={[
                { value: "all", label: t("All customers", "كل الزبائن") },
                ...customers.map((c) => ({ value: c._id, label: (lang === "ar" && c.nameAr) || c.name })),
              ]}
            />
            <Input type="date" value={from} max={to || undefined}
              onChange={(e) => { setFrom(e.target.value); setPage(1); }} className="h-9 w-40" />
            <Input type="date" value={to} min={from || undefined} max={toDateInputValue(new Date())}
              onChange={(e) => { setTo(e.target.value); setPage(1); }} className="h-9 w-40" />
            {hasFilters && (
              <button onClick={clearFilters} className="h-9 px-3 rounded-lg text-sm text-slate-500 hover:text-slate-900 hover:bg-slate-100 cursor-pointer flex items-center gap-1.5">
                <X size={14} />
                {t("Clear", "مسح")}
              </button>
            )}
          </div>

          <DataTable<OrderRow>
            columns={columns}
            data={orders}
            total={total}
            page={page}
            limit={limit}
            onPageChange={setPage}
            onLimitChange={(l) => { setLimit(l); setPage(1); }}
            loading={loading}
            onRowClick={(o) => router.push(`/orders/${o._id}`)}
            emptyMessage={
              mine
                ? t("Nothing is waiting on you right now.", "لا يوجد شيء في انتظارك حالياً.")
                : hasFilters
                  ? t("No orders match these filters.", "لا توجد طلبيات مطابقة.")
                  : t("No orders yet.", "لا توجد طلبيات بعد.")
            }
          />
      </div>

      <HowToReadPanel />

      <OrderDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSaved={() => { fetchOrders(); loadStageCounts(); }}
        customers={customers}
      />
    </div>
  );
}
