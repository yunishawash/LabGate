import { oidList } from "@/lib/apiHelpers";
import LabSample from "@/models/LabSample";

/** `customerIds`/`productIds` — comma-separated multi-select filters shared by
 *  the Orders, Weight variance and Ordered-vs-weighed reports (and their
 *  matching exports). `productIds` matches at the ORDER level
 *  (`{"lines.productId": {$in}}`) — an order with at least one matching line
 *  qualifies; that is the same convention `weightTrendOrders`' drill-down
 *  already used for a single product id before this became multi-select. */
export function multiSelectFilters(searchParams: URLSearchParams) {
  const customerIds = oidList(searchParams.get("customerIds"));
  const productIds = oidList(searchParams.get("productIds"));
  return {
    customerIds,
    productIds,
    customerFilter: customerIds.length ? { customerId: { $in: customerIds } } : null,
    productFilter: productIds.length ? { "lines.productId": { $in: productIds } } : null,
  };
}

/**
 * Every product line's own lab result, batched across many orders in one
 * query rather than one-per-order. Mirrors the order detail page's own
 * `coverageByProduct` convention exactly: within one order, the LAST sample
 * attached for a given product (by the order's own `labSampleIds` array
 * order, not by sample date) is the one that counts — a technician can attach
 * a retest for the same product, and the newer one is what the line shows.
 */
export async function lineLabStatuses(
  orders: { _id: unknown; labSampleIds?: unknown[] }[]
): Promise<Map<string, Map<string, string>>> {
  const allSampleIds = Array.from(
    new Set(orders.flatMap((o) => (o.labSampleIds ?? []).map((id) => String(id))))
  );
  if (!allSampleIds.length) return new Map();

  const samples = (await LabSample.find({ _id: { $in: allSampleIds } })
    .select("_id productId overallStatus")
    .lean()) as { _id: unknown; productId: unknown; overallStatus: string }[];
  const byId = new Map(samples.map((s) => [String(s._id), s]));

  const byOrder = new Map<string, Map<string, string>>();
  for (const o of orders) {
    const byProduct = new Map<string, string>();
    for (const sid of o.labSampleIds ?? []) {
      const sample = byId.get(String(sid));
      if (sample) byProduct.set(String(sample.productId), sample.overallStatus);
    }
    byOrder.set(String(o._id), byProduct);
  }
  return byOrder;
}
