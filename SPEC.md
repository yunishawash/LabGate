# GWMC Lab System — Build Specification

**نظام المختبر — مواصفات البناء**

A standalone Next.js application for Golden Wheat Mills that runs the sample
release workflow: a sales order is created, walks an eight-stage approval chain
through management, reaches the lab, is signed off by two managers, is weighed,
and is posted.

This document is self-contained. Hand it to a fresh session with *"build this"*
and everything needed is here: the domain rules, the data model, the workflow
engine, the API surface, the UI conventions, and the exact coding style
inherited from the existing CMMS.

---

## 0. Relationship to the existing CMMS

| | GWMC CMMS (existing) | GWMC Lab System (this project) |
|---|---|---|
| Purpose | Plant maintenance — equipment, PM tasks, corrective work, reports | Commercial + quality — order approval chain, QC samples, weighbridge |
| Repo | `~/Projects/gwmc` | new, separate |
| Database | `gwmc` | `gwmc_lab` — **separate database** |
| Users | its own `users` collection | **its own `users` collection** |
| Port | 3000 | **3001** |
| Domain | same host today; see §16 for a move to its own domain and server | |
| Login page | its own | **its own, separate** |
| Dashboard | its own | **its own, separate** |

**The two apps share no data and no session.** They share a *design language*
and a *codebase style*, which is what §3–§5 exist to transfer.

### The Lab module moves here

The CMMS currently contains a Lab/QC module at `/lab`. It **moves into this
project** and is **removed from the CMMS**. This is not optional: stage 6 of the
chain writes a `LabSample`, and with separate databases a cross-app write is
impossible.

This move is nearly free right now — the CMMS's `/lab` page has been gated to
`admin@gwmc.com` for UI/UX review and has **no real users yet**. Every month of
delay makes it more expensive.

It is also a clean cut: the lab models have **zero references** to `PmTask`,
`Equipment`, `CorrectiveTask`, or `MaintenanceReport`. The only thing the lab
shared with maintenance was the `User` model and the app shell.

### Where the code is today, and how it gets out

All of the lab work lives on the **`lab` branch of the `gwmc` repo** — two
commits (`9baaa69 Adding lab work`, `aeec779 ony super admin`), 52 files,
~4,350 insertions. `main` has none of it.

The move is therefore a **branch-to-repo extraction, not a merge**:

1. Create the new repo. Copy in the files listed in §5 from the `lab` branch —
   this is a file copy, not a `git merge`; the histories stay separate.
2. Build the new app around them (§13).
3. **Do not merge `lab` into `main`.** Once the new system runs, that branch is
   dead: delete it locally and on the remote, and apply the CMMS cleanup below to
   `main` so no half of the lab module is left behind in the maintenance app.

Until step 3, `lab` stays as the single source of truth for the lab code — do not
start editing it in two places.

### CMMS-side cleanup (do this in the `gwmc` repo, not here)

Work from an earlier session left the CMMS in a half-way state on the assumption
the Lab System would live *inside* it. Undo the parts that now belong here:

| File | Action |
|---|---|
| `src/components/layout/Sidebar.tsx` | Remove the `/lab` nav item entirely. **Keep** the `if (role === "admin") return true;` admin bypass — that is a genuine bug fix, unrelated to this split. |
| `src/types/index.ts` | Remove the 8 chain roles from `UserRole`, plus `USER_ROLES` / `ROLE_LABELS` if unused elsewhere |
| `src/models/User.ts` | Remove the 8 chain roles from the enum and the `isAbsent` / `absentFrom` / `absentTo` / `absenceNote` fields |
| `src/lib/modules.ts` | Remove `CHAIN_ROLES`, `MAINTENANCE_MODULES`, `isChainRole`, `landingPathFor`, and the "PENDING" comment block; restore `lab` label or drop the key with the nav item |
| `src/lib/auth.config.ts` | Revert the landing-page change back to `/tasks` |
| `src/app/login/page.tsx` | Revert `redirectTo` to `/tasks` |
| `src/components/layout/FAB.tsx` | Remove the `isChainRole` gate |
| `src/app/(dashboard)/workers/page.tsx` | Revert `ROLES` to the original six + remove the chain-role warning |
| `src/lib/requireSession.ts` | **Keep** — it is a strict improvement over `requireAdmin` (it checks `isActive`). Optionally migrate existing routes onto it. |
| `src/scripts/seed-sales.ts` | Delete — it belongs here |
| `src/scripts/migrate-module-permissions.ts` | Delete — it existed only for the single-app plan |
| `package.json` | Remove the `seed:sales` and `migrate:module-permissions` scripts |
| Lab files | Move to this project, then delete (full list in §5) |

---

## 1. Deployment shape

Two Next.js processes on one host:

```
localhost:3000  →  CMMS          (database: gwmc)
localhost:3001  →  Lab System    (database: gwmc_lab)
```

Optionally put both behind one reverse proxy or a Next.js multi-zone rewrite so
users see one address. **Next 16 has first-party multi-zone support** and one app
can do the routing itself — no nginx required. See
`node_modules/next/dist/docs/01-app/02-guides/multi-zones.md`. If you go that
route the Lab System needs `assetPrefix: "/lab-static"` and, because its login is
a Server Action, `experimental.serverActions.allowedOrigins`.

### ⚠️ The cookie trap — read this before writing any auth code

**Cookies ignore port numbers.** `localhost:3000` and `localhost:3001` share one
cookie jar. Both apps use NextAuth, and NextAuth's default session cookie is
named `authjs.session-token` in both. Without intervention, **logging into one
app silently destroys the other app's session**, and the symptom looks like
random logouts that nobody can reproduce.

Fix it in this project's auth config — verified against
`node_modules/@auth/core/index.d.ts:458` (`cookies?: Partial<CookiesOptions>`):

```ts
export const authConfig: NextAuthConfig = {
  trustHost: true,
  session: { strategy: "jwt" },
  cookies: {
    sessionToken: {
      name: "gwmc-lab.session-token",
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: false },
    },
    callbackUrl: { name: "gwmc-lab.callback-url" },
    csrfToken:   { name: "gwmc-lab.csrf-token" },
  },
  // ...
};
```

Use a **different `AUTH_SECRET`** from the CMMS as well, so a token from one app
can never be validated by the other.

### `.env.local`

```
MONGODB_URI=mongodb://localhost:27017/gwmc_lab?directConnection=true&maxPoolSize=20&w=majority
AUTH_SECRET=<generate a NEW one, different from the CMMS>
AUTH_URL=http://localhost:3001
PORT=3001
```

`package.json` scripts should pin the port: `"dev": "next dev -p 3001"`,
`"start": "next start -p 3001"`.

### ⚠️ MongoDB environment gotcha (hit on 2026-09-01)

The Mongo on `:27017` is a **Docker replica set `rs0`**. It has failed over
before: the node published on `localhost:27017` became a SECONDARY while the
primary was `mongo-2:27017`, a name the host cannot resolve. Because the URI uses
`directConnection=true`, the driver pins to that one node — **reads succeed and
every write fails** with `MongoServerError: not primary (10107)`. Migration and
seed scripts print correct-looking output and then throw at the end.

Check before blaming your code:

```bash
lsof -nP -iTCP:27017 -sTCP:LISTEN
mongosh --quiet --eval 'const h=db.hello(); print(h.isWritablePrimary, h.secondary, h.primary, h.me)'
```

---

## 2. Stack — match these versions

Copy `package.json` dependencies from the CMMS. Exact versions in use:

```
next 16.2.6 · react 19.2.4 · react-dom 19.2.4 · typescript ^5
mongoose ^9.6.1 · next-auth ^5.0.0-beta.31 · bcryptjs ^3.0.3
tailwindcss ^4 · @tailwindcss/postcss ^4          (CSS-first — NO tailwind.config)
@radix-ui/* (dialog, select, tabs, tooltip, popover, label, separator,
             scroll-area, dropdown-menu, avatar, progress, slot)
lucide-react ^1.14.0 · class-variance-authority ^0.7.1 · clsx ^2.1.1
tailwind-merge ^3.5.0 · cmdk ^1.1.1 · recharts ^3.8.1 · xlsx ^0.18.5
date-fns ^4.1.0 · tsx ^4.21.0 (dev, for scripts)
```

**Do not install** `react-hook-form`, `zod`, `sonner`, `next-intl`, `zustand`, or
`@tanstack/react-query`. They are all present in the CMMS and **all unused** —
inheriting them would inherit the confusion.

---

## 3. Framework conventions — this is NOT the Next.js you know

Next 16 has breaking changes from most training data. Read the relevant guide in
`node_modules/next/dist/docs/` before writing code in an unfamiliar area.

1. **`proxy`, not `middleware`.** Next 16 renamed it. The file is `src/proxy.ts`
   and must export a named `proxy` function. There is no `middleware.ts`.

2. **`proxy.ts`'s matcher excludes `/api`.** Copy it verbatim:
   ```ts
   export const config = {
     matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
   };
   ```
   Consequence: **there is no ambient protection on any API route.** Every single
   route handler must guard itself. This is the most common way to build a
   perfectly-secured UI over a wide-open API.

3. **Split the NextAuth config in two.** `src/lib/auth.config.ts` is Edge-safe
   (`providers: []`, no DB imports) and is what `proxy.ts` instantiates.
   `src/lib/auth.ts` is the full Node.js config with the Credentials provider and
   is what API routes and Server Actions import. Note the consequence: the
   Edge/proxy path uses the *non*-DB-refreshing `jwt` callback.

4. **Login is a Server Action** (`"use server"` in the login page), never
   `signIn()` from `next-auth/react` on the client — that fails offline and
   cross-origin. The plant server runs offline.

5. **No external font requests.** No Google Fonts `<link>` in `layout.tsx`. The
   server has no internet. Use system font stacks; Arabic uses Cairo if locally
   available.

6. **`params` is a Promise** in route handlers: `const { id } = await params;`

---

## 4. Coding conventions inherited from the CMMS

Follow these exactly. They are not preferences — matching them is what makes the
two products feel like one.

### Database

- One connection helper, cached on `global` to survive HMR, with the retry
  behaviour that matters: **clear the cached promise on failure** so a failed
  first connect (Mongo not up yet) doesn't replay the same rejection forever.
  Copy `src/lib/mongoose.ts` verbatim.
- Every route handler starts with `await connectDB();`.
- **Soft delete everywhere:** `isActive: Boolean` on every model; delete
  endpoints set `isActive: false`. Every query filters `{ isActive: true }`.
- **`{ timestamps: true }`** on every schema.
- **Model export guard:** `export default mongoose.models.X || mongoose.model<IXDoc>("X", XSchema);`
  Do **not** copy the CMMS's `CorrectiveTask.ts` `deleteModel` HMR hack.
- **Denormalize display names next to the ObjectId ref** (`productId` +
  `product`, `customerId` + `customer`, `actedById` + `actedByName`). Lists render
  without `populate`.
- **Snapshot values that must stay historically true.** `LabSample.results[]`
  freezes `min`/`max`/`target`/`operator` at write time so editing a threshold
  later never rewrites history. This is the deliberate exception to the
  denormalization-is-a-cache rule, and the reason is written in the file.
- **Race-safe sequence numbers.** Never `countDocuments() + 1` — two concurrent
  requests collide on the unique index. Find the highest existing number for the
  year, then retry on `E11000`. Copy the loop from `src/lib/labSample.ts`
  (`createLabSample`, `maxRetries = 10`).

### Auth & passwords

- **No pre-save hook on `User`.** Passwords are hashed manually with
  `bcryptjs` cost 12 in *every* caller. The hook was removed to stop
  double-hashing. Put a comment saying so in the model.
- **Never call `user.save()` after changing the password field** — use
  `findByIdAndUpdate`.
- Session strategy JWT. `session.user` carries `id`, `name`, `email`, `role`,
  `permissions`. There is no next-auth module augmentation, so every read is a
  cast:
  ```ts
  const role = (session?.user as { role?: string } | undefined)?.role ?? "";
  ```
  *(Adding proper module augmentation in this project is an improvement worth
  making — just be consistent.)*
- The `jwt` callback in `auth.ts` **re-reads role and permissions from the DB on
  every token refresh**, so permission changes take effect without re-login.

### API route guards

Return-shaped guards that drop into `if (check.error) return check.error;`.
Copy `src/lib/requireSession.ts` from the CMMS — it provides `requireSession()`
(any authenticated **active** user), `requireRole(...roles)` (admin always
passes), `requireModule(module)` (mirrors the proxy rule so an API can never be
looser than its page), plus `isUserAbsent()` and `notAbsentFilter()`.

```ts
export async function POST(req: NextRequest) {
  await connectDB();
  const check = await requireRole("sales_coordinator");
  if (check.error) return check.error;
  const { userDoc } = check;
  // ...
}
```

**Never trust the client for identity or authority.** Resolve the actor from the
session, re-check permission on every mutation, and compute derived values
(weights, totals, statuses) server-side.

### List endpoints

Consistent query-param vocabulary: comma-separated multi-values become `$in`;
`search` is a case-insensitive regex (**escape it** — the CMMS has one route that
forgot and throws on a `(` in the search box); `from`/`to` date ranges are
**end-of-day inclusive** (`setHours(23,59,59,999)`); `page`/`limit`/`sortField`/
`sortOrder`. Response shape: `{ items, total, page, limit }`.

### UI

- **shadcn/ui on Radix**, `components.json` with `style: "default"`,
  `baseColor: "slate"`, `cssVariables: true`, aliases `@/components/ui` and
  `@/lib/utils`.
- **Tailwind v4, CSS-first.** `@import "tailwindcss"` + `@theme inline` in
  `globals.css`. **There is no `tailwind.config`.**
- **`cn()`** from `src/lib/utils.ts` = `twMerge(clsx(...))`.
- **Forms are plain `useState` objects.** No react-hook-form, no zod. Every field
  is `setForm((f) => ({ ...f, x: e.target.value }))`.
- **No toasts.** Success = close the dialog and refetch silently. Failure = an
  inline red box:
  ```tsx
  {saveError && (
    <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{saveError}</p>
  )}
  ```
- **Submit buttons** are `disabled={saving || !requiredField}` with the label
  swapping to `{t("Saving...", "جارٍ الحفظ...")}`.
- **Filters live in component state**, not the URL. Sentinel string `"all"` means
  no filter. Every filter's `onChange` also calls `setPage(1)`.
- **Fetching** is a `useCallback` building `URLSearchParams`, re-run by
  `useEffect(() => { fetchX(); }, [fetchX])` whose dep array is the filter list.
  No react-query.
- **There is no DatePicker.** Use `<Input type="date">` with `toDateInputValue()`
  from `src/lib/utils.ts` — it formats in local time and avoids the UTC
  off-by-one-day bug.
- **Three render states** on every list: spinner (`animate-spin` ring) / empty
  state (icon + message + CTA) / rows.
- **Card chrome:** `bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden`.
- **Dialogs:** `<DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">`.
- **Radix Dialog gotcha:** never render two `<Dialog>`s and toggle one closed
  while opening the other in the same tick — the second closes immediately
  (focus-trap/pointer-capture race). Use one `<Dialog open={view !== "closed"}>`
  with a `view` state and switch the `DialogContent`. See the CMMS's `FAB.tsx`.

### Bilingual + RTL

- **No i18n library.** A hand-rolled context in `AppShell.tsx`:
  ```tsx
  export const LangContext = createContext<LangCtx>({ lang: "en", t: (en) => en });
  export function useLang() { return useContext(LangContext); }
  const t = (en: string, ar: string) => (lang === "ar" ? ar : en);
  ```
  Persisted to `localStorage` under a key of this app's own (e.g. `lab-lang` —
  do **not** reuse `cmms-lang`, same origin).
- **Call sites carry both literals inline:** `t("Orders", "الطلبيات")`. No keys,
  no catalogs.
- **Enum labels** are `Record<K, { en: string; ar: string }>` maps in
  `src/types/index.ts`.
- **Models carry parallel `*Ar` columns** (`nameAr`, `titleAr`, `messageAr`)
  because API routes have no locale — the server writes both, the client picks.
- **RTL is real.** `document.documentElement.dir` flips. **Use logical Tailwind
  properties only** — `ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`, `-end-1`.
  Never `ml-`, `mr-`, `left-`, `right-`. A grep for those in new components must
  come back clean.
- Don't use directional icons (`ArrowRight`) unmirrored.

### Colour language

`sky` = active/current · `green` = done/pass · `amber` = warning/due-soon ·
`red` = overdue/rejected/fail · `slate` = inactive/neutral · `purple` = admin.
Status pills are a `Record<K, string>` of Tailwind classes plus a label map — see
`status-badge.tsx`, `decision-badge.tsx`, `qc-status-badge.tsx`.

### Real-time notifications (SSE)

- `src/lib/sseClients.ts` keeps `Map<userId, Set<pushFn>>` on `global` (survives
  HMR). `registerClient(userId, push)` from the stream route; `pushToUser(userId)`
  sends a **content-free ping** (`event: notification\ndata: 1`).
- `/api/notifications/stream` is `export const dynamic = "force-dynamic"`, builds
  a `ReadableStream`, and holds it open with an awaited 25s heartbeat loop inside
  `start()` — the await is what stops the runtime closing the stream.
  Headers: `text/event-stream`, `no-cache, no-transform`, `keep-alive`,
  `X-Accel-Buffering: no`.
- `AppShell` is the single subscriber: one `EventSource`, and on every
  `notification` event it refetches the unread count. Prop-drill `unreadCount`
  into `Sidebar` and `Header`.
- **Single-process only.** No Redis pub/sub — this breaks under multi-instance
  deploys. Fine for one plant server; know the limit.

### Audit log

One generic model, not per-entity: `entityType`, `entityId`, `action`, `field`,
`oldValue`, `newValue` (both **strings** — `String(...)`-coerce), `performedBy`,
`performedByName`, `timestamp`, `notes`. A `writeAudit()` helper does the
`ObjectId` cast and defaults the actor to `"system"`. Copy
`src/models/AuditLog.ts` and `src/lib/audit.ts`.

### Excel export

`src/lib/excel.ts` exports `buildWorkbook(sheets: ExcelSheetDef[])`,
`workbookToBuffer(wb)`, `downloadBuffer(buffer, filename)`, and an `XL_COLORS`
palette. A column marked `statusCell: true` is auto-coloured by its value — the
internal `statusFill()` already knows `pass`/`fail`/`warning`/`accepted`/
`rejected`/`completed`. One `POST /api/export` route switches on
`{ type, filters }`. **Guard it** — the CMMS's version has no auth at all.

---

## 5. What to copy from the CMMS

Copy these files essentially verbatim; adjust imports only.

**Infrastructure**
```
src/lib/mongoose.ts          src/lib/utils.ts           src/lib/excel.ts
src/lib/audit.ts             src/lib/sseClients.ts      src/lib/requireSession.ts
src/models/AuditLog.ts       src/models/Notification.ts
src/app/api/notifications/stream/route.ts
src/proxy.ts                 src/lib/auth.config.ts     src/lib/auth.ts
src/app/api/auth/[...nextauth]/route.ts
```

**Shell** — `src/components/layout/`: `AppShell.tsx`, `AuthProvider.tsx`,
`Sidebar.tsx`, `Header.tsx`. Strip the maintenance nav items; do **not** copy
`FAB.tsx` (it reports equipment faults). **Keep the admin bypass fix** in
`Sidebar.visibleNav`:
```ts
if (role === "admin") return true;   // must match auth.config.ts::authorized
```

**UI primitives** — the whole of `src/components/ui/` except
`idle-sparkline.tsx`, `check-type-badge.tsx`, `status-badge.tsx` (maintenance
statuses), `form.tsx` (react-hook-form, unused): keep `button`, `input`, `label`,
`textarea`, `select`, `dialog`, `table`, `data-table`, `tabs`, `badge`, `card`,
`tooltip`, `popover`, `command`, `multi-select`, `scroll-area`, `separator`,
`sheet`, `dropdown-menu`, `avatar`, `progress`, `stat-card`, `decision-badge`,
`qc-status-badge`, `lab-trend-chart`, `lab-kpi-charts`.

**Types — do not overlook this one.** `src/types/index.ts` carries **174 lines**
of lab types on the `lab` branch and it is easy to miss because the file also
holds maintenance types. Take: `LabOperator` + `LAB_OPERATOR_LABELS`, `LabStatus`
+ `LAB_STATUS_LABELS`, `LabShift` + `LAB_SHIFT_LABELS`, `QcRating` +
`QC_RATING_LABELS`, `LabDecision` + `LAB_DECISION_LABELS`, `ILabStatRow`,
`ILabParameter`, `ILabProduct`, `ILabParameterThreshold`, `ILabProductSpec`,
`ILabCustomer`, `ILabSampleResult`, `ILabAttachment`, `ILabSample`. Leave every
`IPmTask` / `IEquipment` / `ICorrectiveTask` behind.

**The Excel export branch.** `src/app/api/export/route.ts` gained **122 lines**
for `type: "lab"`: a two-sheet workbook — *Lab Results* (one row per sample,
pivoted to one column per active parameter, `LAB_COLUMNS`) and *Detail* (one row
per reading with min/max/target/deviation, `DETAIL_COLUMNS`). Move both column
definitions and the branch. `src/lib/excel.ts` also gained the
`pass`/`fail`/`warning`/`accepted`/`rejected` cases in `statusFill()` — they come
with the file.

**Source documents — move `attachments/` too.** These are not code and are easy
to leave behind, but two of them are the reason the code looks the way it does:

| File | Why it matters |
|---|---|
| `attachments/lab_rules.xlsx` (155 KB) | The QA department's workbook. The 15 % warning-band rule in `labQc.ts` was derived from it and verified to reproduce its Status column exactly. Anyone changing the scoring rules needs this to re-verify. |
| `attachments/سستم امختبر .pdf` (401 KB) | The client's own lab-system document — the N.M.T / N.L.T specification limits come from here. |
| `attachments/Lab Machines.xlsx` (12 KB) | The lab instrument list. **Deferred work, never built** — see below. |

Also carry over `.gitignore`'s `public/uploads` rule so QC attachments are never
committed, and the `seed:lab` script entry in `package.json`.

**Known deferred item — lab instruments.** `Lab Machines.xlsx` was supplied with
the original lab work and a `LabMachine` register was never built: there is no
model, no seed, and no link from a sample to the instrument it was measured on.
It is out of scope for the phases in §13, but it is the obvious next request
(*"which device produced this reading?"*), so leave `LabSample` room for a
future `instrumentId` rather than designing it out.

**The Lab module — move, don't rewrite**
```
src/models/     LabSample.ts  LabProduct.ts  LabCustomer.ts
                LabParameter.ts  LabParameterThreshold.ts
src/lib/        labQc.ts  labThreshold.ts  labScore.ts  labSample.ts
                labNotify.ts  labUpload.ts
src/app/api/lab/  customers/  parameters/  products/  samples/  stats/  thresholds/
src/components/lab/  SampleDialog.tsx  ProductSpecsTab.tsx
                     CustomersTab.tsx  KpiPanel.tsx
src/app/(dashboard)/lab/page.tsx        → becomes the QC tabs of this app
src/scripts/seed-lab.ts                 → fix it to read MONGODB_URI (it hardcodes)
```

**Fix while moving — the lab routes are the worst-secured code in the CMMS.**
Of 20 handlers only 4 check the session and **none** check a permission. `DELETE
/api/lab/samples/[id]`, the attachment delete, and every catalog mutation
(products, parameters, customers, thresholds) are fully unauthenticated, and
several pass the raw request body into `create()` / `$set` (mass assignment).
Combined with the proxy excluding `/api`, they are reachable with no session at
all. **Guard and validate every one during the move.** Also: `GET
/api/lab/samples` uses an unescaped regex for `search`, and `/api/lab/stats`
casts `product`/`customer` to `ObjectId` with no `isValid` check (500 on bad
input).

---

## 6. Domain — the eight-stage chain

| # | Stage | Primary role | Deputy (only while primary is absent) | Kind |
|---|---|---|---|---|
| 1 | إنشاء الطلب | `sales_coordinator` | `sales_manager`, or a named delegate | create |
| 2 | مدير المبيعات | `sales_manager` | `sales_coordinator` | approval |
| 3 | المدير المالي | `finance_manager` | `accountant` (مسؤول الحسابات) | approval |
| 4 | المدير العام | `general_manager` | `finance_manager` | approval |
| 5 | المدير التقني (الإنتاج) | `technical_manager` | **none — client decision** | approval |
| 6 | نتائج المختبر | `lab_technician` | any delegated lab user | data entry |
| 7 | اعتماد النتائج — **both together** | `general_manager` + `technical_manager` | **none — client decision** | dual approval |
| 8 | الميزان والترحيل | `weighbridge` | **none — client decision** | weigh → Posted |

### Rules confirmed with the client

- **Visibility.** Nobody sees an order until the person before them approves —
  **except the General Manager**, who sees every order from creation.
- **Rejection is terminal.** Any approver may reject with a reason; the GM may
  reject at *any* stage. A rejected order is closed: no return-to-edit, no
  resubmit. A new order must be created.
- **Editing stops at the first approval.** Only the creator (or admin) may edit,
  and only while `currentStageIndex === 2`.
- **Stage 6 is data entry, not approval.** The lab records a `LabSample` against
  the ordered flour grade; the system judges pass/warning/fail automatically from
  the per-product thresholds.
- **Stage 7 is a joint gate, not a race.** Whoever signs first waits for the
  other; the order does not advance until both signatures are in.
- **Orders have multiple line items.** Each line = flour grade + bag weight
  (10/25/30/50/60 kg) + bag count. The server computes line kg and order totals.
- **The weighbridge captures net weight only** — no truck, driver, gross or tare
  — shows the variance against the ordered quantity, and posts in the same action.
- **Every stage has a deputy** who may act *only* while the primary is marked
  absent, plus optional named delegation. A deputy's signature is always recorded
  as "on behalf of X", never as the primary's own.

---

## 7. Data model

### `src/models/SalesOrder.ts`

```ts
export type SalesOrderStatus = "Pending" | "Posted" | "Rejected";
export type StepStatus = "pending" | "approved" | "completed" | "rejected" | "skipped";
```

**Line sub-schema** (`{ _id: false }`): `productId → LabProduct`, `product`
(denormalized), `bagWeightKg` (`enum: [10,25,30,50,60]`), `bagCount` (`min: 1`),
`lineWeightKg` (**computed server-side, never from the client**), `note`.

**Step sub-schema** (`{ _id: false }`): `stageKey`, `stageIndex` (1..8), `role`,
`kind`, `status`, `enteredAt` (when the step became actionable — this single
field is what makes cycle-time reporting possible), `actedById → User`,
`actedByName`, `actedAt`, `note`, plus `actedAs` (`"primary" | "deputy" |
"delegate" | "admin"`) and `actedForRole`.

> **The dual sign-off trick:** stage 7 is stored as **two steps sharing
> `stageIndex: 7`** (`lab_signoff_gm` + `lab_signoff_tm`). A stage is complete
> when *every* step at that index is approved. No special-case branch anywhere.

**Main schema:** `orderNumber` (unique, **`ORD-<year>-<6 digits>`** e.g.
`ORD-2026-000123` — client-confirmed), `referenceNo` (see below),
`customerId → LabCustomer`
+ `customer`, `orderDate`, `deliveryDate`, `notes`, `lines[]`, `totalBags`,
`totalWeightKg`, `status`, `currentStageIndex`, `currentStageEnteredAt`,
`steps[]`, a `rejection` sub-object (`stageIndex/stageKey/role/reason/byId/
byName/at`), `labSampleIds[] → LabSample`, `labOverallStatus`
(`pass|warning|fail|""`), `actualNetWeightKg`, `varianceKg`, `variancePct`,
`weighNote`, `weighedById/Name`, `postedAt`, `createdById/Name`, `isActive`.

> **Invariant — put this in a comment on the field.** `currentStageIndex` is
> **monotonic**; nothing may ever decrement it. Because rejection is terminal
> there is no path backwards, and that invariant is what turns the visibility
> rule into one index-backed range query instead of an `$expr` collection scan.

```ts
{ status: 1, currentStageIndex: 1, orderDate: -1 }   // primary list
{ currentStageIndex: 1, currentStageEnteredAt: 1 }   // aging / "waiting on me"
{ createdById: 1, createdAt: -1 }                    // creator-sees-own
{ "steps.actedById": 1 }                             // past-actor read access
{ customerId: 1, orderDate: -1 }                     // per-customer report
{ orderDate: -1 }, { labOverallStatus: 1 }
```

#### `referenceNo` — the department's own number

Alongside the system's `orderNumber`, the creator enters **their own reference
from their own records** — the sales ledger number, the customer's purchase
order, whatever the department already uses on paper. Client-confirmed.

```ts
referenceNo: { type: String, default: "", trim: true },
// index({ referenceNo: 1 }) — searched, deliberately NOT unique
```

- **Optional.** Not every order will have one; never block creation on it.
- **Not unique.** It comes from a system this app does not control, and rejecting
  a repeat would block a legitimate order at the worst moment. Warn on save when
  the value already exists — *"ORD-2026-000098 already uses this reference"* — and
  let the user continue.
- Entered by the creator, editable on the same terms as the rest of the order
  (creator or admin, only while `currentStageIndex === 2`).
- **Searchable.** The Orders Overview search box matches order number, customer
  **and reference** — people look for an order by the number they wrote down, not
  the one the system generated.
- Shown as a muted sub-line under the order number in the list and beside it on
  the detail page. Labelled *Reference No. · الرقم المرجعي*.

### `src/models/User.ts`

Roles — this app's own set, no maintenance roles:
```ts
enum: ["admin",
       "sales_coordinator", "sales_manager", "finance_manager", "accountant",
       "general_manager", "technical_manager", "lab_technician", "weighbridge"]
```
Plus `name`, `nameAr`, `email` (unique), `password`, `permissions: string[]`,
`isActive`, and absence: `isAbsent: Boolean`, `absentFrom`, `absentTo`,
`absenceNote`. **No pre-save hook.**

> Absence is what unlocks a deputy's signature, so **every change to it is
> audited**.

### `src/models/Delegation.ts`

```ts
{
  role:        String,     // the stage role being delegated
  fromUserId:  ObjectId,   // the primary handing it over (null = admin-issued)
  toUserId:    ObjectId,   // the stand-in
  toUserName:  String,     // denormalized for the ladder
  from:        Date,
  to:          Date,       // required — a delegation always expires
  reason:      String,
  createdById: ObjectId, createdByName: String,
  isActive:    Boolean,
}
```
Indexes `{ toUserId: 1, isActive: 1, from: 1, to: 1 }` and `{ role: 1, isActive: 1 }`.
Live when `isActive && from <= now <= to`. Create/edit/revoke writes an
`AuditLog` entry (`entityType: "delegation"`) — this is authority moving, and it
must be as traceable as an approval.

### `src/models/LabSample.ts` (moved)

Add `orderId: { type: ObjectId, ref: "SalesOrder", default: null }` and a
denormalized `orderNumber: String`, plus `index({ orderId: 1 })`.

> **The lab keeps working standalone — do not make `orderId` required.**
> The approval chain adds *a* route into the lab; it does not replace the
> existing one. Routine production QC — shift sampling, `batchId` lots, any
> ad-hoc test — is still created directly from the Results tab with no order
> attached, and a sample with `orderId: null` is a first-class citizen
> everywhere: lists, control charts, KPIs, per-customer stats and the Excel
> export. Only stage 6 of the chain sets `orderId`.
>
> Existing lab data is trivial to carry over: the catalogue (8 flour grades,
> 11 parameters, 10 per-product thresholds) is fully reproduced by
> `npm run seed:lab` against the new database. As of 2026-09-05 the CMMS holds
> only 6 test samples and one attachment, so there is nothing worth migrating —
> seed the new database and start clean.

### `src/models/LabCustomer.ts` (moved)

Extend in place with the sales fields it now needs: `code`, `nameAr`, `phone`,
`contactName`, `address`. It is the plant-wide customer table, not a lab lookup.

> **Caveat:** `POST /api/lab/customers` is find-or-create-on-typing (the lab
> combobox auto-saves whatever is typed). Harmless for lab, poisonous for sales —
> "Al Amal" vs "AL AMAL Co." silently splits the per-customer report. The order
> dialog must use a **select-only** picker with an explicit "+ New customer"
> action gated to `admin | sales_manager`.

### `src/models/Notification.ts` (moved)

The `type` enum is **closed**, and entity links are per-module columns. Replace
the maintenance types with: `order_pending`, `order_rejected`, `order_posted`,
`lab_fail`. Replace `pmTaskId` with `salesOrderId`; keep `labSampleId`.

---

## 8. The workflow engine — `src/lib/salesWorkflow.ts`

Pure functions, **no model or DB imports**, so both API routes and client
components import it — the same rule `labQc.ts` states in its header.

```ts
export type SalesRole =
  | "sales_coordinator" | "sales_manager" | "finance_manager" | "accountant"
  | "general_manager"   | "technical_manager"
  | "lab_technician"    | "weighbridge";

export interface StageDef {
  key: StageKey; index: number;
  role: SalesRole;            // the primary — may always act
  deputyRole?: SalesRole;     // may act ONLY while every primary holder is absent
  kind: "create" | "approval" | "data_entry" | "weigh";
  en: string; ar: string;
}

/** THE declaration. Everything else in this file is derived from it. */
export const SALES_STAGES: readonly StageDef[] = [
  { key: "created",                    index: 1, role: "sales_coordinator", deputyRole: "sales_manager",     kind: "create",     en: "Order created",      ar: "إنشاء الطلب" },
  { key: "sales_manager_approval",     index: 2, role: "sales_manager",     deputyRole: "sales_coordinator", kind: "approval",   en: "Sales Manager",      ar: "مدير المبيعات" },
  { key: "finance_manager_approval",   index: 3, role: "finance_manager",   deputyRole: "accountant",        kind: "approval",   en: "Finance Manager",    ar: "المدير المالي" },
  { key: "general_manager_approval",   index: 4, role: "general_manager",   deputyRole: "finance_manager",   kind: "approval",   en: "General Manager",    ar: "المدير العام" },
  { key: "technical_manager_approval", index: 5, role: "technical_manager",                                  kind: "approval",   en: "Technical Manager",  ar: "المدير التقني" },
  { key: "lab_results",                index: 6, role: "lab_technician",                                     kind: "data_entry", en: "Lab results",        ar: "نتائج المختبر" },
  { key: "lab_signoff_gm",             index: 7, role: "general_manager",                                    kind: "approval",   en: "GM sign-off",        ar: "اعتماد المدير العام" },
  { key: "lab_signoff_tm",             index: 7, role: "technical_manager",                                  kind: "approval",   en: "Tech. sign-off",     ar: "اعتماد المدير التقني" },
  { key: "weighbridge_post",           index: 8, role: "weighbridge",                                        kind: "weigh",      en: "Weighbridge & post", ar: "الميزان والترحيل" },
] as const;

/** Earliest stage each role participates in — this IS the visibility floor.
 *  Derived over BOTH `role` and `deputyRole`: a deputy who cannot see the order
 *  cannot stand in for anyone. Never hand-maintained. */
export const MIN_STAGE_BY_ROLE: Record<string, number> =
  /* reduce over SALES_STAGES, Math.min across role + deputyRole */;

/** The only two hand-written exceptions to "you see it once it reaches you". */
const ROLE_FLAGS: Partial<Record<SalesRole, { seesAll?: boolean; ownOnly?: boolean }>> = {
  general_manager:   { seesAll: true },   // sees every order from creation
  sales_coordinator: { ownOnly: true },   // creators see their own, not each other's
};
```

Pure predicates: `stagesAt(i)`, `nextStageIndex(i)`, `isTerminal(status)`,
`stageComplete(order, i)` (every step at that index approved — handles stage 7
with no branch), `actableStages(order, actor)`, `canReject(order, actor)` (admin
and `general_manager` at any stage; everyone else only on a slot currently
theirs), `canCreate(actor)`.

### 8.1 Visibility as a Mongo filter — the crux

Because `currentStageIndex` is monotonic, the rule collapses to one comparison:

> a role sees an order **iff the order has reached the earliest stage that role owns.**

```ts
/** Returns a filter yielding EXACTLY the orders `actor` may read.
 *  NEVER filter visibility in JS after fetching — pagination totals would lie. */
export function visibilityFilter(actor: Actor): FilterQuery<...> {
  const base = { isActive: true };
  if (actor.role === "admin") return base;

  const minStage = MIN_STAGE_BY_ROLE[actor.role];
  if (minStage === undefined) return { ...base, _id: { $in: [] } };  // not in the chain

  const flags = ROLE_FLAGS[actor.role] ?? {};
  if (flags.seesAll) return base;                                    // general_manager

  const me = new Types.ObjectId(actor.id);
  const or = [
    { createdById: me },        // creator always sees own
    { "steps.actedById": me },  // anyone who ever acted keeps read access
  ];
  if (!flags.ownOnly) or.push({ currentStageIndex: { $gte: minStage } });
  return { ...base, $or: or };
}
```

Worked cases: `finance_manager` (min 3) cannot see an order sitting at stage 2,
nor one rejected at stage 2 (frozen at 2). `technical_manager` (min 5, also stage
7) is covered by one clause. `weighbridge` (min 8) sees posted orders too, since
`currentStageIndex` stays 8. `lab_technician` (min 6) never sees an order the
technical manager killed at stage 5.

Ship an **`andFilters(...parts)`** helper in the same file: `visibilityFilter`
returns `$or` and search filters also want `$or`, and two `$or` keys silently
overwrite each other. Every read path — list, detail, export, every report's
`$match` — starts with `visibilityFilter(actor)`. No exceptions.

### 8.2 Deputies, absence and delegation

Three ways to gain authority over a stage, checked in this order:

```ts
export type ActorAuthority =
  | { kind: "primary" }
  | { kind: "delegate"; forRole: SalesRole; delegationId: string }
  | { kind: "deputy";   forRole: SalesRole }
  | null;

export function authorityFor(
  stage: StageDef,
  actor: Actor,
  ctx: { liveDelegationRoles: SalesRole[]; primaryRoleIsAbsent: boolean }
): ActorAuthority
```

- **Primary** — `actor.role === stage.role`. Always allowed.
- **Delegate** — a live `Delegation` grants the stage's role for a date range.
  Allowed regardless of absence: the primary handed it over deliberately.
- **Deputy** — `actor.role === stage.deputyRole`, allowed **only when no active,
  non-absent user holds `stage.role`**. One indexed query:
  `User.exists({ role: stage.role, isActive: true, ...notAbsentFilter() })`.
  A deputy is a fallback, not a second approver.
- `admin` bypasses all three.

**Stages 5, 7 and 8 have no deputy — a decision, not an omission.** The client
has confirmed nobody automatically stands in for the technical manager, the joint
sign-off, or the weighbridge. The consequence must therefore be *visible* rather
than silent — an order must never stall quietly:

- The Waiting-For cell and the ladder both read *"Vikram Singh — away until 12/09
  · no deputy for this stage"* in amber, not just a name.
- The aging clock keeps running, so the order still turns red at 48 h.
- The zero-recipient rule (§14.7) fires: admins are notified the order is stalled,
  and why.
- **Named delegation still works on these stages** — the primary can appoint a
  stand-in deliberately before going away. Only the *automatic* deputy is absent.

**The signature must say so.** Store `actedAs` and `actedForRole` on the step.
The ladder renders *"صادق عليها محمود — بالإنابة عن المدير المالي"*, the audit
records it, and the coverage report counts it. A deputy signature that looks
identical to a primary one destroys the value of the whole chain.

**Visibility follows the same set:** `effectiveRoles(actor, liveDelegations) =
[actor.role, ...delegatedRoles]`, then `Math.min` of `MIN_STAGE_BY_ROLE` across
it. Deputy roles are already folded into `MIN_STAGE_BY_ROLE`.

### 8.3 Atomic transitions — never read-modify-write

Two managers clicking approve on stage 7 in the same second must not corrupt
state. Every transition is a **conditional `findOneAndUpdate`** asserting its
precondition; a `null` result means someone beat you → **409**.

1. **Claim the slot.** Filter on `{ _id, isActive: true, status: "Pending",
   currentStageIndex: stage.index, steps: { $elemMatch: { stageKey, status:
   "pending" } } }`; `$set` the step's status/actor/time/note via `arrayFilters`.
2. **Advance only if `stageComplete(claimed, stage.index)`** — a second
   `updateOne` guarded by `{ currentStageIndex: stage.index, status: "Pending" }`
   setting the next index, `currentStageEnteredAt`, and the next steps'
   `enteredAt`. Harmless no-op for the loser of a stage-7 race, because the
   precondition fails. Stage 8's weigh sets `status: "Posted"` and `postedAt` in
   the **same write** as the weight.
3. **Rejection** — one conditional write on `{ status: "Pending" }` setting
   `status: "Rejected"` + the `rejection` sub-object and flipping all still-
   `pending` steps to **`skipped`** (not left pending — that is what lets the
   ladder render "never reached" correctly and keeps `stageComplete` honest),
   then a targeted write marking the rejector's own step `rejected`.

---

## 9. API routes

| Method | Path | Purpose | Guard |
|---|---|---|---|
| GET | `/api/orders` | Paginated list through `visibilityFilter` | `requireSession` |
| POST | `/api/orders` | Create + submit to stage 2 | `requireRole("sales_coordinator","sales_manager")` |
| GET | `/api/orders/[id]` | Single order + `permissions` block | `requireSession` + `visibilityFilter` **inside the `findOne`** |
| PUT | `/api/orders/[id]` | Edit — only while `currentStageIndex === 2`, creator/admin | `requireSession` + ownership |
| DELETE | `/api/orders/[id]` | Soft delete | `requireRole("admin")` |
| GET | `/api/orders/[id]/history` | AuditLog rows | `requireSession` + visibility |
| POST | `/api/orders/[id]/approve` | Approve current slot | `requireSession` + `authorityFor` |
| POST | `/api/orders/[id]/reject` | Terminal reject + reason | `requireSession` + `canReject` |
| POST | `/api/orders/[id]/lab` | Attach/create LabSample(s), complete stage 6 | `requireRole("lab_technician")` |
| POST | `/api/orders/[id]/weigh` | Net weight → `Posted` | `requireRole("weighbridge")` |
| GET | `/api/orders/stats` | Report aggregations | `requireSession` + visibility in `$match` |
| GET | `/api/orders/queue` | Per-queue counts for the sidebar badges — `{ approvals, signOff, rejections }` — each computed **through `visibilityFilter`** | `requireSession` |
| GET | `/api/customers` | List, search, `withStats=true` for the per-customer roll-up | `requireSession` |
| POST | `/api/customers` | Create — **rejects case-insensitive duplicates** | `requireRole("sales_manager")` |
| PUT/DELETE | `/api/customers/[id]` | Edit / archive | `requireRole("sales_manager")` |
| POST | `/api/customers/merge` | Repoint orders + samples, archive the loser, audit | `requireRole("admin")` |
| GET/POST | `/api/delegations` | List / create | `requireSession` / primary-or-admin |
| DELETE | `/api/delegations/[id]` | Revoke | primary-or-admin |
| PUT | `/api/users/[id]/absence` | Set/clear absence + audit | self or admin |
| GET/POST | `/api/users` | List / create — hash with bcrypt cost 12 manually | `requireRole("admin")` |
| PUT/DELETE | `/api/users/[id]` | Edit / deactivate. **Whitelist the fields** — never `$set` the raw body, or `role` and `permissions` become client-settable | `requireRole("admin")` |
| POST | `/api/users/[id]/reset-password` | Admin password reset (min 6 chars) | `requireRole("admin")` |
| GET | `/api/notifications` | The user's notifications + unread count; admins see their own only (see §14.6) | `requireSession` |
| PUT | `/api/notifications` | `{ markAllRead: true }` | `requireSession` |
| DELETE | `/api/notifications/[id]` | Mark read / delete one | `requireSession` + ownership |
| GET | `/api/notifications/stream` | SSE — `force-dynamic`, 25 s heartbeat | `requireSession` |
| GET | `/api/audit-log` | Backs the Audit Trail page — filters `entityType`, `action`, `search`, date range, paging | `requireRole("admin","general_manager")` |
| GET | `/api/health` | DB ping + latency, versions, uptime — backs dashboard block K | `requireRole("admin")` |

> **These eight exist in the CMMS and are easy to assume away — a standalone app
> has to build them.** Copy the shapes, not the guards: `/api/users` and
> `/api/users/[id]` in the CMMS have **no `auth()` call at all**, and `PUT` feeds
> the raw request body straight into `findByIdAndUpdate`, so anyone reachable on
> the network can create an admin or grant themselves any role. In a system whose
> entire authority model is `role`, reproducing that would void the whole chain.
| GET/POST/PUT/DELETE | `/api/lab/*` | Moved lab routes — **now guarded** | `requireRole("lab_technician","technical_manager")` for mutations |
| POST | `/api/export` | Excel dispatch | `requireSession` + visibility |

**Response enrichment — the client never re-derives authority.** Every order
returned carries a server-computed block from the same `salesWorkflow.ts`
functions:
```ts
permissions: {
  canApprove, canReject, canEnterLab, canWeigh, canEdit,
  actableStageKeys: string[],
  actingAs: null | { kind: "deputy" | "delegate"; forRole: string; forRoleLabel: string },
}
```
Used only to show/hide buttons; the server re-checks on every POST.

**POST `/api/orders`** body: `{ customerId, orderDate, deliveryDate?, notes?,
lines: [{ productId, bagWeightKg, bagCount, note? }] }`. Server resolves customer
and product names for denormalization (400 on unknown ids), validates
`bagWeightKg ∈ [10,25,30,50,60]` and `bagCount >= 1`, computes all weights
itself, then calls `createSalesOrder()`.

**POST `/api/orders/[id]/lab`** body `{ sampleIds?, newSamples?, note? }`.
Extract the scoring+create body of `POST /api/lab/samples` into
`src/lib/labSampleCreate.ts` and have **both** routes call it rather than
duplicating `scoreResults()`. Then roll up `labOverallStatus` with
`rollUpStatus()` from `labQc.ts` and complete stage 6.

**POST `/api/orders/[id]/weigh`** body `{ actualNetWeightKg, note? }`. Computes
`varianceKg` / `variancePct`, sets `Posted` + `postedAt`. 400 on non-finite or
non-positive weight.

**Audit** — every transition calls `writeAudit()` with `entityType:
"sales_order"`, `action` ∈ `created | stage_approved | stage_rejected |
lab_attached | weighed_posted | updated`, `field: stage.key`, `oldValue`/
`newValue` = stage indices, `notes` = the note or rejection reason.

---

## 10. Pages & components

```
src/app/login/page.tsx                        # own login (Server Action)
src/app/(dashboard)/layout.tsx                # AppShell
src/app/(dashboard)/dashboard/page.tsx        # own dashboard — pipeline + my queue
src/app/(dashboard)/orders/page.tsx           # Orders Overview — the reference screen (§10.1)
src/app/(dashboard)/orders/[id]/page.tsx      # detail: header, lines, ladder, actions
src/app/(dashboard)/approvals/page.tsx        # queue: stages 2-5 waiting on me
src/app/(dashboard)/sign-off/page.tsx         # queue: stage 7 waiting on my signature
src/app/(dashboard)/rejections/page.tsx       # every rejected order + reason + who
src/app/(dashboard)/customers/page.tsx        # Customers module — list, search, CRUD
src/app/(dashboard)/customers/[id]/page.tsx   # customer profile: orders + QC history
src/app/(dashboard)/lab/page.tsx              # QC tabs (moved: Results | Specs | Customers | KPIs)
src/app/(dashboard)/reports/page.tsx          # analytics
src/app/(dashboard)/users/page.tsx            # user admin + absence + delegations
src/app/(dashboard)/audit-log/page.tsx        # audit viewer

src/components/orders/OrderDialog.tsx         # create/edit
src/components/orders/LineItemsEditor.tsx     # repeating rows, live line kg + total
src/components/orders/ApprovalTimeline.tsx    # THE ladder (vertical + compact)
src/components/orders/StageBadge.tsx          # "4 / 8 · مدير عام" pill
src/components/orders/ActionPanel.tsx         # driven by the server `permissions` block
src/components/orders/RejectDialog.tsx        # reason + "this is permanent" warning
src/components/orders/LabStepDialog.tsx       # wraps SampleDialog, prefilled from the order
src/components/orders/WeighDialog.tsx         # net weight + live variance readout
src/components/orders/DelegationDialog.tsx    # appoint a stand-in + date range
src/components/orders/AbsenceToggle.tsx       # "I am away" switch + date range
src/components/orders/PipelineBoard.tsx       # 8 columns: count, tons, oldest-waiting
src/components/orders/StageJumpBar.tsx        # GM-only: 8 stage chips with counts, click to filter
src/components/orders/CurrentStageCell.tsx    # two-line tinted table cell
src/components/orders/WaitingOnCell.tsx       # avatar(s) + name + role, "You" when it's you
src/components/orders/HowToReadPanel.tsx      # the in-product rules explainer
src/components/orders/VisibilityBanner.tsx    # "Visibility for <role>: ..." one-liner
src/components/customers/CustomerDialog.tsx   # create/edit
src/components/customers/CustomerPicker.tsx   # select-only picker used by the order dialog
```

### 10.0 Dashboard — composed by role

Nine roles with different jobs and different visibility cannot share one fixed
screen. The dashboard is a **catalogue of blocks**, and a role's landing page is
whichever blocks apply to it. Three rules govern all of them:

1. **Every number is computed through `visibilityFilter`.** A card reading
   "24 orders in the pipeline" shown to a finance manager who may only see 9 is
   both wrong and a leak — it tells him 15 orders exist that he is not allowed to
   know about.
2. **Every block answers "what do I do today".** No lifetime totals, no vanity
   counters. (The CMMS learned this the hard way: its "Total PM Lines" card and
   its KPI export row were both removed after nobody used them.)
3. **The dashboard previews, the queue pages own.** "Waiting on me" here shows
   the top five and links to `/approvals`; it does not become a second full list
   competing with the nav.

#### Block catalogue

**A · Waiting on me** — the most important block for seven of the eight roles,
and the top-left position on their dashboard. Not a stat card: the actual rows,
**oldest first**, each showing order number, customer, tonnage, which stage, and
**how long it has been sitting** (slate <24 h · amber 24–48 h · red >48 h). Row
click goes straight to the order. If the viewer holds authority as a deputy or
delegate, the row says so — *"بالإنابة عن المدير المالي"* — before they act.

**B · My orders** *(sales coordinator)* — the orders he created that are still
walking, with their current stage, plus the ones rejected in the last 30 days
with the reason. He is the one the customer telephones, so this is the block that
lets him answer without asking anyone.

**C · Pipeline board** *(GM, admin)* — the eight stages as columns: order count,
tons, and the oldest waiting order in each. Any column holding something more
than 48 h is tinted red. This is the whole plant on one strip.

**D · Stuck orders** *(GM, admin)* — an alert strip above everything else when
any order has been at one desk more than 48 h: *"3 orders have been waiting more
than 2 days"*, listing which and on whom. Absent entirely when nothing is stuck —
an empty alert box trains people to ignore alerts.

**E · This month** *(GM, sales manager, admin)* — posted orders and tons,
rejected orders and tons lost, and average order-to-posted time. Four numbers,
each with its change against last month.

**F · Rejections** *(GM, admin)* — the last few rejected orders with stage,
reason and rejector, plus a small by-stage tally. Answers "where do orders die",
which is the question that changes behaviour upstream.

**G · Lab queue** *(lab technician, technical manager)* — orders released to the
lab and awaiting results, plus today's recorded samples and their verdicts. A
`fail` is called out, not buried in a list.

**H · Quality signal** *(technical manager, GM, lab)* — in-spec percentage for
the period and the parameters currently drifting, reusing `KpiPanel` from the lab
module. The technical manager's job is quality, so this is his headline, not a
footnote.

**I · Ready to weigh** *(weighbridge)* — orders that cleared stage 7 and are
waiting on the scale. This role's dashboard is essentially this block alone, and
that is correct: a focused screen beats a general one.

**J · Delegations & absence** *(everyone)* — a quiet strip stating what is in
force for you right now: *"You are covering the Finance Manager until 12/09"* or
*"You are marked away until 08/09 — the Accounts Officer is covering stage 3"*.
People forget they are standing in for someone; the system should not.

**K · System health** *(admin)* — database reachability, last seed/cron run,
version. The CMMS has an equivalent page worth copying.

#### Role → blocks

| Role | Blocks, in order |
|---|---|
| `sales_coordinator` | B · A · J |
| `sales_manager` | A · E · B · J |
| `finance_manager` | A · E · J |
| `accountant` | A · J |
| `general_manager` | D · C · A · E · F · H · J |
| `technical_manager` | A · G · H · J |
| `lab_technician` | G · H · J |
| `weighbridge` | I · J |
| `admin` | D · C · E · F · K |

#### Empty states

On most days most people have nothing waiting, so the empty state is the common
case and must be written properly. Not a blank panel — a sentence that still
carries information: *"Nothing waiting on you. 6 orders are moving through the
chain; the next one reaches you at stage 3."* For the weighbridge on a quiet
afternoon: *"Nothing ready to weigh. 2 orders are awaiting sign-off."*

#### What not to build

No chart that nobody will act on, no "total orders ever", no leaderboard of who
approved the most. Cycle time and coverage belong in Reports (§11), where they
are read weekly by one person, not on a screen eight people open every morning.

### 10.1 Orders Overview — the reference screen

A client-approved mockup exists for this screen. Build to it. Anatomy, top to
bottom:

**Sidebar — queues, not entities.** The nav is organised by *what you must do*,
not by what the data is: `Dashboard · Orders Overview · Approvals ⑵ ·
Results Sign-off ⑴ · Customers · Reports · Rejections · Audit Trail`. The count badges are
live and **must respect `visibilityFilter`** — a badge that counts orders the
user cannot open is worse than no badge. Dark navy panel, brand mark top-left,
"Need Help? Contact Support" pinned at the bottom, and a collapse toggle.

> This replaces the single-list-plus-a-filter design: `Approvals` (stages 2–5
> awaiting me) and `Results Sign-off` (stage 7 awaiting my signature) are
> separate destinations because they are different *jobs*, done by different
> people, at different moments.

**Header.** Page title plus a plain-language subtitle — *"Track all orders,
their current status, and who they are waiting for."* Bell with unread count.
User chip on the right showing initials, name, **and the role underneath the
name**. In a system where authority is derived from role, the user should never
have to guess which hat they are wearing.

**Visibility banner.** A single line stating this role's visibility rule in
plain language — *"Visibility for General Manager: you can see all orders from
the moment they are created."* For a finance manager it reads *"You see an order
once the General Manager has approved it."* This one line prevents the most
common support question in a system that deliberately hides rows.

**Stage jump bar (`StageJumpBar.tsx`) — General Manager and admin only.**
The mockup shows a decorative eight-stage process diagram across the top. **Do
not build that.** Build the useful half instead: a row of eight compact chips,
each carrying the stage number, its short name, and a **live count of the orders
sitting there right now**. Clicking one filters the table to that stage; clicking
it again clears the filter.

Hide it entirely for every other role, and the reason is structural rather than
cosmetic: **only the General Manager can see orders at every stage.** A finance
manager cannot see anything at stage 2, so a "stage 2 (0)" chip would be a dead
end that misreports the plant as empty. A control that lies to six of the eight
roles should not be shown to them.

Two implementation notes:

- It is a faster, count-bearing form of the "All Stages" dropdown in the filter
  bar — **keep the two in sync in both directions**: clicking a chip sets the
  dropdown, and changing the dropdown highlights the matching chip. Do not let
  the page hold two competing ideas of the current stage filter.
- It overlaps with `PipelineBoard` (§11 report 1) without replacing it: the chips
  are a *filter control* on the list, the board is the *analytical* view with
  tonnage and oldest-waiting. Build both, but do not merge them.

Because these are chips rather than a directional flow, there are no arrows — so
the row mirrors cleanly under `dir="rtl"` with no special handling.

**Filter bar.** Search (order ID or customer) · All Statuses · All Stages ·
date range · **Export** on the far end.

**Table columns.** Order ID (link) · Customer · Order Date · **Total Bags** ·
**Ordered Qty (kg)** · Status · Current Stage · Waiting for Approval From.

- **Current Stage** is a two-line tinted cell, not a badge: the stage number and
  name in bold, then the last action with its timestamp — *"Approved by Sales
  Manager at 20 May 2025 10:15 AM"* — behind a small state dot. Tint amber while
  waiting, green once done or posted. At stage 6 it also surfaces the lab verdict
  inline: *"Recorded at … · Judgment: PASS"*.
- **Waiting for Approval From** is its own column: avatar + person + role. It
  says **"You (Anil Mehta)"** when the viewer is the one holding it up. At stage
  7 it shows **both** avatars with *"You and Vikram Singh — both signatures
  required"*. A deputy renders inline as *"Anita Verma · Accounts Officer ·
  (on behalf of Finance Manager)"*. Terminal rows show `–`.
- Status pills: `Waiting` amber · `Lab Results` blue · `Sign-off Pending`
  purple · `Posted` green · `Rejected` red.

**"How to read this view" panel** — a persistent side panel restating the six
invariants at the point of use: what you can see and why · what Current Stage
means · what Waiting-For means · **rejection is permanent** · **no editing after
the first approval** · **a deputy signature is always recorded as "on behalf
of"**. These rules are unusual enough that people will not retain them from
training; putting them on the screen is cheaper than explaining them twice a week.

Keep the aging signal from §10.2 (slate <24 h, amber 24–48 h, red >48 h) on the
Current Stage cell — the mockup does not show it and it is the single most
valuable column in the table.

#### RTL — the whole page, not just the text

**Client decision: Arabic mirrors completely, English does not.** Both are
first-class; neither is a translation layer bolted onto the other.

The mockup is English and left-to-right. In Arabic every one of these flips: the
sidebar moves to the right edge, the "How to read this view" panel to the left,
table columns run right-to-left, the stage-jump chips reverse order, the
approval ladder's rail moves to the right (§10.2), avatars and their labels swap,
and the collapse chevron points the other way.

Mechanically this is free **if** the rule is followed without exception: logical
Tailwind properties only — `ms-` `me-` `ps-` `pe-` `start-` `end-` `-end-` — and
never `ml-` `mr-` `left-` `right-` `pl-` `pr-`. One physical property in a shared
component breaks a screen nobody was looking at. Make it a build gate:

```bash
grep -rnE '\b(ml|mr|pl|pr|left|right)-[0-9]' src/components src/app   # must be empty
```

Dates render as `20 May 2025 10:00 AM` in the mockup; the Arabic view formats the
same instant per `lang`. Nothing on the page may be an untranslated English
string — including table headers, empty states, tooltips and error messages.

#### Two numbers per order

Settled: the system allocates **`ORD-<year>-<6 digits>`** (`ORD-2026-000123`),
matching the mockup. Beside it the creator enters **`referenceNo`** — the sales
department's own number from their own records (§7). Both appear in the list, the
detail page, search and any printed sheet: the system number is what the chain is
audited by, the reference is what the office already calls it.

### 10.1b Customers module

The customer is the one entity shared by both halves of this system — an order is
placed *by* a customer, and a QC sample is judged *for* a customer — so it gets
its own module rather than living as a tab inside the lab screens.

**Model.** `LabCustomer` extended in place (§7): `code`, `name`, `nameAr`,
`phone`, `contactName`, `address`, `notes`, `isActive`. Do not create a second
customer collection — orders and lab samples must point at the same rows or the
per-customer reports cannot be written.

**List page.** Search by name or code, active/inactive filter, and per row: code,
name, phone, contact, **orders (count)**, **tons posted**, **last order date**,
and a QC chip showing that customer's in-spec percentage. Create / edit / archive
via a dialog. Excel export.

**Profile page** (`customers/[id]`), two halves on one screen:
- *Commercial* — orders by status, tons ordered vs posted vs lost to rejection,
  average time from order to posting, rejection rate.
- *Quality* — sample count, pass/warning/fail split, in-spec %, and the trend
  chart already built for `CustomersTab` in the lab module.

This is the screen that answers "who is this customer to us", and it is only
possible because both halves key on the same `customerId`.

**⚠️ Deduplication is the whole game here.** The lab's existing
`POST /api/lab/customers` is *find-or-create-on-typing* — the sample dialog's
combobox silently creates whatever the technician types. Tolerable when a
customer was just a label on a test; **destructive** now that tonnage and revenue
hang off the row, because "Al Amal", "AL AMAL", and "Al-Amal Co." become three
customers and split every report three ways.

Required changes when moving that route:
- Order and sample dialogs use **`CustomerPicker` — select-only**, over
  `GET /api/customers`. No creation by typing.
- Creating a customer is an explicit action, gated to `admin | sales_manager`.
- `POST /api/customers` rejects a name that already exists case- and
  whitespace-insensitively, and returns the existing row with a clear message
  rather than silently creating a near-duplicate.
- Add a **merge** action (admin only): pick two customers, repoint every
  `SalesOrder.customerId` and `LabSample.customerId` from one to the other,
  archive the loser, write an `AuditLog` entry. You will need this — the seed
  list below came off a handwritten sheet, and duplicates are a matter of when.

**Seed.** The initial customer list came from the client on paper and is
transcribed in §17. Load it via `seed-customers.ts`, idempotent upsert on a
normalised name.

### 10.1c Absence and delegation — the two screens

The rules are in §8.2; these are the screens that drive them. Both are small, and
both write an `AuditLog` entry on every change, because each one moves signing
authority.

**`AbsenceToggle`** — reachable from the user's own header menu, and from the
Users page for an admin acting on someone else. A switch plus an optional date
range and a short note. Saving shows the consequence in plain language before it
is applied: *"While you are away, the Accounts Officer can approve stage 3 on
your behalf."* Clearing it is one click and takes effect immediately.

The dashboard strip (block J) is the counterpart: it tells a user they are
currently marked away, because the commonest failure here is someone forgetting
to switch it off and quietly losing their approvals to a deputy for a week.

**`DelegationDialog`** — opened by the primary for their own role, or by an admin
for anyone. Fields: the role being handed over (fixed to the opener's own role
unless admin), the person receiving it, a **required** end date, and a reason.

Validation, all server-side as well:
- The end date is required and must be in the future — a delegation with no
  expiry is a permanent transfer of authority by accident.
- The recipient must be an active user, and cannot be the primary themselves.
- Overlapping live delegations for the same role are rejected; revoke the
  existing one first, so at no moment are two people both "the delegate".

Revoking is immediate and audited. The list of live delegations is visible on the
Users page and in dashboard block J.

### 10.2 `ApprovalTimeline` — the responsibility chain

Pure presentation over `SALES_STAGES` + `steps`; it never fetches.

```
[rail]  [node]   [content]
   │      ●      Sales Manager · مدير المبيعات            [stage 2]
   │             ✓ Approved by Ahmad · 12/06/2026 14:32
   │             "Price confirmed with customer"
   │      ◉      Finance Manager · المدير المالي          [stage 3]
   │             ⏳ Waiting 3d 4h                          ← current
   ╵      ○      Technical Manager                        [stage 5, dimmed]
```

- Rail `absolute start-4 top-0 bottom-0 w-px bg-slate-200`, content offset
  `ms-12`. **Logical properties only** — under `dir="rtl"` the rail moves to the
  right and the chain reads right-to-left with zero extra CSS.
- Node states: **done** green + `<Check>` + actor/time/note · **current** sky +
  `<Clock>` + ring + aging chip (slate <24 h, amber 24–48 h, **red >48 h** — this
  is the "who is holding it up" signal that makes the module worth building) ·
  **pending** white/dimmed · **rejected** red + `<X>` + a full-width reason panel
  and "Order closed — a new order must be created" · **skipped** grey, "Not
  reached · لم يتم الوصول إليها".
- A deputy signature renders as *"صادق عليها محمود — بالإنابة عن المدير المالي"*.
- **Stage 7 renders as one node with two indented sub-rows** (GM, Technical
  Manager), each with its own tick/clock, plus a `1 / 2 signatures` badge. Green
  only when both are — visually enforcing a joint gate, not a race.
- **Stage 6** shows linked sample numbers as chips with `<QcStatusBadge/>`.
- **Stage 8** shows `Ordered 24.000 t → Actual 23.940 t` with a signed coloured
  delta.
- Icons: `Check` / `Clock` / `X` only. No `ArrowRight` (unmirrored under RTL).

**Compact variant** for list rows: 8 dots in a `flex gap-1`, `<Tooltip>` per dot;
stage 7's two steps collapse to one dot that is green only when both are.

**Duration formatting:** add `formatDuration(ms)` to `utils.ts` producing
`"3d 4h"` / `"5h 12m"` / `"18m"` / `"just now"`. The CMMS's `formatIdleTime()`
takes *minutes* and stops at hours — don't reuse it.

### 10.3 `ActionPanel`

Sticky card rendered strictly from the server `permissions` block: green
**Approve** (optional note) · outline red **Reject** → `RejectDialog` · **Enter
lab results** · **Weigh & post**. Nothing actionable → one muted line *"Waiting
on {stage} · في انتظار {ar}"*. On **409** show the inline red box "This order has
already moved on" and refetch.

**Standing in.** When the server grants authority as `deputy` or `delegate`, the
panel says so *before* the button — *"أنت تتصرف بالإنابة عن المدير المالي (غائب
حتى ١٢/٩)"* — and the confirm button reads **Approve on behalf**. Nobody signs as
a deputy without seeing that they are doing it.

`RejectDialog` requires a non-empty reason (button disabled until then) and
states in both languages that rejection is **permanent**.

---

## 11. Reports

All aggregations `$match` on `visibilityFilter(actor)` first. Served by
`GET /api/orders/stats?report=<key>&from=&to=`.

1. **Pipeline & aging by stage** — *"Where is everything, and what is stuck?"*
   `$group` live orders by `currentStageIndex`: count, tons,
   `$min: currentStageEnteredAt`, avg hours. Red past 48 h. A manager's home screen.
2. **Cycle time & bottleneck per approver** — *"Who is slow?"* `$unwind: "$steps"`
   → `$match: { "steps.actedAt": { $ne: null } }` → hours = `actedAt - enteredAt`
   → `$group` by `stageKey`, then by `{ stageKey, actedById }`. This is exactly
   why `steps.enteredAt` is stored.
   > **MongoDB here is 6.0.1 — `$percentile` needs 7+.** `$push` the durations and
   > compute p90 in JS. Precedent: `/api/lab/stats` computes CV%/rating in JS.
3. **Rejection analysis** — *"Why do orders die, and where?"* Rejected orders
   grouped by `rejection.stageIndex`: count, tons lost, reasons, rejectors. Paired
   with a rejection rate per stage = rejected-at-stage ÷
   `countDocuments({ currentStageIndex: { $gte: i } })`. A finance manager
   rejecting 40 % at stage 3 means sales is quoting badly.
4. **Ordered vs actual weight variance** — Posted orders by customer and (with
   `$unwind`) by product, plus an outlier list beyond ±1 %.
5. **Per-customer volume** — orders, tons ordered/posted/rejected, avg cycle time,
   rejection rate — on the same screen as that customer's lab quality history.
6. **Lab pass rate on orders** — group by `labOverallStatus` overall and per
   customer/product. No `$lookup` needed; it is denormalized onto the order.
7. **Delegation & absence coverage** — steps grouped by `actedAs`, per stage and
   per person, plus what is in force today. A stage covered 60 % of the time by a
   deputy is a staffing fact management should see.
8. **My queue / SLA breaches** — not a chart: the default list with `mine=true`
   sorted by `currentStageEnteredAt` ascending, plus a red sidebar badge.

Excel: three `ExcelSheetDef`s (`orders`, `pipeline`, `cycle_time`). `statusFill()`
already colours `"rejected"` red and `"completed"` green — map `Posted →
"Completed"` for free colour-coding.

---

## 11.1 Charts

Charts are the smallest part of this system and should stay that way. Work in
this order: **pick the form → assign colour by the job it does → validate →
mark specs → hover layer**. Colour comes last; most bad charts pick it first.

### Which of the eight reports is actually a chart

| Report | Form | Why |
|---|---|---|
| 1 · Pipeline & aging | **Not a chart** — eight stat tiles (`PipelineBoard`) | Eight numbers you act on. A bar chart of them adds decoration, not meaning. |
| 2 · Cycle time per stage | Horizontal bar, **one series** (mean hours), with a thin p90 tick overlaid | Long stage names; ordered by the chain, never re-sorted by value — the order carries meaning |
| 3 · Rejection analysis | Horizontal bar (count) **plus a separate** bar for rate | Count and percentage are different units — see the dual-axis rule below |
| 4 · Weight variance | **Diverging** bar around a zero baseline | The data has polarity: over vs under delivery |
| 5 · Per-customer volume | Horizontal bar, single hue, **top 10 + "Other"** | 19 customers and growing; identity comes from the axis label, not from colour |
| 6 · Lab pass rate | 100 % stacked horizontal bar, **status palette** | Parts of a whole, and the parts are states |
| 7 · Delegation coverage | 100 % stacked horizontal bar, **sequential ramp** | primary → delegate → deputy is ordinal: increasing distance from the owner |
| 8 · My queue | **Not a chart** — a list | |

Plus two moved from the lab module, unchanged: the **control chart**
(`lab-trend-chart.tsx`, one series over time with the amber warning band) and the
**in-spec trend** (`lab-kpi-charts.tsx`, one line over time).

### Colour

**This system needs no categorical palette.** Every chart above is one series,
a status split, a sequential ramp, or a diverging pair. That is a deliberate
simplification, not an oversight — resist adding one.

**Status — pass / warning / fail.** Validated against a light surface
(`node scripts/validate_palette.js`, dataviz skill):

```
pass    #047857     warning  #f59e0b     fail  #b91c1c
```

All checks pass. One caveat the validator raised: **amber is 2.09 : 1 against the
surface**, below the 3 : 1 bar. That obligates relief — every amber segment
carries a visible label or the view offers a table. It is not dismissable.

> The obvious Tailwind choice `#16a34a / #d97706 / #dc2626` **fails**: red↔amber
> ΔE 14.4 in *normal* vision (floor is 15) and green↔amber ΔE 6.2 under
> protanopia. Do not substitute colours by eye — re-run the validator.

Status colours are **reserved**. They never become "series 3" on an unrelated
chart, and they always ship with an icon or label, never colour alone.

**Sequential — one hue, light to dark.** Blue, for magnitude and for the ordinal
coverage split:

```
#b7d3f6  →  #6da7ec  →  #2a78d6      (deputy → delegate → primary)
```

**Diverging — two poles and a neutral grey midpoint** for weight variance. Never
a hue at the midpoint, never a rainbow.

**Text wears text tokens, never the series colour.** Values, axis labels and
legends stay in slate ink; a small coloured swatch beside them carries identity.

### The rule most likely to be broken here

**Never a dual-axis chart.** Report 3 wants rejection *count* and rejection
*rate* together, and report 4 wants ordered kg beside variance %. Both are the
classic trap. Two measures of different scale become **two charts**, small
multiples, or one indexed to a common base — never two y-scales on one plot.

### Marks and interaction

Thin marks; 4 px rounded data-ends anchored to the baseline; 2 px lines;
markers ≥ 8 px; a 2 px surface gap between stacked segments and between adjacent
bars; recessive grid and axes. Selective direct labels — never a number on every
point.

Every chart ships a hover layer by default: crosshair + tooltip on the line
charts, per-mark tooltip on bars and cells. Hit targets larger than the mark.
Filters in one row above the charts, matching the list pages.

For two or more series a legend is always present; a single series needs none —
the title names it.

### RTL — charts mirror with the language (client decision)

**Every chart mirrors in Arabic.** The client has decided: Arabic reads
right-to-left everywhere, charts included; English reads left-to-right. Both
directions are first-class, and no chart is exempt.

Recharts does not mirror on its own — `dir="rtl"` reorders DOM, not an SVG plot.
Each chart takes an `isRtl` flag (`const { lang } = useLang(); const isRtl = lang === "ar";`)
and applies it:

| Element | Arabic |
|---|---|
| Value axis (`XAxis` on vertical-layout bars, time axis on lines) | `reversed={isRtl}` — bars grow right-to-left, time runs right-to-left |
| Category axis (`YAxis` on horizontal bars) | `orientation={isRtl ? "right" : "left"}` |
| Axis tick text | `textAnchor` flips: `isRtl ? "start" : "end"` |
| Direct labels on marks | anchored to the bar's growing end, so they flip with it |
| `Legend` | `align={isRtl ? "right" : "left"}` |
| Tooltip content | wrap in `dir={isRtl ? "rtl" : "ltr"}`; label first, value after |
| `ReferenceArea` / `ReferenceLine` (the control chart's warning band) | axis-driven — they follow automatically once the axes flip; verify, don't assume |
| Margins | swap `left` and `right` |

**Numerals stay Latin** (`1,250` not `١٬٢٥٠`) — the rest of the app formats
numbers that way, and mixing digit systems between the table and its chart is
worse than either choice alone.

Build the flag into a shared `useChartDirection()` hook rather than threading
`lang` through nine components, so no chart can be forgotten. The two charts
inherited from the lab module — `lab-trend-chart.tsx` and `lab-kpi-charts.tsx` —
are LTR-only today and **must be retrofitted** during the move (§5).

**Verification is visual and mandatory.** Every chart is screenshotted in both
languages during phase 10. The specific failures to look for: a bar chart whose
bars still grow left-to-right while its labels flipped; a time axis running
backwards relative to its tooltip; a legend overlapping the plot after the
alignment swap; and the control chart's warning band landing on the wrong side of
the series.

### Dark mode

The app is light-only, and the palette above is validated against a light surface
only. If dark mode is ever added, **re-step and re-validate against the dark
surface** — an automatic inversion is not a dark palette.

---

## 12. Seed

`src/scripts/seed.ts` — idempotent upsert on email, bcrypt cost **12** manually
(no pre-save hook), password `pass123`:

| email | role |
|---|---|
| `admin@gwmc.com` | `admin` |
| `sales.coord@gwmc.com` | `sales_coordinator` |
| `sales.manager@gwmc.com` | `sales_manager` |
| `finance@gwmc.com` | `finance_manager` |
| `accountant@gwmc.com` | `accountant` |
| `gm@gwmc.com` | `general_manager` |
| `tech.manager@gwmc.com` | `technical_manager` |
| `lab.tech@gwmc.com` | `lab_technician` |
| `weighbridge@gwmc.com` | `weighbridge` |

Plus `seed-lab.ts` (8 flour grades, 11 parameters, per-product Ash overrides —
**fix it to read `MONGODB_URI`**, it currently hardcodes), ~6 demo customers, and
a `--demo` flag generating ~30 orders spread across all 8 stages (4 rejected, 10
posted) so the reports render on day one.

---

## 13. Build phases

| # | Phase | Demonstrable at the end | Size |
|---|---|---|---|
| 0 | **Scaffold** — Next 16 app on :3001, Tailwind v4, shadcn, `proxy.ts`, split auth config **with the distinct cookie name**, own login page, `AppShell`/`Sidebar`/`Header`, own `User` + seed | Log in as each of the 9 users; the CMMS session on :3000 survives it | M |
| 1 | **Move the lab module** — models, libs, API (now guarded and validated), QC tabs, `seed-lab` | The full QC flow works in the new app against `gwmc_lab`; the CMMS `/lab` can be deleted | M |
| 2 | **Model + engine** — `SalesOrder`, `salesOrder.ts` allocator, `salesWorkflow.ts` | Scratch script: `visibilityFilter` correct for all 9 roles; `stageComplete` handles stage 7; concurrent creates yield `ORD-2026-000001/000002` | M |
| 3 | **CRUD API** | curl as each role — the full visibility matrix holds; pagination totals honour visibility | M |
| 4 | **Delegation & absence** — `Delegation`, absence fields, `authorityFor`, admin screens | Mark the finance manager absent → the accountant can see and approve stage 3; unmark → he loses it; a delegation stops working the day after it expires | M |
| 5 | **Transitions** — approve / reject / lab / weigh + audit on each | A whole order walked 1 → 8 → Posted; a stage-3 rejection freezes it and hides it downstream; two concurrent stage-7 approvals both succeed and advance exactly once; wrong role → 403; replay → 409 | M |
| 6 | **Orders list + create dialog** | A coordinator creates a multi-line order; totals match the server; the sales manager sees it, finance does not | L |
| 7 | **Detail page + ladder + actions** | Full eight-stage walkthrough in `en` **and** `ar`; RTL pass shows the rail on the correct side, no `ml-`/`mr-` anywhere; rejection renders the red terminal state | L |
| 8 | **Lab step wiring** — `LabStepDialog`, `/[id]/lab`, `orderId` both ways | The lab tech creates a sample against the ordered grade from inside the order; `labOverallStatus` rolls up | M |
| 9 | **Notifications** — SSE, fan-out to the next role, bell | Approving at stage 2 pushes to every active `finance_manager`; the click lands on the order | M |
| 10 | **Dashboard, reports & Excel** | All eight reports render against demo data and reconcile with the list counts | L |
| 11 | **Hardening** — `explain()` on the list query, concurrency soak, full Arabic/RTL review | `explain()` shows `IXSCAN` on every `$or` branch, not `COLLSCAN` | S |

Critical path: **0 → 2 → 3 → 4 → 5 → 7**. Phase 1 is independent and can run in
parallel; 8–10 depend only on 5.

---

## 14. Risks & decisions

1. **The shared cookie jar** (§1). Same domain + different port = same cookies.
   Distinct cookie names and distinct `AUTH_SECRET`, or the two apps log each
   other out. This is the single most likely thing to go wrong.
2. **Duplicate accounts.** Anyone who needs both systems — the admin, probably
   the technical manager — now has two logins and two passwords. Accepted cost of
   the split; say it out loud to the client rather than letting them discover it.
3. **Split notifications.** `sseClients` is per-process, so each app has its own
   bell. A user in both sees two independent notification streams.
4. **The moved lab routes are currently unguarded** (§5). Do not port them as-is.
5. **Fan-out is by role, and roles can be empty.** If nobody holds
   `finance_manager`, or all of them are inactive, an order parks at stage 3
   forever with nobody notified. Detect a zero-recipient fan-out and notify
   admins: *"No active user holds role X — order ORD-2026-000007 is stalled."*
6. **Roles are load-bearing here from day one.** Changing a user's role grants or
   revokes signing power. Warn on the role selector and audit every role change.
7. **`/api` is not covered by the proxy.** The visibility rule lives entirely in
   the API layer. Apply `visibilityFilter` *inside* the detail `findOne` so an
   unauthorized id returns the same 404 as a nonexistent one and doesn't leak
   existence.
8. **Editing after submission** is allowed only while `currentStageIndex === 2`.
   Anything looser lets a coordinator change quantities *after* finance signed
   off — the exact thing this system exists to prevent.
9. **`LabSample.finalDecision` vs stage 7.** Two overlapping sign-offs on the same
   data. Stage 7 signs off on the **order**; `finalDecision` signs off on the
   **sample**. Keep them separate.

### Open questions for the client — answer before phase 4

1. **Who deputises for the Technical Manager (5), the joint sign-off (7), and the
   weighbridge (8)?** The delegation note covered stages 1–4 and the lab only.
   Those three have no fallback, so an absent technical manager stops the order
   dead. **This one will bite first.**
2. **May one person hold two consecutive stages?** The rules allow it: the sales
   manager can create an order and then approve it himself; a coordinator
   covering an absent manager approves what he created. Blocking it would freeze
   the chain exactly when staffing is thin, so the plan permits it and marks it
   plainly on the ladder — but it should be a decision, not a side effect.
3. **Sales coordinators — own orders, or the whole department?** Currently
   `ownOnly`, so two coordinators cannot cover for each other. One flag either
   way, but it is a business call.
4. **Is 48 hours the right red line?** It drives the aging colour and the SLA
   report.

---

## 15. Verification

- **Engine (phase 2)** — a scratch `tsx` script exercising `visibilityFilter` for
  all 9 roles, `stageComplete` on stage 7 with one vs two approvals, and
  `actableStages` on a rejected order (must be empty).
- **API matrix (phases 3–5)** — curl as each seeded user: create as the
  coordinator, assert the sales manager sees it and finance gets 404 on the
  detail route; walk 2→8 asserting exactly the next role gains visibility each
  time; two parallel stage-7 approvals both 200 with `currentStageIndex` ending
  at 8 exactly once; reject at stage 3 and assert every downstream role gets 404
  and every transition endpoint 403.
- **Cookies** — log into the Lab System, then reload the CMMS in the same
  browser. **Both sessions must survive.** Do this on day one, not at the end.
- **UI (phases 6–8)** — `npm run dev`, `npm run seed -- --demo`. Walk an order end
  to end as each role in separate browser profiles. Then **switch to Arabic and
  repeat**: `grep -rn "\bml-\|\bmr-\|\bleft-\|\bright-" src/components/orders/`
  must come back clean.
- **Reports (phase 10)** — pipeline counts must sum to the unfiltered admin list
  total; rejection-rate denominators must equal
  `countDocuments({ currentStageIndex: { $gte: i } })`; the Excel row count must
  equal the on-screen `total`.
- **Always** — `npx tsc --noEmit` and `npm run build` before calling a phase done.

---

## 16. Portability — moving to another server, domain or IP

This app is designed to be relocatable: separate database, separate users,
separate repo, no runtime dependency on the CMMS. A move is **four environment
variables, one database copy, and one directory copy**. But two things must be
built correctly from day one, or the move gets expensive.

### What changes on a new host

```
MONGODB_URI=mongodb://<new-host>:27017/gwmc_lab?...
AUTH_URL=https://lab.example.com          # must match the real public origin
AUTH_SECRET=<unchanged — keep it, or every session is invalidated>
PORT=3001
```

Nothing else in the code should contain a hostname, an IP, or a port. Enforce
that: `grep -rn "localhost\|192\.168\.\|:300[01]" src/` must only ever hit
comments and defaults.

Two smaller items:

- **`next.config.ts`'s `allowedDevOrigins`** — the CMMS hardcodes LAN IPs
  (`192.168.1.15`, `192.168.1.4`). Read them from an env var instead.
- **`seed-lab.ts` hardcodes its connection string** in the CMMS. Fix it while
  moving (§5) or on a new server it will silently seed the wrong database.

### ⚠️ Trap 1 — attachments live on disk, not in the database

`labUpload.ts` writes QC files to `public/uploads/lab/<sampleId>/…` and lets
Next serve them statically. There is already **1.6 MB** of them in the CMMS.

Two consequences:

1. **`mongodump` does not carry them.** The database will restore with
   `LabSample.attachments[].url` pointing at files that do not exist. Nothing
   errors — the links just 404, and the loss is silent.
2. **`public/` is a build artifact.** Under `output: "standalone"`, a container,
   or any redeploy that rebuilds, anything written into `public/` at runtime is
   discarded.

**Build it differently from the start.** Do not port `labUpload.ts` as-is:

```ts
// Outside the app tree, so a rebuild or a container swap never touches it.
const UPLOAD_ROOT = process.env.UPLOAD_DIR || path.join(process.cwd(), "..", "gwmc-lab-uploads");
```

and serve files through a route handler — `GET /api/files/[...path]` — that
resolves under `UPLOAD_ROOT`, **verifies the resolved path is still inside it**
(`path.resolve(...).startsWith(UPLOAD_ROOT)`) before streaming, and requires a
session. That also closes a hole the CMMS version has: `deleteLabAttachmentFile`
builds its path from the stored `url` with only a leading-slash strip and no
containment check.

Then the move is `rsync -a $UPLOAD_DIR/ newhost:$UPLOAD_DIR/`, and a bind mount
survives every redeploy.

### ⚠️ Trap 2 — do not use the CMMS's custom dump/restore scripts

The CMMS has `npm run dump` / `npm run restore`, and they **corrupt every
ObjectId**. `dump.ts` uses `JSON.stringify`, which serialises an ObjectId as a
bare hex string with no `$oid` wrapper; `restore.ts` then inserts it back as a
BSON *string*. Mongoose casts query values to ObjectId by schema, so none of
those documents match any more — the signature symptom is **"User not found" for
a user you can plainly see in the collection**. There is a
`repair-objectid-types.ts` script in the CMMS that exists solely to clean up
after this.

Do not copy those scripts into this project. Use the real tools, which round-trip
BSON types correctly:

```bash
mongodump   --uri="mongodb://localhost:27017/gwmc_lab" --out=./backup
mongorestore --uri="mongodb://newhost:27017/gwmc_lab" --drop ./backup/gwmc_lab
```

After any restore, sanity-check before trusting it:

```bash
mongosh gwmc_lab --quiet --eval 'printjson(db.users.findOne({}, {_id:1, email:1}))'
# _id must print as ObjectId('…'), never as a plain quoted string
```

### HTTPS

On a real domain you will terminate TLS. Make the session cookie's `secure` flag
env-driven rather than hardcoded — `secure: process.env.NODE_ENV === "production"`
— because `secure: true` served over plain HTTP silently drops the cookie and
looks exactly like "login does nothing".

The distinct cookie name from §1 becomes unnecessary once the app has its own
domain, but **keep it anyway**: it costs nothing and it protects you if the two
apps are ever co-hosted again.

### What does not move well

**SSE notifications are single-process and in-memory** (`sseClients` on
`global`). This is fine on one server running one Node process. It breaks
silently — notifications simply stop arriving for some users — under PM2 cluster
mode, multiple replicas, or a load balancer without sticky sessions. If the new
server runs more than one instance, that registry has to move to Redis pub/sub
first. Decide this before scaling out, not after.

### Move checklist

1. `git clone` the repo, `npm ci`, set the four env vars.
2. `mongodump` / `mongorestore` the `gwmc_lab` database (real tools, not the
   custom scripts).
3. Verify an `_id` prints as `ObjectId('…')`, not a string.
4. `rsync` the `UPLOAD_DIR` directory.
5. `npm run build`, then start under a process manager (the CMMS has none — this
   project should ship a `Dockerfile` or a systemd unit from day one).
6. Log in as each seeded role; open one order with an attachment and confirm the
   file loads.

---

## 17. Initial customer list

Transcribed from the client's handwritten sheet (2026-09-05). **19 customers.**

> **Status: awaiting confirmation.** Roughly half the entries were legible with
> confidence; the rest are best-effort readings of difficult handwriting and are
> marked below. Do not seed the uncertain rows until the client has confirmed
> them — a misspelled customer name propagates into every order, every QC sample
> and every printed report, and is exactly what the merge tool in §10.1b exists
> to clean up after.

Confirmed:

1. خضر سالم وأولاده
2. خضر عاشور
3. مخبز بيت سيرا
4. مخبز أبو شوشة
5. مخبز البركة
6. مخبز البلد
7. شركة دواجن فلسطين
8. شركة خواجا

Awaiting confirmation (best reading first, alternatives in brackets):

9. شركة رسلان  [يسار / بسلان]
10. شركة أبو مشهب  [رمشهد]
11. السنديانة  [السندبانة — unclear whether prefixed مخبز]
12. مخبز الوله  [الولي / الولا]
13. مخبز إبراهيم العزي  [العربي]
14. مخبز حسنا  [حسونة]
15. مخبز بدران  [illegible]
16. مخبز أمينة  [أم نبيل]
17. مخبز أخينا سعد البلد  [longest and least certain line]
18. شركة دمشق للفاخر  [word order uncertain]
19. مدينة العهد للتجارة  [شركة العهد للتجارة]

Working assumption: the repeated leading word on rows 12–17 is **مخبز**
(bakery), not محمد — the plant's customers are bakeries, and بيت سيرا and
أبو شوشة are real place names. If that assumption is wrong, six rows change
together.

---

## 18. Before you start — open decisions, and what to do without an answer

Four decisions have been answered by the client and are already reflected
throughout the document — they are restated here so nothing is re-litigated
during the build. Three remain open, all with defaults, and **none of them blocks
any phase**.

#### Answered by the client — build to these

| # | Decision | Answer |
|---|---|---|
| 1 | Order number format | **`ORD-<year>-<6 digits>`** (`ORD-2026-000123`). Plus a user-entered **`referenceNo`** carrying the department's own number — optional, non-unique, searchable (§7) |
| 2 | Deputies for stages 5, 7, 8 | **None.** Nobody automatically stands in for the technical manager, the joint sign-off, or the weighbridge. Named delegation still works there; the stall must be made visible (§8.2) |
| 3 | One person holding two consecutive stages | **Allowed**, marked visibly on the ladder. No change from the default |
| 4 | RTL charts and pages | **Both mirror fully.** Arabic right-to-left, English left-to-right, charts included. No exemptions (§10.1, §11.1) |

#### Still open — defaults apply, none of them blocks

| # | Decision | Default | Blocks |
|---|---|---|---|
| 5 | **The 19 customer names** — 11 are uncertain readings of handwriting (§17) | Seed only the 8 confirmed names. Do not guess the rest into the database | Customer seeding only |
| 6 | **Sales coordinator visibility** — own orders or the whole department (§14) | `ownOnly: true`. One flag in `ROLE_FLAGS` either way | Nothing |
| 7 | **The 48-hour red line** on aging (§10.0) | 48 hours | Nothing |

### One environment blocker, not a decision

**MongoDB on `:27017` is currently not writable.** The Docker replica set `rs0`
keeps failing over to a node the host cannot resolve (`mongo-2`, then `mongo-3`),
and with `directConnection=true` the driver pins to the local secondary: reads
succeed, **every write fails** with `not primary (10107)`. Seed scripts print
correct-looking output and then throw at the very end.

You will hit this the first time you run a seed. Diagnose, do not debug your code:

```bash
mongosh --quiet --eval 'const h=db.hello(); print(h.isWritablePrimary, h.secondary, h.primary, h.me)'
```

**The permanent fix is §19.1: run MongoDB standalone.** Nothing in this system
uses a transaction, so the replica set buys nothing and costs you this failure
every time it fails over. For development right now, point `MONGODB_URI` at a
standalone `mongod` and move on.

### Deliberately out of scope — name them so they are not surprises

Three things a mill will ask for that this document does **not** cover. They are
excluded on purpose, not forgotten:

1. **A printable order sheet.** A controlled approval document usually ends up in
   a physical file, and the obvious request is "print the order with its
   signature chain". `jspdf` and `html2canvas` are already in the CMMS's
   dependencies if you want them — but do not add this until asked, and if you do,
   the printed sheet must show the same *"on behalf of"* wording as the ladder,
   and both the order number and the department's `referenceNo`, or the paper
   record will not reconcile with the ledger it came from.
2. **Email notifications.** The CMMS's `notifyAssigned` sends email alongside the
   in-app notification. The plant runs offline, so this system ships in-app + SSE
   only. If email is ever wanted, it needs a reachable SMTP host — an assumption
   this deployment does not currently satisfy.
3. **The lab instrument register** (`Lab Machines.xlsx`) — see §5.

### Suggested opening move

Read §0 → §5 first (what this is, how it deploys, the conventions to match, what
to copy). Then build phase 0 from §13. Do not start by writing the workflow
engine: the engine is easy and the conventions are what make this feel like one
product with the CMMS.

---

## 19. Production readiness

Sections 0–18 define *what to build*. This one defines *how it runs*, and it is
mandatory: neither this project nor the CMMS has any deployment tooling today —
no Dockerfile, no reverse proxy, no process supervision, no tests, no backups.
Phase 12 below closes that, and the system is not "done" until it passes §19.8.

### 19.1 Run MongoDB standalone — not a replica set

**Nothing in this system uses a multi-document transaction.** Verified: zero
`startSession` / `withTransaction` in the CMMS, and the atomic transitions in
§8.3 are deliberately built from single-document conditional updates precisely so
none is needed.

That matters, because the replica set currently running on `:27017` is the direct
cause of the `not primary` failures that have blocked seeding repeatedly: it
fails over to a node (`mongo-2`, `mongo-3`) that the host cannot resolve, and
with `directConnection=true` the driver pins to the local secondary — reads work,
every write throws.

**Run a standalone `mongod` for this system.** The failure class disappears
permanently, the URI loses `directConnection`, and nothing is given up. Only
reinstate a replica set if a future feature genuinely needs transactions or
change streams — and then size it so every member is resolvable from the app host.

### 19.2 Container image

`next.config.ts` must set `output: "standalone"` — it produces a self-contained
`.next/standalone` with only the packages actually imported, which is what keeps
the runtime image small and the copy step honest.

```dockerfile
# --- build ---
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- run ---
FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production PORT=3001
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
USER app
EXPOSE 3001
CMD ["node", "server.js"]
```

`.dockerignore` must exclude `node_modules`, `.next`, `.env*`, and the uploads
directory.

### 19.3 Compose

```yaml
services:
  mongo:
    image: mongo:6
    restart: unless-stopped
    volumes: [ "mongo-data:/data/db" ]
    # No port published to the host — only the app talks to it.

  app:
    build: .
    restart: unless-stopped
    depends_on: [ mongo ]
    environment:
      MONGODB_URI: mongodb://mongo:27017/gwmc_lab
      AUTH_URL: ${AUTH_URL}
      AUTH_SECRET: ${AUTH_SECRET}
    volumes:
      - "${UPLOAD_DIR}:/data/uploads"     # QC attachments — see §16
    ports: [ "3001:3001" ]

volumes:
  mongo-data:
```

`restart: unless-stopped` is the process supervision — no pm2 or systemd unit is
needed on top of it. **Do not publish Mongo's port**; nothing outside the compose
network has any business reaching it.

Ship a `.env.example` with every variable and no values. `.env` stays out of git.

### 19.4 TLS, honestly

The plant network is offline, so Let's Encrypt cannot issue a certificate — there
is no public DNS to validate against. Two workable options:

- **Plain HTTP on the LAN.** Acceptable only if the network is genuinely closed.
  Then `cookies.sessionToken.options.secure` **must stay false**, or the session
  cookie is dropped and login silently does nothing (§16).
- **nginx or Caddy with a self-signed certificate**, or one from an internal CA,
  installed on the client machines. Then set `secure: true`.

Decide before go-live and set the cookie flag to match. This is the single most
common cause of "login does nothing" in an offline deployment.

### 19.5 Backups — and a restore drill

```bash
#!/bin/sh
# /opt/gwmc-lab/backup.sh — cron: 0 2 * * *
set -e
STAMP=$(date +%F)
DEST=/backup/gwmc-lab/$STAMP
mkdir -p "$DEST"
docker compose exec -T mongo mongodump --db=gwmc_lab --archive > "$DEST/db.archive"
tar czf "$DEST/uploads.tgz" -C "$UPLOAD_DIR" .
find /backup/gwmc-lab -maxdepth 1 -type d -mtime +30 -exec rm -rf {} +
```

Both halves, always: the database alone restores an order whose attachments 404
(§16). Use `mongodump`/`mongorestore` — **never the CMMS's custom `dump`/`restore`
scripts**, which corrupt every ObjectId (§16).

**A backup you have not restored is not a backup.** Before go-live, restore into a
scratch database and confirm `db.users.findOne()._id` prints as `ObjectId('…')`
and not as a quoted string.

### 19.6 Automated tests

The CMMS has none, which is why its regressions are found by users. This project
ships a small suite — `vitest`, no framework beyond it — covering the parts where
a bug is silent and expensive:

| Test | Why |
|---|---|
| `visibilityFilter` for all 9 roles × the 8 stages | The whole confidentiality model. A wrong filter leaks orders and nobody notices. |
| `stageComplete` with one vs both stage-7 signatures | The joint gate is the rule most likely to be broken by a refactor |
| `authorityFor` — primary / delegate / deputy / none, absent and present | Authority is the point of the system |
| `actableStages` on a rejected order → empty | Rejection must be terminal |
| Order-number allocator under 20 concurrent creates | Race-safe by construction; prove it |
| Two simultaneous stage-7 approvals → advances exactly once | The hardest concurrency case in the app |
| `scoreResults` against `lab_rules.xlsx`'s Status column | The QC scoring must keep reproducing the QA workbook |

These are all pure functions or single-collection integration tests — fast, and
they need no browser. UI testing stays manual per §15; that trade is deliberate.

### 19.7 Seeding production

Production is **not** seeded with `--demo`. Run, in order:

1. `seed-lab` — the 8 grades, 11 parameters, per-product thresholds.
2. `seed-customers` — only the confirmed names (§17).
3. `seed-users` — real people, real emails, one account per person. Then
   **rotate every password**: the `pass123` default is for development only.
4. Nothing else. No sample orders, no test samples.

Verify before opening it up: log in as each of the nine roles and confirm each
lands on the right page and sees the right sidebar.

### 19.8 Go-live checklist

Do not open the system to users until every line passes.

- [ ] `npx tsc --noEmit` clean · `npm run build` succeeds · `vitest` green
- [ ] Mongo is standalone; a write succeeds (`db.users.updateOne(...)`)
- [ ] `.env` set: `MONGODB_URI`, `AUTH_URL` (real origin), a **fresh** `AUTH_SECRET`, `UPLOAD_DIR`
- [ ] Session cookie name is `gwmc-lab.*`, and its `secure` flag matches the TLS decision
- [ ] Logging into this system does not log the user out of the CMMS
- [ ] `UPLOAD_DIR` is a mounted volume outside the image; upload a file, redeploy, confirm it still loads
- [ ] Backup cron installed **and one restore rehearsed** into a scratch DB
- [ ] Production seed run; every default password rotated
- [ ] All nine roles logged in once; each lands correctly and sees only their own sidebar
- [ ] One complete order walked 1 → 8 → Posted **on the production instance**, in Arabic and in English
- [ ] One order rejected mid-chain; confirmed invisible downstream and closed
- [ ] The four open decisions in §18 answered, or their defaults accepted in writing
- [ ] A rollback path agreed: the previous image tag, and the last verified backup

### 19.9 Phase 12 — production hardening

Add to §13:

| # | Phase | Demonstrable at the end | Size |
|---|---|---|---|
| 12 | **Production** — standalone Mongo, Dockerfile, compose, TLS decision, backup cron + restore drill, vitest suite, production seed | Every box in §19.8 ticked, on the real server | M |

### What is still not guaranteed

The spec leaves nothing undefined, which is a different claim from "the build
will be bug-free". Expect visual iteration on the UI phases, expect the
concurrency tests to surface at least one ordering bug, and expect the lab
security rewrite (§5) to need care — it is the one place where working code is
being changed rather than written. Budget review time for those three.
