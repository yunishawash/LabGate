# LabGate — Software Requirements Specification
## Sales Order Approval Chain & Laboratory Quality Control System
### Golden Wheat Mills Company (GWMC)

| | |
|---|---|
| **Document type** | Software Requirements Specification / Business Analysis |
| **System name** | LabGate — نظام المختبر وسلسلة الموافقات |
| **Client** | Golden Wheat Mills Company (GWMC) |
| **Version** | 1.0 |
| **Date** | 15 September 2026 |
| **Status** | For business review |
| **Audience** | Business owners, department managers, QA management, project sponsor |

---

## 1. Executive Summary

LabGate is a web application that governs two things the mill currently runs on
paper and on trust: **who is allowed to release a customer order**, and **whether
the flour in that order meets specification**.

Today a sales order travels between desks as a paper form or a verbal approval.
Nobody can state, at a given moment, where an order is, who is holding it up, or
how long it has been sitting there. Separately, the laboratory records its test
results in spreadsheets that live on one machine, so quality history cannot be
linked to the customer who received the goods.

LabGate replaces both with one controlled process:

1. An order is raised by the sales department and walks a **fixed eight-stage
   approval chain** through Sales, Finance, General Management and Production.
2. At stage six the **laboratory records the quality test results** for the
   ordered flour grade, and the system judges each reading against the approved
   specification automatically — no manual interpretation.
3. Two managers **sign off on the results jointly** before the goods may leave.
4. The **weighbridge records the actual net weight**, the system calculates the
   variance against what was ordered, and the order is posted.

Every signature, rejection, delegation and edit is recorded permanently with the
name of the person and the capacity they acted in. Nothing in the chain can be
skipped, back-dated or reversed.

The system is **bilingual (Arabic / English)** with full right-to-left support,
runs on the plant's own server with no dependency on internet connectivity, and
is deliberately separate from the existing maintenance system (CMMS) in both
database and login.

---

## 2. Business Context

### 2.1 The organisation

Golden Wheat Mills is a flour milling operation that sells bagged flour in
several grades to bakeries, food companies and traders. Product is sold by the
bag (10, 25, 30, 50 or 60 kg) and delivered by truck across a weighbridge.

The company already operates an in-house **CMMS** (maintenance management
system) for plant equipment. LabGate is a **separate commercial and quality
system**; the two share a visual design and an IT platform but no data and no
user accounts.

### 2.2 The problem being solved

| # | Current pain | Business consequence |
|---|---|---|
| P1 | An order's approval status is not visible to anyone except the person holding it | Sales cannot answer a customer's "where is my order?"; management cannot see the pipeline |
| P2 | Approvals are given verbally or on paper, sometimes out of sequence | No defensible record of who authorised a shipment |
| P3 | Order quantities can be changed after a manager has approved them | Financial exposure — finance approves one figure and a different one ships |
| P4 | Lab results live in spreadsheets, judged by eye against a printed spec sheet | Inconsistent pass/fail calls; borderline results treated differently by different technicians |
| P5 | Quality history is not linked to the customer or the delivery | A customer complaint cannot be traced back to the batch and its readings |
| P6 | When a manager is absent, the order simply stops | Orders sit for days with nobody aware |
| P7 | Actual delivered weight is never compared to ordered weight in any system | Over- and under-delivery goes unquantified |
| P8 | No management reporting on cycle time, rejection reasons or quality trend | Improvement decisions are made on anecdote |

### 2.3 Business objectives

| # | Objective | How it is measured |
|---|---|---|
| O1 | Make the location and age of every live order visible to the people entitled to see it | Pipeline board shows count and tonnage at each of the eight stages, in real time |
| O2 | Guarantee an auditable authorisation trail for every released order | 100% of posted orders carry eight recorded, attributed signatures |
| O3 | Remove human judgement from routine pass/fail decisions | Every recorded reading carries a system-calculated verdict against the frozen specification |
| O4 | Link quality to the customer and the batch | Any customer's full quality history retrievable on one screen |
| O5 | Prevent quantity changes after financial approval | Editing is technically blocked beyond the first approval |
| O6 | Reduce time lost to absence | Deputy and delegation rules keep the chain moving; unstaffed roles are flagged before they block an order |
| O7 | Quantify delivery accuracy | Variance (ordered vs actual net weight) reported per customer and per product |
| O8 | Give management a weekly evidence base | Five standing reports plus Excel export |

### 2.4 Scope

**In scope**

- Sales order capture with multiple product lines
- The eight-stage approval chain, including rejection
- Absence marking and named delegation of signing authority
- Laboratory sample recording, automatic scoring, and attachments
- Product specification catalogue (parameters, limits, per-product overrides)
- Customer master data
- Joint (dual) sign-off on laboratory results
- Weighbridge net-weight capture, variance calculation and posting
- Role-composed dashboard, in-app notifications, five management reports
- Excel export, audit trail, user administration, system health
- Arabic / English interface, both directions

**Out of scope (deliberately excluded — see §12)**

- Printable / PDF order sheet with signature block
- Email or SMS notification
- Laboratory instrument register and calibration tracking
- Invoicing, pricing, credit control, accounts receivable
- Inventory, production planning, silo or stock management
- Truck, driver, gross and tare weight capture (net weight only, by client decision)
- Integration with the maintenance CMMS or any external ERP
- Mobile application (the system is responsive in a browser, but there is no native app)

---

## 3. Stakeholders and User Roles

The system recognises **nine roles**. A role is not a job title — it is a grant
of authority. Changing a person's role changes what they may sign, which is why
every role change is recorded in the audit trail.

| Role | Arabic | Primary responsibility in the system |
|---|---|---|
| **Administrator** | مدير النظام | Full access. Manages users, roles, permissions, delegations and the product catalogue. May act on any stage. |
| **Sales Coordinator** | منسّق المبيعات | Raises orders. Sees their own orders only. |
| **Sales Manager** | مدير المبيعات | Approves at stage 2. May also raise an order. Deputy for the coordinator. |
| **Finance Manager** | المدير المالي | Approves at stage 3. Deputy for the General Manager. |
| **Accounts Officer** | مسؤول الحسابات | Deputy for the Finance Manager only. No stage of their own. |
| **General Manager** | المدير العام | Approves at stage 4, co-signs the lab results at stage 7. Sees **every** order from the moment it is created, and may reject at any stage. |
| **Technical Manager** | المدير التقني | Approves at stage 5 (production feasibility), co-signs the lab results at stage 7. |
| **Lab Technician** | فني المختبر | Records laboratory results at stage 6, and records routine production QC samples not tied to any order. |
| **Weighbridge Operator** | مشغّل الميزان | Records the actual net weight at stage 8 and posts the order. |

**Secondary stakeholders:** QA management (consumes quality reports), IT /
system administrator (backup, deployment), external auditors (consume the audit
trail).

### 3.1 Module permissions

Beyond the role, each user carries a list of **module permissions** controlling
which screens they may open: Orders, Lab, Customers, Reports, Users, Audit
Trail, System Health. Administrators bypass the check. Dashboard, Approvals,
Results Sign-off, Rejections and Notifications are available to every signed-in
user.

This gives the business two independent levers: *what a person may sign* (role)
and *what a person may look at* (permissions).

---

## 4. The Core Business Process — The Eight-Stage Chain

### 4.1 The chain

| # | Stage | Arabic | Owner | Deputy (only while the owner is absent) | Nature |
|---|---|---|---|---|---|
| 1 | Order created | إنشاء الطلب | Sales Coordinator | Sales Manager, or a named delegate | Data entry |
| 2 | Sales Manager approval | مدير المبيعات | Sales Manager | Sales Coordinator | Approval |
| 3 | Finance Manager approval | المدير المالي | Finance Manager | Accounts Officer | Approval |
| 4 | General Manager approval | المدير العام | General Manager | Finance Manager | Approval |
| 5 | Technical Manager approval | المدير التقني | Technical Manager | **None** — business decision | Approval |
| 6 | Laboratory results | نتائج المختبر | Lab Technician | A named delegate | Data entry |
| 7 | Results sign-off — **both together** | اعتماد النتائج | General Manager **and** Technical Manager | **None** — business decision | Dual approval |
| 8 | Weighbridge and posting | الميزان والترحيل | Weighbridge Operator | **None** — business decision | Weigh → Posted |

Stages 5, 7 and 8 intentionally have no automatic deputy. The business decided
that an absent Technical Manager should **stall the order visibly** rather than
have the approval pass silently to someone else. The stall is surfaced on the
dashboard, the System Health screen and by notification to administrators.

### 4.2 Order lifecycle states

An order is in exactly one of three states:

- **In progress (Pending / قيد الإجراء)** — somewhere between stage 1 and stage 8
- **Posted (مرحّلة)** — completed stage 8; weighed and released
- **Rejected (مرفوضة)** — terminated by an approver; permanently closed

### 4.3 Process narrative

1. **Creation.** A Sales Coordinator (or the Sales Manager) selects a customer,
   an order date, an optional delivery date, and one or more **order lines**.
   Each line is a flour grade, a bag size and a bag count. The system calculates
   the line weight, the total bag count and the total tonnage — these are never
   accepted from the user. An optional **departmental reference number** records
   the order's number in the sales department's own records, so the two sets of
   books reconcile. The order is issued a permanent number in the form
   `ORD-2026-000123`. The chain immediately moves to stage 2.

2. **Commercial approval (stages 2–4).** Sales, Finance and the General Manager
   each approve in turn, optionally with a note. Nobody sees the order until the
   person before them has approved — **except the General Manager, who sees
   every order from creation**.

3. **Production approval (stage 5).** The Technical Manager confirms the mill
   can produce the grades and quantities ordered.

4. **Laboratory (stage 6).** The laboratory draws a sample against the ordered
   flour grade and enters the readings. The system compares each reading to the
   specification for that grade and returns a verdict per reading and an overall
   verdict for the sample. This stage is **data entry, not approval** — the lab
   records a fact; it does not authorise anything.

5. **Joint sign-off (stage 7).** The General Manager and the Technical Manager
   each sign the results. **This is a gate, not a race**: whoever signs first
   waits for the other, and the order does not advance until both signatures are
   recorded.

6. **Weighbridge and posting (stage 8).** The operator records the **actual net
   weight only** — no truck, driver, gross or tare. The system calculates the
   variance in kilograms and as a percentage of the ordered quantity, and posts
   the order in the same action, so an order can never be left weighed but
   unposted.

### 4.4 Rejection

Rejection is a first-class outcome, not an error path.

- Any approver may reject the order currently at their stage, **with a written
  reason** (mandatory).
- The **General Manager and the Administrator may reject at any stage**, whether
  or not the order is currently with them.
- **Rejection is terminal.** There is no return-to-edit and no resubmission. The
  order is closed and a new one must be raised. The reason, the stage, the
  person and the timestamp are kept permanently and feed the Rejections report.

The business reason for terminal rejection is traceability: an order that can be
edited and resubmitted has no single authoritative version, and the approvals
already collected against the old version become meaningless.

---

## 5. Business Rules

These are the rules the system enforces. They are stated here because they are
**business decisions**, not technical ones — each one can be changed, but only
deliberately.

### 5.1 Authority and visibility

| ID | Rule |
|---|---|
| **BR-01** | A user sees an order only once it has reached the earliest stage their role owns. Before that, the order does not exist for them — it does not appear in lists, counts, searches, reports or exports. |
| **BR-02** | The General Manager sees every order from the moment of creation. |
| **BR-03** | A Sales Coordinator sees only the orders they personally created — not those of other coordinators. *(Flagged as a business decision that may be reversed; see §13.)* |
| **BR-04** | Anyone who has ever acted on an order keeps read access to it permanently, even after a later change of role. |
| **BR-05** | A creator always sees their own orders, whatever their role. |
| **BR-06** | Only the owner of the current stage (or a valid deputy / delegate, or an administrator) may act on it. |
| **BR-07** | One person may legitimately hold two consecutive stages — e.g. the Sales Manager raises an order and then approves it. This is permitted so the chain does not freeze when staffing is thin, and it is shown plainly on the approval ladder. *(Business decision; see §13.)* |

### 5.2 Editing and integrity

| ID | Rule |
|---|---|
| **BR-08** | An order may be edited only by its creator or an administrator, and only while it is still at stage 2 — that is, **before the first approval**. After that it is frozen. |
| **BR-09** | All weights and totals are calculated by the system from bag size × bag count. A client-supplied total is never trusted. |
| **BR-10** | Bag sizes are restricted to 10, 25, 30, 50 and 60 kg. No other value is accepted. |
| **BR-11** | An order must have at least one line, and each line must have a bag count of at least one. |
| **BR-12** | The order number is allocated by the system, is unique, and cannot be edited. The departmental reference number is free text, optional, and deliberately **not** unique — it originates in a system the mill does not control, and refusing a repeat would block legitimate work. |
| **BR-13** | An order never moves backwards in the chain. Combined with terminal rejection, this guarantees the progress record is monotonic and therefore trustworthy. |

### 5.3 Absence and delegation

| ID | Rule |
|---|---|
| **BR-14** | A user may be marked **absent**, optionally with a date range and a note. Marking absence moves signing authority, so every change is audited. |
| **BR-15** | A **deputy** may act on a stage **only while no active, present user holds the owning role**. A deputy is not a second approver; the deputy route opens only when the desk is genuinely empty. |
| **BR-16** | A **delegation** is a deliberate hand-over of one role to one named person for a fixed period. Unlike a deputy, it works whether or not the primary is absent. |
| **BR-17** | A delegation **must have an end date**. A delegation without an expiry is a permanent transfer of authority by accident. |
| **BR-18** | A signature made by a deputy or a delegate is always recorded and displayed as *"on behalf of [role]"* — never as the primary's own signature. |
| **BR-19** | Creating, amending or revoking a delegation is audited exactly like an approval. |

### 5.4 Laboratory and quality

| ID | Rule |
|---|---|
| **BR-20** | Every measured value is judged automatically against the limits that apply to that product. The technician cannot set the verdict. |
| **BR-21** | The verdict has three levels: **In spec (مطابق)** — comfortably inside the accepted range; **Warning (تحذير)** — still inside, but within 15% of the range width of a limit; **Out of range (خارج النطاق)** — outside the accepted limits. The 15% warning band reproduces the QA department's existing workbook rule exactly. |
| **BR-22** | A sample is only as good as its worst reading: any out-of-range reading makes the whole sample out of range; otherwise any warning makes it a warning; otherwise it passes. |
| **BR-23** | The limits that applied **at the moment of testing are frozen onto the record**. If a specification is revised later, historical results keep the limits they were actually judged against. A QC record must remain historically accurate. |
| **BR-24** | A parameter may be *informational only* (e.g. Colour L*), in which case it is recorded and charted but never fails. |
| **BR-25** | Specifications are held at two levels: a **default limit per parameter**, and an optional **per-product override**. The override wins where one exists. |
| **BR-26** | A laboratory sample **does not require an order**. Routine production QC — shift sampling, batch lots, ad-hoc tests — is recorded without an order and is a full citizen in every list, chart, KPI and export. |
| **BR-27** | Beyond the automatic verdict, the Technical Manager (administrator-level) may record a separate **human decision** on a sample — accept a borderline failure with justification, or reject an otherwise-passing sample for other reasons. The two are kept distinct: the automatic verdict is the measurement, the decision is the judgement. |
| **BR-28** | Stage 7 signs off on the **order**; the sample decision signs off on the **sample**. They are deliberately separate records. |
| **BR-29** | Documents may be attached to a sample (certificate of analysis scan, sample photograph). Each attachment is individually removable. |

### 5.5 Customers

| ID | Rule |
|---|---|
| **BR-30** | Customer records are **plant-wide**, shared by the commercial and the quality sides. An order is placed *by* a customer and a sample is judged *for* one; both must point at the same record, or the "tonnage and quality per customer" view cannot exist. |
| **BR-31** | Duplicate customer names are refused. The comparison ignores case and extra spacing, so "Al Amal", "AL AMAL" and "Al  Amal" are one customer, not three. This is enforced by the database itself, not by a check that two simultaneous entries could both pass. |
| **BR-32** | Customers are created only by an administrator or the Sales Manager — never silently created by typing a new name into a form. Splitting a year of tonnage across three spellings of one bakery is the specific failure this prevents. |
| **BR-33** | A customer is **archived, never deleted**. Orders and samples carry the customer reference, so deletion would orphan a year of history. An archived customer disappears from every selection list — a new order against one is refused — while existing records keep their name. |
| **BR-34** | Restoring an archived customer is refused if the name has since been taken by another record, with an explanation rather than a technical error. |

### 5.6 Weighing

| ID | Rule |
|---|---|
| **BR-35** | Only the actual **net weight** is captured. Truck, driver, gross and tare are explicitly out of scope, by client decision. |
| **BR-36** | Variance is calculated by the system as actual minus ordered, both in kilograms and as a percentage of the ordered quantity. |
| **BR-37** | Weighing and posting happen in a single action. There is no intermediate "weighed but not posted" state. |
| **BR-38** | Orders beyond ±1% variance are listed as outliers in the variance report. |

### 5.7 Ageing and escalation

| ID | Rule |
|---|---|
| **BR-39** | An order waiting more than **24 hours** at one desk is shown in amber. |
| **BR-40** | An order waiting more than **48 hours** is shown in red and counted as *stuck*, on the dashboard alert strip, the pipeline board and the System Health screen. Two working days is the point at which a held order stops being "busy" and starts being "forgotten". |
| **BR-41** | Reports state real durations and never apply the threshold — the 24/48-hour line is a display rule for daily work, not a fact recorded in the data. |
| **BR-42** | If **no active user holds a role**, an order reaching that stage would park silently. The system detects this and notifies administrators by name of the missing role, e.g. *"No active user holds role Finance Manager — order ORD-2026-000007 is stalled."* |

---

## 6. Functional Requirements

### 6.1 Authentication and access

| ID | Requirement |
|---|---|
| FR-1.1 | Users sign in with an email address and a password. Passwords are stored hashed, never in readable form. |
| FR-1.2 | A deactivated user cannot sign in, and their session stops working immediately. |
| FR-1.3 | Every signed-in user lands on the dashboard; the dashboard content is assembled according to their role. |
| FR-1.4 | Attempting to open a screen the user lacks permission for redirects them rather than showing an error. |
| FR-1.5 | The system maintains its own user accounts and its own login, entirely separate from the maintenance CMMS. A person needing both systems holds two accounts. *(See §12, Risk R2.)* |

### 6.2 Order management

| ID | Requirement |
|---|---|
| FR-2.1 | Create an order: customer, order date, optional delivery date, optional departmental reference, optional notes, and one or more lines (product, bag size, bag count, optional line note). |
| FR-2.2 | The system allocates the order number, computes line weights, total bags and total tonnage. |
| FR-2.3 | Edit an order while it is still at stage 2, restricted to the creator or an administrator. |
| FR-2.4 | Orders Overview: a filterable, sortable, paginated list showing order number, customer, tonnage, current stage, waiting time and status. Filters include status, stage, customer, date range, free-text search and a "waiting on me" toggle. |
| FR-2.5 | Order detail screen showing the full line list, the totals, the approval ladder, the laboratory results, the weighing record and the action panel appropriate to the viewer. |
| FR-2.6 | **Approval ladder**: every stage in order, its owner, its status, who acted, when, in what capacity ("on behalf of…"), and any note. |
| FR-2.7 | **Action panel**: the viewer is shown only the actions they may actually take on this order right now — approve, reject, record results, sign off, or weigh. A read-only viewer sees no controls. |
| FR-2.8 | Approve with an optional note. |
| FR-2.9 | Reject with a mandatory reason. |
| FR-2.10 | Order history: the full audit entries for that order, on the order screen. |
| FR-2.11 | Archive an order (administrator only). Archiving is reversible removal from view, not deletion. |

### 6.3 Concurrency

| ID | Requirement |
|---|---|
| FR-3.1 | Two people acting on the same order at the same moment must not corrupt it. Each action asserts the state it depends on; the second action is refused with *"This order has already moved on — reload to see where it is."* |
| FR-3.2 | At the joint sign-off, two managers clicking approve within the same second is the **normal** case. Both signatures must be recorded; the order advances exactly once, when the second one lands. |

### 6.4 Laboratory

| ID | Requirement |
|---|---|
| FR-4.1 | Record a sample: product, date, shift (morning / afternoon / night), batch identifier, customer (optional), order (optional), and a value for each parameter in that product's specification. |
| FR-4.2 | As values are entered, the applicable limit, target and verdict are shown per parameter, and the overall verdict for the sample. |
| FR-4.3 | Sample numbers are allocated by the system in the form `LAB-2026-0001`. |
| FR-4.4 | Results list: filter by product, customer, verdict, shift, parameter and date range; full text search on sample and batch numbers. |
| FR-4.5 | Sample detail view showing every reading with its limits, its deviation from target and its verdict, the attachments, and the human decision if one has been recorded. |
| FR-4.6 | Edit a sample. Editing re-scores every reading through the same rules used at creation — a client-supplied verdict is never accepted on either path. |
| FR-4.7 | Attach and remove files on a sample. |
| FR-4.8 | Record the human accept / reject decision with a justification note (restricted). |
| FR-4.9 | **Control chart**: one parameter's readings over time, with the limit lines and the warning band drawn. |
| FR-4.10 | Record a sample directly against an order at stage 6, which links it to the order and advances the chain. |

### 6.5 Product specification catalogue

| ID | Requirement |
|---|---|
| FR-5.1 | Maintain the product list (flour grades), bilingual, with archive. |
| FR-5.2 | Maintain the parameter list: name, unit, comparison type (not more than / not less than / range / informational), default minimum, maximum and target, and display order. |
| FR-5.3 | Maintain per-product overrides of any parameter's limits. |
| FR-5.4 | A product-centric specification screen showing, for one product, every parameter with its effective limits and whether that limit is a default or an override. |
| FR-5.5 | The catalogue ships pre-loaded with the mill's **8 flour grades** (WFP, 302, 305, Bab 1, Bab 2, Sanabel, Fakher, Super) and **11 parameters**: Moisture, Protein, Wet Gluten, Gluten Index, Falling Number, Water Absorption, Ash, Zeleny, Damaged Starch, Colour L*, and Energy (W). |

### 6.6 Customers

| ID | Requirement |
|---|---|
| FR-6.1 | Maintain customers: name (English and Arabic), customer code, phone, contact name, address, notes. |
| FR-6.2 | Create, edit, archive and restore, restricted to administrator and Sales Manager. |
| FR-6.3 | Customer list with search and an archived / active filter. |
| FR-6.4 | **Customer profile screen** combining the commercial and the quality view of one customer: order count, tonnage ordered, posted and rejected, average cycle time, rejection rate, and that customer's full laboratory quality history with in-spec percentage. |

### 6.7 Absence and delegation

| ID | Requirement |
|---|---|
| FR-7.1 | Mark a user absent or present, with an optional date range and a note. |
| FR-7.2 | Create a delegation: role, recipient, start date, mandatory end date, reason. |
| FR-7.3 | List delegations currently in force and revoke one. |
| FR-7.4 | The coverage picture — who is away, who is covering, and which stages are uncovered — is visible on the dashboard for every role. |

### 6.8 Notifications

| ID | Requirement |
|---|---|
| FR-8.1 | In-app notifications, delivered live without a page refresh, with an unread badge in the header. |
| FR-8.2 | Notification types: **an order is waiting for your approval**, **an order was rejected**, **an order was posted**, **an order is stalled** (to administrators), and **a laboratory sample failed**. |
| FR-8.3 | Notifications are written in both languages at the moment they are raised, and displayed in the reader's chosen language. |
| FR-8.4 | A notification links directly to the order or the sample it concerns. |
| FR-8.5 | Mark one or all notifications as read; delete a notification. |
| FR-8.6 | When the fan-out for a stage finds **no recipient at all**, administrators are notified instead. Silence is the worst possible outcome. |

### 6.9 Dashboard

The dashboard is **composed per role** — nine roles doing nine different jobs do
not share one screen. Available blocks:

| Block | Shows |
|---|---|
| Waiting on you | The orders this person must act on now, oldest first, with an ageing clock |
| My orders | Orders this person created and their current position |
| The whole chain | Count and tonnage at each of the eight stages |
| Stuck | Orders held more than 48 hours, as an alert strip |
| This month | Orders and tonnage raised and posted this month |
| Lab queue | Orders waiting for laboratory results |
| Quality | In-spec percentage and recent failures |
| Ready to weigh | Orders that have cleared sign-off |
| Coverage | Delegations and absences in force today |
| Volume trend | Tonnage by month over 12 months, with the rejection rate overlaid |
| Quality trend | In-spec percentage by month over 12 months |
| Product mix | Share of tonnage by product over 12 months |

Assignment by role:

| Role | Blocks |
|---|---|
| Sales Coordinator | My orders · Waiting on you · Coverage |
| Sales Manager | Waiting on you · This month · My orders · Coverage |
| Finance Manager | Waiting on you · This month · Coverage |
| Accounts Officer | Waiting on you · Coverage |
| General Manager | Stuck · The whole chain · Waiting on you · This month · Quality · Volume trend · Quality trend · Product mix · Coverage |
| Technical Manager | Waiting on you · Lab queue · Quality · Quality trend · Coverage |
| Lab Technician | Lab queue · Quality · Coverage |
| Weighbridge | Ready to weigh · Coverage |
| Administrator | Stuck · The whole chain · This month · Volume trend · Quality trend · Product mix · Coverage |

### 6.10 Working queues

Three dedicated screens beyond the dashboard, available to every signed-in user
and showing only what is theirs to act on:

- **Approvals (الاعتمادات)** — orders awaiting this person's approval
- **Results Sign-off (اعتماد النتائج)** — orders at stage 7 awaiting this person's signature
- **Rejections (المرفوضة)** — rejected orders visible to this person, with reasons

Each carries a live count badge in the navigation.

### 6.11 Administration

| ID | Requirement |
|---|---|
| FR-11.1 | Create, edit and deactivate users; set name (both languages), email, password, role and module permissions. |
| FR-11.2 | The role selector carries a visible warning that changing a role changes signing authority. |
| FR-11.3 | **Audit Trail** screen: a searchable record of every change, filterable by entity type, entity, person, action and date. Each entry records what changed, from what to what, by whom, and when. |
| FR-11.4 | **System Health** screen: database connectivity, order and sample counts, orders held over 48 hours, and — most importantly — **which chain roles currently have nobody active behind them**. |

---

## 7. Reporting

Five standing management reports, plus Excel export. Every report respects the
same visibility rules as the screens — a report is simply another way of reading
what the user is already entitled to see.

| # | Report | Business question answered | Presentation |
|---|---|---|---|
| R1 | **Pipeline and ageing** | Where is everything, and what is stuck? | Eight stat tiles: count, tonnage, oldest item and average wait per stage |
| R2 | **Cycle time and bottleneck** | Which desk is slow, and which person? | Average, 90th-percentile and maximum hours per stage, plus a per-person breakdown within each stage |
| R3 | **Rejection analysis** | Why do orders die, and where? | Count and tonnage lost per stage, with the reasons and the rejectors, plus a rejection *rate* per stage |
| R4 | **Ordered vs actual weight variance** | How accurate are our deliveries? | Variance by customer and by product, plus an outlier list beyond ±1% |
| R5 | **Per-customer volume and quality** | Which customers matter, and are we serving them well? | Orders, tonnage ordered / posted / rejected, average cycle time, rejection rate, alongside that customer's quality history |
| R6 | **Laboratory pass rate** | What proportion of production meets specification? | In-spec / warning / out-of-range split, overall and per customer and product |
| R7 | **Delegation and absence coverage** | How much of the chain is being signed by stand-ins? | Signatures grouped by capacity (primary / delegate / deputy), per stage and per person |
| R8 | **My queue / SLA breaches** | What must I deal with first? | Not a chart — the working list, oldest first, with a red badge |

**Why R2 matters commercially:** the system records not only when a person
signed, but when the order *arrived* at their desk. Without that distinction a
slow approver at stage 5 looks identical to a slow one at stage 2. This is the
measurement that turns "orders take too long" into a named, actionable finding.

**Quality KPIs.** Separately from the order reports, the laboratory screen
provides per-product-per-parameter KPIs: number of readings, average, standard
deviation, **coefficient of variation (CV%)**, minimum and maximum recorded,
in-spec percentage, and a combined rating:

- **Excellent** — 95% or more in spec, and CV below 5%
- **Good** — 85% or more in spec, and CV at or below 10%
- **Needs attention** — anything else

These thresholds are taken from the QA department's existing workbook colour
legend, so the figures are directly comparable to what QA already reports.

**Excel export.** Four workbooks — Orders, Pipeline, Cycle time, and Laboratory
— in either language, with status colour-coding. The export applies the same
visibility rules as the screens; it does not hand over in one file what the
approval chain spends eight stages protecting.

---

## 8. Information Model (business view)

| Entity | What it represents | Key facts held |
|---|---|---|
| **Sales Order** | One customer order through the chain | Order number, departmental reference, customer, dates, lines, totals, status, current stage, the eight signature slots, rejection record, linked samples, weighing record |
| **Order Line** | One product on an order | Product, bag size, bag count, calculated weight, note |
| **Signature Slot** | One actionable point in the chain | Stage, owning role, status, when it became actionable, who acted, when, in what capacity, on behalf of which role, note |
| **Laboratory Sample** | One set of test readings | Sample number, optional order, product, customer, date, shift, batch, tester, readings, overall verdict, attachments, human decision |
| **Reading** | One measured parameter | Parameter, unit, value, comparison type, the limits **as frozen at test time**, target, deviation from target, verdict |
| **Product** | A flour grade | Name (both languages), active flag |
| **Parameter** | A measurable quality characteristic | Name (both languages), unit, comparison type, default limits and target, display order |
| **Specification Override** | A product-specific limit | Product, parameter, min, max, target |
| **Customer** | A buyer | Name (both languages), code, contact details, active flag |
| **User** | A person with access | Name (both languages), email, role, module permissions, active flag, absence state |
| **Delegation** | A temporary transfer of signing authority | Role, from, to, period, reason |
| **Audit Entry** | One recorded change | Entity, label, action, field, old value, new value, person, timestamp |
| **Notification** | One alert to one person | Type, title and message in both languages, link, read state |

Names of customers and products are **copied onto the order and the sample at
the moment of writing**. If a customer is later renamed, historical documents
keep the name that was actually used at the time — the same principle as
freezing the specification onto a test result.

---

## 9. Non-Functional Requirements

### 9.1 Language and localisation

| ID | Requirement |
|---|---|
| NFR-1.1 | Every screen, label, message, notification and export is available in **Arabic and English**. |
| NFR-1.2 | Arabic is **Modern Standard Arabic**, not colloquial. |
| NFR-1.3 | The entire interface mirrors right-to-left in Arabic, including tables, forms, navigation and **charts** — a client decision. |
| NFR-1.4 | Language is switched from the header and applies immediately, without signing out. |

### 9.2 Usability

| ID | Requirement |
|---|---|
| NFR-2.1 | A user is shown only the actions they may actually take. Controls the user cannot use are not displayed disabled — they are absent. |
| NFR-2.2 | Colour is never the only carrier of meaning. Every status colour ships with a label or an icon, for colour-blind users and for printing. |
| NFR-2.3 | Waiting time is shown as an ageing clock that updates without reloading. |
| NFR-2.4 | Refusals explain themselves in business language ("This order is closed", "This order has already moved on — reload to see where it is"), not in technical terms. |
| NFR-2.5 | The interface is usable on a tablet as well as a desktop. |

### 9.3 Security

| ID | Requirement |
|---|---|
| NFR-3.1 | No screen and no data endpoint is reachable without signing in. |
| NFR-3.2 | The visibility rule is enforced on the server for every read path — list, detail, report and export alike. Requesting an order the user may not see returns "not found", identical to a genuinely nonexistent one, so the system does not leak the existence of orders it then refuses to show. |
| NFR-3.3 | Passwords are hashed; no password is recoverable, only resettable. |
| NFR-3.4 | Uploaded files are served through a controlled path with a containment check, so no path can escape the upload directory. |
| NFR-3.5 | A user cannot elevate their own role or permissions. |
| NFR-3.6 | Every change to a role, a permission, an absence or a delegation is audited, because each one moves authority. |

### 9.4 Integrity and availability

| ID | Requirement |
|---|---|
| NFR-4.1 | Simultaneous actions on the same order cannot corrupt it (see FR-3.1). |
| NFR-4.2 | Order and sample numbers are unique under concurrent creation. |
| NFR-4.3 | The system runs entirely on the plant's own server and does not require internet connectivity for any function. |
| NFR-4.4 | Nightly automated database backup, with a documented and rehearsed restore procedure. |
| NFR-4.5 | Uploaded files are held outside the application directory so that a redeployment cannot delete them, and they are included in the backup. |
| NFR-4.6 | The application restarts automatically after a server reboot. |

### 9.5 Auditability

| ID | Requirement |
|---|---|
| NFR-5.1 | Nothing in the approval chain can be edited or back-dated after the fact. |
| NFR-5.2 | The audit record is append-only and retained indefinitely. |
| NFR-5.3 | Archiving rather than deletion is the rule for customers, orders, products, parameters and users. No business record is ever destroyed. |

### 9.6 Performance

| ID | Requirement |
|---|---|
| NFR-6.1 | List screens page their results; totals reflect what the user may actually see. |
| NFR-6.2 | The daily working screens respond within about two seconds on the plant network. |
| NFR-6.3 | Reports are read weekly by a small number of managers, not continuously by everyone — they are permitted to be slower than the working screens. |

---

## 10. Assumptions

| # | Assumption |
|---|---|
| A1 | The plant has a server that is on whenever the mill is working, and all users reach it over the local network. |
| A2 | There is no reachable outbound mail server, so notification is in-app only. |
| A3 | Every person in the chain has their own account. Shared logins would destroy the value of the audit trail. |
| A4 | Each of the eight stages is staffed by at least one active user. Where it is not, the system flags it, but it cannot invent an approver. |
| A5 | The laboratory has the instruments to measure the eleven parameters listed, and the QA specification limits are agreed and stable. |
| A6 | Bag sizes are limited to the five listed. A new bag size is a change request. |
| A7 | The mill sells in bags. Bulk sales, if they exist, are not represented. |
| A8 | The initial customer list (19 names, transcribed from a handwritten sheet) will be entered and verified by the Sales department through the Customers screen rather than loaded blind. |

---

## 11. Constraints

| # | Constraint |
|---|---|
| C1 | The system is deployed alongside the existing maintenance CMMS on the same host. The two are separate applications with separate databases, separate logins and separate notification streams. |
| C2 | Users who need both systems hold two accounts and two passwords. This is an accepted cost of keeping the two systems independent. |
| C3 | The system operates offline-first; any future feature requiring external connectivity (email, SMS, cloud backup) is a change of assumption, not just a feature. |
| C4 | The laboratory module is moved out of the CMMS into this system and removed from the CMMS. It cannot run in both. |

---

## 12. Out of Scope — Named Explicitly

These are the things a mill will reasonably ask for and which this release does
**not** include. They are excluded on purpose, not forgotten:

1. **A printable order sheet.** A controlled approval document usually ends up
   in a physical file, and "print the order with its signature chain" is the
   obvious next request. If it is added, the printed sheet must show the same
   *"on behalf of"* wording as the on-screen ladder, and must carry both the
   system order number and the departmental reference — otherwise the paper
   record will not reconcile with the ledger it came from.
2. **Email and SMS notification.** The plant runs offline; this release ships
   in-app notification only. Email would require a reachable mail server, which
   this deployment does not have.
3. **The laboratory instrument register** — instruments, calibration dates and
   calibration certificates.
4. **Invoicing, pricing and credit control.** LabGate authorises a release; it
   does not price it or collect for it.
5. **Inventory and production planning.**
6. **Truck, driver, gross and tare weights.**

---

## 13. Open Business Decisions

These require a decision from the business. Each is a one-line change in the
system, but each is a business call, not a technical one.

| # | Decision required | Current position | Why it matters |
|---|---|---|---|
| D1 | **Who covers the Technical Manager (stage 5), the joint sign-off (stage 7) and the weighbridge (stage 8) when they are away?** | No automatic deputy — the order stalls visibly | This is the one that will bite first. An absent Technical Manager stops every order in the plant. |
| D2 | **May one person hold two consecutive stages?** | Permitted, and marked plainly on the ladder | Forbidding it would freeze the chain exactly when staffing is thin; permitting it weakens separation of duties. It should be a decision, not a side effect. |
| D3 | **Should Sales Coordinators see each other's orders, or only their own?** | Own orders only | As it stands, two coordinators cannot cover for each other. |
| D4 | **Is 48 hours the right escalation line?** | 48 hours red, 24 hours amber | Drives the ageing colours, the "stuck" alert and the SLA report. |
| D5 | **Confirmation of the 19 customer names**, eleven of which were transcribed from difficult handwriting | Customers screen provides full add / edit / archive / restore, so the names can be corrected in the system rather than guessed up front | A misspelled customer name propagates into every order, every sample and every report |

---

## 14. Risks

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | A stage is left unstaffed (nobody active holds the role) | Orders park at that stage silently and indefinitely | Detected automatically; administrators notified by name of the missing role; permanently visible on the System Health screen |
| R2 | Duplicate accounts between LabGate and the CMMS | User confusion, forgotten passwords | Stated openly to the business rather than discovered; both logins documented |
| R3 | Two independent notification streams (one per system) | A user in both systems sees two bells | Accepted; documented |
| R4 | Roles carry real authority from day one — a careless role change grants or revokes signing power | Unauthorised approvals | Warning on the role selector; every role change audited |
| R5 | Terminal rejection means a mis-click cannot be undone | A legitimate order must be re-entered | Rejection requires a written reason and a confirmation step; the rejected order and its reason remain visible |
| R6 | Specification changes could retroactively invalidate historic verdicts | Quality history becomes unreadable | Limits are frozen onto each reading at test time (BR-23) |
| R7 | Customer name duplication splits reporting | Tonnage and quality reports understate a customer | Enforced de-duplication (BR-31) and restricted creation (BR-32) |
| R8 | Uploaded files are held on disk, not in the database | A server move could lose them | Files held outside the application directory and included in the backup; move procedure documented |

---

## 15. Acceptance Criteria

The system is accepted when the business can demonstrate, on the live system:

1. An order raised by a coordinator is **invisible** to Finance until Sales has approved it, and **visible** to the General Manager from the moment it is created.
2. An order **cannot be edited** once the Sales Manager has approved it, by anyone other than an administrator, and not at all after stage 2.
3. A rejection at any stage **closes the order permanently**, records the reason and the rejector, and appears in the Rejections report.
4. A laboratory reading entered outside its limit is judged **out of range automatically**, and a reading near the limit is judged a **warning**, with no technician input.
5. A specification changed *after* a test was recorded **does not alter that test's verdict**.
6. Stage 7 does **not** advance on one signature and **does** advance on the second, including when both are given within the same second.
7. The weighbridge entry produces a variance in kilograms and per cent and posts the order in one action.
8. Marking the Finance Manager absent allows the Accounts Officer to approve stage 3, and the signature reads *"on behalf of Finance Manager"*.
9. Deactivating every Finance Manager produces a stall notification to administrators and an unstaffed-role warning on System Health.
10. The entire interface, including charts, mirrors correctly in Arabic.
11. Excel export of orders contains only the orders the exporting user is entitled to see.
12. The audit trail shows, for one chosen order, every action from creation to posting with names and timestamps.

---

## 16. Glossary

| Term | Arabic | Meaning |
|---|---|---|
| Approval chain | سلسلة الموافقات | The fixed eight-stage sequence every order must complete |
| Stage | مرحلة | One step of the chain, owned by one role |
| Posted | مرحّلة | The order has completed stage 8 and is released |
| Rejected | مرفوضة | The order was terminated by an approver; permanently closed |
| Deputy | النائب | A role written into the chain that may act **only** while the owning role is absent |
| Delegate | المفوَّض | A named person given one role's authority for a fixed period, by deliberate hand-over |
| On behalf of | بالنيابة عن | The wording on any signature made by a deputy or a delegate |
| Sample | عيّنة | One set of laboratory readings on one batch of one product |
| Parameter | معيار | One measurable quality characteristic, e.g. Moisture, Protein, Ash |
| Specification | مواصفة | The limits a parameter must satisfy for a given product |
| In spec | مطابق | The reading is comfortably within the accepted range |
| Warning | تحذير | The reading is inside the range but within 15% of the range width of a limit |
| Out of range | خارج النطاق | The reading is outside the accepted limits |
| Batch | الدفعة | The physical lot a sample was drawn from |
| Shift | الوردية | Morning, afternoon or night production shift |
| Variance | الفرق | Actual net weight minus ordered weight, in kg and as a percentage |
| CV% | معامل الاختلاف | Coefficient of variation — a measure of process consistency; lower is better |
| In-spec % | نسبة المطابقة | Proportion of readings that met specification |
| Stuck | متوقفة | An order held at one desk for more than 48 hours |
| Departmental reference | الرقم المرجعي | The sales department's own order number, recorded for reconciliation |
| Audit trail | سجل التدقيق | The permanent, append-only record of every change |

---

*End of document.*
