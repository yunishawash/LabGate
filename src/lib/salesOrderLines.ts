import LabProduct from "@/models/LabProduct";
import { badRequest, oid, strictStr, badStrictStr } from "@/lib/apiHelpers";
import { BAG_WEIGHTS, LINE_PACKAGING, type LinePackaging } from "@/types";

/**
 * Validating and totalling an order's lines, in ONE place.
 *
 * This logic lived twice — once in `POST /api/orders`, once in
 * `PUT /api/orders/[id]` — as two near-identical forty-line blocks. That was
 * tolerable while a line was "a sack size times a count". It stopped being
 * tolerable the moment lines gained a second shape (bulk) and the order gained
 * a rule that spans every line at once (no mixing tested and untested
 * products): three new rules duplicated across two routes is six places for
 * them to drift, and a drift here means the create path and the edit path
 * disagree about what a legal order is.
 */

/** The whitelisted shape a client may send for one line. */
interface RawLine {
  productId?: unknown;
  packaging?: unknown;
  bagWeightKg?: unknown;
  bagCount?: unknown;
  /** Bulk only: the ordered weight in TONNES, as the person typed it. */
  weightTons?: unknown;
  note?: unknown;
  bonusBags?: unknown;
}

export interface BuiltLines {
  lines: Record<string, unknown>[];
  totalBags: number;
  totalWeightKg: number;
  totalBonusBags: number;
  totalBonusWeightKg: number;
  /** Derived from the products, never from the client. */
  labRequired: boolean;
}

/** `error` is a ready-to-return NextResponse; the two are mutually exclusive. */
export type BuildLinesResult =
  | { ok: true; value: BuiltLines }
  | { ok: false; error: ReturnType<typeof badRequest> };

const MAX_LINES = 50;
/** 200 t on one line. A real truck is ~30 t; this only stops a typo like
 *  "5000" from being stored as five thousand tonnes. */
const MAX_BULK_TONS = 200;

/**
 * Validate every line, resolve its product, and compute the totals.
 *
 * Weights are computed HERE and never read from the client — the same rule the
 * lab applies to a scored result. For a bagged line that means
 * `bagWeightKg × bagCount`; for a bulk line the client does supply the weight,
 * because there is nothing to derive it from, but it is still range-checked
 * and rounded rather than trusted as given.
 */
export async function buildOrderLines(rawLines: unknown): Promise<BuildLinesResult> {
  const rows = Array.isArray(rawLines) ? rawLines : [];
  if (!rows.length) return { ok: false, error: badRequest("An order needs at least one line") };
  if (rows.length > MAX_LINES) {
    return { ok: false, error: badRequest(`An order cannot have more than ${MAX_LINES} lines`) };
  }

  /**
   * Which of the submitted products are types with grades under them, in ONE
   * query for the whole order rather than one per line. The loop below already
   * costs a round trip per line to resolve the product itself; a second would
   * double that for a fifty-line order to answer a question that is the same
   * shape for all of them.
   */
  const submittedIds = rows
    .map((raw) => oid((raw as RawLine)?.productId))
    .filter((v): v is NonNullable<typeof v> => v !== null);
  const typesWithGrades = new Set(
    (
      await LabProduct.find({ parentId: { $in: submittedIds }, isActive: true })
        .distinct("parentId")
    ).map(String)
  );

  const lines: Record<string, unknown>[] = [];
  let totalBags = 0;
  let totalWeightKg = 0;
  let totalBonusBags = 0;
  let totalBonusWeightKg = 0;

  /**
   * Collected per line, checked once at the end. An order may not mix a
   * lab-tested product with an untested one, so this has to be a judgement
   * about the whole set — which is exactly why it cannot live inside the loop
   * the way every other rule here does.
   */
  const testedNames: string[] = [];
  const untestedNames: string[] = [];

  for (const raw of rows) {
    const row = (raw ?? {}) as RawLine;

    const productId = oid(row.productId);
    if (!productId) return { ok: false, error: badRequest("Every line needs a valid productId") };

    const product = (await LabProduct.findOne({ _id: productId, isActive: true })
      .select("name nameAr orderRequiresLabTest")
      .lean()) as { name?: string; nameAr?: string; orderRequiresLabTest?: boolean } | null;
    if (!product) return { ok: false, error: badRequest("Unknown product on one of the lines") };

    /**
     * A product TYPE that has grades is a category, not something the
     * warehouse can fill: you order Super, not "flour". The picker only offers
     * leaves, so reaching here means a stale list, a direct API call, or a
     * grade added under this type after the dialog was opened — all three
     * deserve the real reason rather than "unknown product".
     */
    if (typesWithGrades.has(String(productId))) {
      return {
        ok: false,
        error: badRequest(
          `"${product.nameAr || product.name}" is a product type, not a grade — choose one of its grades.`
        ),
      };
    }

    // Defaults to true for a product saved before the flag existed — the same
    // stricter-by-default choice the schema makes, for the same reason.
    const tested = product.orderRequiresLabTest !== false;
    const label = product.nameAr || product.name || "—";
    (tested ? testedNames : untestedNames).push(label);

    /**
     * An absent `packaging` means `bagged`. Every order raised before bulk
     * existed omits the field, and an edit that touches only a bag count must
     * not silently turn the line into a bulk load. A value that is present
     * but unrecognised is rejected rather than defaulted — a typo'd packaging
     * would otherwise ship as sacks.
     */
    const given = row.packaging;
    const blank = given === undefined || given === null || given === "";
    if (!blank && !(LINE_PACKAGING as readonly unknown[]).includes(given)) {
      return { ok: false, error: badRequest(`Packaging must be one of ${LINE_PACKAGING.join(", ")}`) };
    }
    const packaging: LinePackaging = blank ? "bagged" : (given as LinePackaging);

    const noteCheck = strictStr(row.note, 500, "Line note");
    if (!noteCheck.ok) return { ok: false, error: badStrictStr(noteCheck) };

    let bagWeightKg: number | null = null;
    let bagCount: number | null = null;
    let lineWeightKg: number;
    let bonusBags = 0;

    if (packaging === "bulk") {
      /**
       * Nothing to count, so the weight IS the quantity.
       *
       * Entered in TONNES, because that is the unit the mill sells and talks
       * in — a bulk load is "thirty tonnes", never "thirty thousand
       * kilograms". Stored in kilograms like every other weight in the
       * system, so the variance maths, the reports, the exports and the
       * scale reading all keep comparing like with like. The conversion
       * happens here, at the edge, exactly once.
       *
       * Three decimals of a tonne is one kilogram, so nothing is lost.
       */
      const tons = Number(row.weightTons);
      if (!Number.isFinite(tons) || tons <= 0) {
        return { ok: false, error: badRequest("A bulk line needs a positive weight in tonnes") };
      }
      if (tons > MAX_BULK_TONS) {
        return { ok: false, error: badRequest(`A bulk line cannot exceed ${MAX_BULK_TONS} t — check the figure`) };
      }
      lineWeightKg = Math.round(tons * 1000 * 1000) / 1000;
    } else {
      bagWeightKg = Number(row.bagWeightKg);
      if (!(BAG_WEIGHTS as readonly number[]).includes(bagWeightKg)) {
        return { ok: false, error: badRequest(`Bag weight must be one of ${BAG_WEIGHTS.join(", ")} kg`) };
      }

      bagCount = Number(row.bagCount);
      if (!Number.isInteger(bagCount) || bagCount < 1) {
        return { ok: false, error: badRequest("Every bagged line needs a whole bag count of at least 1") };
      }

      lineWeightKg = bagWeightKg * bagCount;
      totalBags += bagCount;

      // A sales concession, tracked separately (SPEC decision): folding it
      // into totalBags/totalWeightKg would silently rewrite the
      // variance/report/export math those fields already feed. Counted in
      // sacks, so a bulk line has none — see the field's note on the model.
      bonusBags = Number(row.bonusBags) || 0;
      if (!Number.isInteger(bonusBags) || bonusBags < 0) {
        return { ok: false, error: badRequest("Bonus bags must be a whole number of 0 or more") };
      }
      totalBonusBags += bonusBags;
      totalBonusWeightKg += bonusBags * bagWeightKg;
    }

    totalWeightKg += lineWeightKg;

    lines.push({
      productId,
      product: product.name || "",
      productAr: product.nameAr || "",
      packaging,
      bagWeightKg,
      bagCount,
      lineWeightKg,
      note: noteCheck.value,
      bonusBags,
    });
  }

  /**
   * The client's rule: one order is either lab-tested or it is not.
   *
   * Enforced rather than accommodated, because the alternative costs more than
   * it looks. Stage 6's coverage check would have to distinguish products that
   * owe a sample from products that do not; `labRequired` would stop being one
   * fact about the order; and the General Manager signing off "lab results"
   * at stage 7 would be signing off a page that covered half the load. A
   * mixed truck becomes two orders, which is a keystroke, where a mixed order
   * becomes four ambiguities.
   */
  if (testedNames.length && untestedNames.length) {
    const tested = Array.from(new Set(testedNames)).join("، ");
    const untested = Array.from(new Set(untestedNames)).join("، ");
    return {
      ok: false,
      error: badRequest(
        `An order cannot mix lab-tested and untested products — ${tested} need a lab test, ` +
          `${untested} do not. Raise them as separate orders.`
      ),
    };
  }

  return {
    ok: true,
    value: {
      lines,
      totalBags,
      // Bulk weights carry decimals, and summing them in a loop invites the
      // usual float dust (0.30000000000000004 kg) into a stored total.
      totalWeightKg: Math.round(totalWeightKg * 1000) / 1000,
      totalBonusBags,
      totalBonusWeightKg,
      labRequired: testedNames.length > 0,
    },
  };
}
