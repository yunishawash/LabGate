/**
 * "An order can have several product lines — the lab technician needs to
 * test each product separately, and stage 6 must not complete until every
 * one of them has a sample." Walks a real 2-line order end to end and
 * checks the API behaves exactly that way. Cleans up the order it creates.
 */
const BASE = "http://localhost:3001";
let failed = 0;
const ok = (l, got, want) => { const p = String(got)===String(want); if(!p) failed++; console.log(`${p?"  ok  ":"FAIL  "}${l.padEnd(64)} ${p?got:`got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`); };

async function login(email) {
  const r = await fetch(`${BASE}/api/auth/csrf`);
  const { csrfToken } = await r.json();
  const jar = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST", redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: jar },
    body: new URLSearchParams({ email, password: "pass123", csrfToken }),
  });
  const all = [...res.headers.getSetCookie(), ...r.headers.getSetCookie()].map((c) => c.split(";")[0]);
  return [...new Map(all.map((c) => [c.split("=")[0], c])).values()].join("; ");
}
const api = (c, path, opts = {}) => fetch(`${BASE}${path}`, {
  ...opts,
  headers: { Cookie: c, "Content-Type": "application/json", ...(opts.headers || {}) },
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

const coord = await login("sales.coord@gwmc.com");
const salesMgr = await login("sales.manager@gwmc.com");
const finance = await login("finance@gwmc.com");
const gm = await login("gm@gwmc.com");
const techMgr = await login("tech.manager@gwmc.com");
const labTech = await login("lab.tech@gwmc.com");
const admin = await login("admin@gwmc.com");

// Pick two distinct real products and a real customer.
const { body: prod } = await api(coord, "/api/lab/products?limit=5");
const { body: cust } = await api(coord, "/api/customers?limit=1");
const products = (prod.products || []).slice(0, 2);
if (products.length < 2) { console.log("Need at least 2 products seeded — aborting."); process.exit(1); }
const customerId = cust.customers?.[0]?._id;
if (!customerId) { console.log("Need at least 1 customer seeded — aborting."); process.exit(1); }

let id;
try {
  // ── create a 2-line order ─────────────────────────────────────────────
  const { status: createStatus, body: order } = await api(coord, "/api/orders", {
    method: "POST",
    body: JSON.stringify({
      customerId,
      orderDate: new Date().toISOString(),
      lines: [
        { productId: products[0]._id, bagWeightKg: 50, bagCount: 10 },
        { productId: products[1]._id, bagWeightKg: 50, bagCount: 5 },
      ],
    }),
  });
  ok("order created (201)", createStatus, 201);
  id = order._id;
  console.log(`       order ${order.orderNumber} — 2 lines`);

  // ── walk stages 2 → 5 with the primary of each ─────────────────────────
  const walkers = [salesMgr, finance, gm, techMgr];
  for (const w of walkers) {
    const { status } = await api(w, `/api/orders/${id}/approve`, { method: "POST", body: JSON.stringify({}) });
    ok(`approved through to stage 6 (step ${walkers.indexOf(w) + 2})`, status, 200);
  }

  const { body: atLab } = await api(labTech, `/api/orders/${id}`);
  ok("order sits at stage 6 once at the lab", atLab.currentStageIndex, 6);

  // ── attach a sample for PRODUCT 1 only ──────────────────────────────────
  const { body: specs1 } = await api(labTech, `/api/lab/products/${products[0]._id}/specs`);
  const spec1 = specs1.specs?.[0];
  const results1 = spec1 ? [{ parameterId: spec1.parameterId, value: spec1.target ?? spec1.min ?? spec1.max ?? 1 }] : [];
  const { body: sample1 } = await api(labTech, "/api/lab/samples", {
    method: "POST",
    body: JSON.stringify({ productId: products[0]._id, customerId, sampleDate: new Date().toISOString(), results: results1 }),
  });
  ok("sample #1 (product A) created", !!sample1?._id, true);

  const { status: attach1Status, body: attach1 } = await api(labTech, `/api/orders/${id}/lab`, {
    method: "POST",
    body: JSON.stringify({ sampleIds: [sample1._id] }),
  });
  ok("attach 1/2 products — request succeeds", attach1Status, 200);
  ok("attach 1/2 products — stage NOT complete yet", attach1.complete, false);
  ok("attach 1/2 products — order stays at stage 6 (no premature advance)", attach1.order?.currentStageIndex, 6);
  ok("attach 1/2 products — advancedTo is null", attach1.advancedTo, null);
  ok("attach 1/2 products — remaining product is product B", attach1.remainingProducts?.[0]?.productId, products[1]._id);

  // GM should NOT yet see this order waiting for their sign-off signature.
  const { body: gmMineMidway } = await api(gm, `/api/orders?mine=true&stage=7`);
  ok("mid-way: GM's stage-7 queue does not yet include this order", (gmMineMidway.orders || []).some(o => o._id === id), false);

  // Detail view should show ONE covered product's sample and no advance.
  const { body: midOrder } = await api(labTech, `/api/orders/${id}`);
  ok("detail: labSamples has exactly 1 entry so far", (midOrder.labSamples || []).length, 1);
  ok("detail: still Pending / stage 6", `${midOrder.status}/${midOrder.currentStageIndex}`, "Pending/6");
  ok("lab tech still has canEnterLab for this order", midOrder.permissions?.canEnterLab, true);

  // ── attach a sample for PRODUCT 2 — this should complete stage 6 ───────
  const { body: specs2 } = await api(labTech, `/api/lab/products/${products[1]._id}/specs`);
  const spec2 = specs2.specs?.[0];
  const results2 = spec2 ? [{ parameterId: spec2.parameterId, value: spec2.target ?? spec2.min ?? spec2.max ?? 1 }] : [];
  const { body: sample2 } = await api(labTech, "/api/lab/samples", {
    method: "POST",
    body: JSON.stringify({ productId: products[1]._id, customerId, sampleDate: new Date().toISOString(), results: results2 }),
  });
  ok("sample #2 (product B) created", !!sample2?._id, true);

  const { status: attach2Status, body: attach2 } = await api(labTech, `/api/orders/${id}/lab`, {
    method: "POST",
    body: JSON.stringify({ sampleIds: [sample2._id] }),
  });
  ok("attach 2/2 products — request succeeds", attach2Status, 200);
  ok("attach 2/2 products — stage now complete", attach2.complete, true);
  ok("attach 2/2 products — advanced to stage 7", attach2.advancedTo, 7);
  ok("attach 2/2 products — order now at stage 7", attach2.order?.currentStageIndex, 7);
  ok("attach 2/2 products — no remaining products", (attach2.remainingProducts || []).length, 0);

  const { body: finalOrder } = await api(labTech, `/api/orders/${id}`);
  ok("final: labSampleIds ACCUMULATED both samples (not overwritten)", (finalOrder.labSampleIds || []).length, 2);
  ok("final: labSamples populated with both", (finalOrder.labSamples || []).length, 2);
  const finalProductIds = new Set((finalOrder.labSamples || []).map(s => s.productId));
  ok("final: both distinct products covered", finalProductIds.has(products[0]._id) && finalProductIds.has(products[1]._id), true);

  // Now GM's stage-7 queue SHOULD include it.
  const { body: gmMineFinal } = await api(gm, `/api/orders?mine=true&stage=7`);
  ok("after full coverage: GM's stage-7 queue includes this order", (gmMineFinal.orders || []).some(o => o._id === id), true);

  // ── sign off both to make sure nothing downstream broke ────────────────
  const { status: gmSignStatus } = await api(gm, `/api/orders/${id}/approve`, { method: "POST", body: JSON.stringify({}) });
  ok("GM sign-off succeeds", gmSignStatus, 200);
  const { status: tmSignStatus, body: tmSign } = await api(techMgr, `/api/orders/${id}/approve`, { method: "POST", body: JSON.stringify({}) });
  ok("TM sign-off succeeds and advances to stage 8", tmSignStatus, 200);
  ok("both signed → order now at stage 8 (weighbridge)", tmSign.order?.currentStageIndex, 8);
} finally {
  // Leave no trace: soft-delete the order this script created, win or lose.
  if (id) await api(admin, `/api/orders/${id}`, { method: "DELETE" });
}

console.log(`\n${failed ? `${failed} FAILED` : "all passed"}`);
process.exit(failed ? 1 : 0);
