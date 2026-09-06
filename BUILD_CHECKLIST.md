# LabGate — Build Checklist

**نظام المختبر وسلسلة الموافقات — قائمة البناء**

Every item is small enough to finish and verify on its own. Each carries a
**Test** line: what *you* do to confirm it works before we move on.

Spec: [`SPEC.md`](./SPEC.md) — section numbers below refer to it.

**Legend:** `[ ]` not started · `[~]` in progress · `[x]` done and verified by you · `[!]` blocked

---

## Phase 0 — Scaffold & foundations

- [x] **0.1 Project skeleton** — `package.json` with the exact CMMS stack (§2), `tsconfig`, `next.config.ts`, PostCSS, ESLint, `.gitignore`, `.env.example`, `npm install`
  **Test:** `npm run build` succeeds on an empty app
- [x] **0.2 Tailwind v4 + base layout** — `globals.css` (CSS-first, no config file), root layout, no external fonts, Cairo for Arabic
  **Test:** `npm run dev` → a styled page at `localhost:3001`
- [x] **0.3 MongoDB** — standalone `mongod` (§19.1, *not* a replica set), `mongoose.ts` connection helper
  **Test:** a scratch script writes and reads a document — no `not primary`
- [x] **0.4 User model** — 9 roles, `permissions[]`, absence fields, no pre-save hook (§7)
  **Test:** `npm run seed` creates the 9 accounts; check them in `mongosh`
- [x] **0.5 Auth** — split config, **distinct cookie name** (§1), login page as a Server Action
  **Test:** log in as `gm@gwmc.com`; then reload the CMMS on :3000 — **its session must survive**
- [x] **0.6 Route guard** — `proxy.ts` (not middleware), role-based landing
  **Test:** open `/orders` logged out → redirected to `/login`; each role lands on the right page
- [x] **0.7 API guards** — `requireSession` / `requireRole` / `requireModule` (§3)
  **Test:** `curl localhost:3001/api/orders` with no cookie → `401`
- [x] **0.8 App shell** — `AppShell` + `LangContext`, `Sidebar` (queue nav), `Header` (name + role + bell)
  **Test:** sidebar shows only what each role should see; the Arabic toggle mirrors the whole page

---

## Phase 1 — Move the lab module

- [x] **1.1 Lab models** — `LabParameter`, `LabProduct`, `LabCustomer` (+ sales fields), `LabParameterThreshold`, `LabSample` (+ `orderId`)
- [x] **1.2 Lab libraries** — `labQc`, `labThreshold`, `labScore`, `labSample`, `labNotify`, and `labUpload` **rewritten for `UPLOAD_DIR`** (§16)
- [x] **1.3 Lab types** — the 174 lines from `src/types/index.ts` (§5)
- [ ] **1.4 Lab API — the security rewrite** — every route guarded and validated; no mass assignment; escaped regex; `ObjectId.isValid` checks (§5)
  **Test:** `curl -X DELETE .../api/lab/samples/<id>` with no cookie → `401`, not a deletion
  *(runs `/security-review` on this step)*
- [x] **1.5 Seed the catalogue** — 8 flour grades, 11 parameters, per-product Ash thresholds
  **Test:** `npm run seed:lab`, then the products and parameters appear in `mongosh`
- [ ] **1.6 File serving** — `GET /api/files/[...path]` with the containment check (§16)
  **Test:** upload a file, load it, then confirm `../` in the path is rejected
- [ ] **1.7 Lab screens** — Results · Products & Specs · Customers · KPIs, with the charts retrofitted for RTL
  **Test:** record a sample; the verdict computes; switch to Arabic and the chart mirrors

---

## Phase 2 — Order model & workflow engine

- [ ] **2.1 `SalesOrder` model** — lines, steps, rejection, weighing, `referenceNo`, indexes (§7)
- [ ] **2.2 Order-number allocator** — `ORD-<year>-<6 digits>`, race-safe
- [ ] **2.3 `salesWorkflow.ts`** — `SALES_STAGES`, `MIN_STAGE_BY_ROLE`, `stageComplete`, `actableStages`, `canReject`
- [ ] **2.4 `visibilityFilter` + `andFilters`** (§8.1) — the confidentiality model
- [ ] **2.5 Test suite** — vitest, the 7 cases in §19.6
  **Test:** `npm test` → all green. This is the one place I can prove correctness rather than assert it.

---

## Phase 3 — Orders API

- [ ] **3.1 `GET /api/orders`** — filters, paging, visibility, the `permissions` block
- [ ] **3.2 `POST /api/orders`** — server-side weight computation, validation
- [ ] **3.3 `GET/PUT/DELETE /api/orders/[id]`** — visibility inside the `findOne`; edit locked after stage 2
  **Test:** a script logs in as each of the 9 roles and asserts the full visibility matrix

---

## Phase 4 — Delegation & absence

- [ ] **4.1 `Delegation` model** + API, with the overlap and expiry rules (§10.1c)
- [ ] **4.2 Absence** — `PUT /api/users/[id]/absence`, audited
- [ ] **4.3 `authorityFor`** — primary / delegate / deputy (§8.2)
  **Test:** mark the finance manager away → the accounts officer can see and approve stage 3; unmark → he loses it

---

## Phase 5 — Transitions

- [ ] **5.1 Approve** — atomic claim + advance (§8.3)
- [ ] **5.2 Reject** — terminal, downstream steps `skipped`
- [ ] **5.3 Weigh & post** — variance, `Posted`
- [ ] **5.4 Audit on every transition**
  **Test:** walk an order 1 → 8 by curl; reject another at stage 3 and confirm it vanishes downstream; fire two stage-7 approvals at once and confirm it advances exactly once

---

## Phase 6 — Customers module

- [ ] **6.1 Customers API** — dedupe on create, merge tool (§10.1b)
- [ ] **6.2 Customers list + profile screens**
- [ ] **6.3 Seed the confirmed customers** (§17 — the 8 confirmed names)
  **Test:** try to create a duplicate customer → refused with a clear message

---

## Phase 7 — Orders Overview screen

- [ ] **7.1 List + filters + `DataTable`**
- [ ] **7.2 `CurrentStageCell` and `WaitingOnCell`** — two-line cell, "You", both signatories, "on behalf of"
- [ ] **7.3 `StageJumpBar`** — GM-only chips with counts
- [ ] **7.4 Visibility banner + "How to read this view" panel**
- [ ] **7.5 `OrderDialog` + `LineItemsEditor`** — create/edit with live totals
  **Test:** create a real multi-line order as the coordinator; the sales manager sees it, finance does not

---

## Phase 8 — Order detail

- [ ] **8.1 `ApprovalTimeline`** — 8 stages, aging colours, stage-7 dual node, "on behalf of"
- [ ] **8.2 `ActionPanel`** — server-driven buttons, "Approve on behalf" wording
- [ ] **8.3 `RejectDialog` + `WeighDialog`**
- [ ] **8.4 History tab** — the audit trail for this order
  **Test:** click a full order 1 → 8 in the browser, **in Arabic and in English**

---

## Phase 9 — Notifications

- [ ] **9.1 `Notification` model + fan-out to the next role, with the zero-recipient rule** (§14.7)
- [ ] **9.2 SSE stream + `AppShell` subscriber + bell badge**
- [ ] **9.3 Notifications page**
  **Test:** approve at stage 2 in one browser; the finance manager's bell increments in another **without a refresh**

---

## Phase 10 — Dashboard, reports, charts

- [ ] **10.1 Dashboard blocks A–K, composed per role** (§10.0)
- [ ] **10.2 Stats API** — the 8 aggregations, p90 in JS (Mongo 6)
- [ ] **10.3 Charts** — validated palette, mirrored for Arabic (§11.1)
- [ ] **10.4 Excel export** — orders, pipeline, cycle time
  **Test:** every dashboard block renders for its roles; totals reconcile with the list counts

---

## Phase 11 — Platform screens

- [ ] **11.1 Users admin** — CRUD, reset password, absence, delegations
- [ ] **11.2 Audit trail page**
- [ ] **11.3 Health page**
- [ ] **11.4 Approvals / Sign-off / Rejections queue pages**
  **Test:** every sidebar item opens a working page

---

## Phase 12 — Production (§19)

- [ ] **12.1 `Dockerfile` + `docker-compose.yml`** — standalone output, mongo not published
- [ ] **12.2 TLS decision + cookie `secure` flag**
- [ ] **12.3 Backup script + cron + a rehearsed restore**
- [ ] **12.4 Production seed, passwords rotated**
- [ ] **12.5 Go-live checklist** — the 13 items in §19.8
  **Test:** every box in §19.8 ticked on the real server

---

## Open items carried from the spec

- [ ] The 11 uncertain customer names (§17) — needs your confirmation
- [ ] Sales coordinator: own orders or the whole department (default: own only)
- [ ] The 48-hour aging threshold (default: 48 h)

---

## Running notes

*(updated as we go — most recent first)*

- **2026-09-06** — **1.1 · 1.2 · 1.3 · 1.5 done.** The lab module is across.
  Models, the pure QC libs (`labQc`, `labThreshold`, `labScore`, `labSample`) and
  the 172 lines of lab types moved essentially verbatim — they had zero coupling
  to maintenance, exactly as the spec predicted. Three deliberate changes:
  · **`LabSample`** gains `orderId` + `orderNumber` + an index, with a comment
    stating loudly that `orderId` is nullable on purpose — routine shift QC has
    no order and must stay first-class.
  · **`LabCustomer`** gains the sales fields (`code`, `nameAr`, `phone`,
    `contactName`, `address`, `notes`) and a comment that it is the plant-wide
    customer table, not a lab lookup.
  · **`labUpload` rewritten, not copied** — files now live under `UPLOAD_DIR`
    outside the app tree and are served by a route handler, not statically from
    `public/`. Added `resolveUploadPath()` with a containment check that every
    read and delete goes through; the CMMS's delete built its path from the
    stored URL with no such check at all.
  `seed-lab` rewired to read `MONGODB_URI` (the CMMS copy hardcodes it, which on
  a new server silently seeds the wrong database). Catalogue verified in Mongo:
  8 grades · 11 parameters · 9 thresholds, with Ash correctly overridden per
  product (`Super` → range 0.50–0.52, `WFP` → n_m_t 0.65).
  `npm run check:scoring` proves the engine survived the move: in-spec → PASS,
  a value sitting exactly on the band edge → WARNING (the 15% rule), below the
  band → FAIL, and roll-up takes the worst reading.
  Next: 1.4 — the lab API security rewrite, then `/security-review` on it.
- **2026-09-06** — **0.7 + 0.8 done. PHASE 0 COMPLETE.**
  Guards: `requireSession` / `requireRole` / `requireModule`, plus `isUserAbsent`
  and `notAbsentFilter` kept in the same file so the absence *flag* rule and the
  absence *query* rule can never drift. Two routes prove the idiom: `/api/me`
  (any session) and `/api/health` (module-gated). Verified 401 without a cookie,
  403 for the GM on `/api/health` (no `health` permission), 200 on `/api/me`.
  Shell: `AppShell` (LangContext + `useChartDirection` ready for §11.1), the
  queue-based `Sidebar`, and a `Header` that shows the role under the name.
  **Verified visually in both languages** with a Chrome driver
  (`scripts/shot.mjs`, `scripts/navcheck.mjs` — `playwright-core` added as a
  devDependency; it drives the installed Chrome, no browser download). Arabic
  mirrors completely: sidebar to the right, header reversed, text right-aligned —
  from logical properties alone, no RTL-specific CSS.
  Per-role nav proven:
  · gm → Dashboard · Orders · Approvals · Sign-off · Customers · Reports · Rejections · Audit Trail
  · lab.tech → … · Lab · Rejections (no Customers, no Audit Trail)
  · weighbridge → the five free items only
  · admin → all eleven
  One trap for later: after editing `auth.ts`, the dev server can serve a stale
  server chunk — a login that "should" work fails with `CredentialsSignin` until
  it recompiles. Restart dev rather than debugging the code.
  Next: Phase 1 — move the lab module.
- **2026-09-06** — **0.5 + 0.6 done.** Auth split across the Edge-safe
  `auth.config.ts` (used by `proxy.ts`) and the Node `auth.ts`. Cookie isolation
  proven, not assumed: planted a fake `authjs.session-token` in the shared
  localhost jar, signed into LabGate, and the CMMS cookie survived while
  `labgate.session-token` (HttpOnly) was created beside it. `AUTH_SECRET` is
  freshly generated and differs from the CMMS's.
  Two things worth recording:
  · **Module augmentation instead of casts** — `session.user.role` is typed. The
    JWT augmentation must target `@auth/core/jwt`, not `next-auth/jwt`: the
    latter is only `export * from ...` and a re-export cannot be augmented.
  · **`authorize()` must use `.lean()`** — NextAuth structured-clones its return
    value, and a Mongoose document array is not cloneable. Returning
    `user.permissions` off a hydrated document fails at runtime with
    `DataCloneError: [object Array] could not be cloned`, surfacing as an
    unhelpful `error=Configuration` redirect.
  Verified: `/` and `/login` both land a signed-in user on `/dashboard`; `/lab`
  redirects the GM away (no `lab` permission); logged out, `/dashboard` → `/login`.
  Next: 0.7 API guards.
- **2026-09-06** — **0.3 + 0.4 done.** Found the root cause of the `not primary`
  failures: the CMMS's Mongo is three containers (`mongo1/2/3` on 27017/18/19)
  forming `rs0`, and the set advertises internal docker hostnames (`mongo-2`,
  `mongo-3`) the host cannot resolve — so `directConnection=true` pins the driver
  to whichever local node is currently a secondary. LabGate gets its own
  **standalone** container instead (`labgate-mongo`, host port **27020**, no
  `--replSet`): `npm run check:db` reports `writable true · standalone`, and the
  whole failure class is gone. Then `User` model (9 roles, absence fields, no
  pre-save hook, indexed on role+active+absent) and `npm run seed` → 9 accounts,
  passwords bcrypt cost 12, verified in `mongosh`. Next: 0.5 auth.
- **2026-09-06** — **0.1 + 0.2 done.** Stack installed and version-matched to the
  CMMS (next 16.2.6 · react 19.2.4 · mongoose 9.9.5 · next-auth 5.0.0-beta.32 ·
  tailwind 4.3.3). `npm run build` passes; dev server serves `/login` and `/`
  redirects to it. Two deliberate departures from the CMMS, both documented in
  the files: **no `next/font/google`** (it needs network at *build* time, and the
  plant server has none — system font stacks instead, Cairo for Arabic), and
  **`output: "standalone"`** from day one so the Dockerfile in §19.2 works without
  a later config change. `allowedDevOrigins` reads from an env var rather than
  hardcoded LAN IPs. Next: 0.3 MongoDB.
- **2026-09-06** — project created at `/Users/yunis/Projects/LabGate`, spec copied
  to `SPEC.md`, checklist written.
