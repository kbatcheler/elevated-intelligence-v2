import { z } from "zod/v4";
import { httpRequestJson, nextLink } from "../httpJson";
import {
  buildConnector,
  buildSignalSet,
  computeWindows,
  isoDateTime,
  safeRatio,
  toNumber,
  trendDelta,
  windowLabel,
  type SignalDraft,
} from "../providerSignals";

// Shopify (commerce-pos-inventory). Runs in the in-client edge agent. It walks
// the REST Admin API order and product feeds with cursor (Link header)
// pagination, reading only order totals and line-item quantities, and variant
// inventory quantities. It reduces those to the four declared commerce signals.
// No customer, order name, product title, or variant id ever enters a signal;
// the field selector keeps the payload to numbers, and the boundary guard is the
// final check.

const KEY = "shopify";

const configSchema = z
  .object({
    baseUrl: z.string().url().optional(),
    // The store subdomain (the "acme" in acme.myshopify.com). Used to build the
    // base URL when baseUrl is not given explicitly.
    shop: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/, "shop must be a store subdomain")
      .optional(),
    apiVersion: z.string().regex(/^\d{4}-\d{2}$/, "apiVersion must look like 2024-07").default("2024-07"),
    windowDays: z.number().int().positive().max(3650).default(90),
    pageSize: z.number().int().positive().max(250).default(250),
    maxRecords: z.number().int().positive().max(100_000).default(5000),
  })
  .refine((c) => Boolean(c.baseUrl ?? c.shop), {
    message: "shopify connector requires baseUrl or shop in scope.config",
  });

interface OrdersResponse {
  orders?: Array<{ total_price?: unknown; line_items?: Array<{ quantity?: unknown }> }>;
}
interface ProductsResponse {
  products?: Array<{ variants?: Array<{ inventory_quantity?: unknown }> }>;
}

export const shopifyConnector = buildConnector(KEY, async (scope, ctx) => {
  const parsed = configSchema.safeParse(scope.config ?? {});
  if (!parsed.success) {
    throw new Error(
      "shopify connector configuration invalid: " +
        parsed.error.issues.map((i) => i.message).join("; "),
    );
  }
  const cfg = parsed.data;
  const base = (cfg.baseUrl ?? "https://" + cfg.shop + ".myshopify.com").replace(/\/+$/, "");
  const token = await ctx.resolveSecret(scope.authRef);
  const headers = { "x-shopify-access-token": token };
  const ver = cfg.apiVersion;
  const days = cfg.windowDays;
  const w = computeWindows(ctx.now(), days);

  // Sum order revenue, order count, and units sold across a window, following
  // the Link-header cursor until exhausted or the bounded cap is reached.
  async function sumOrders(startIso: string, endIso: string) {
    let url =
      base +
      "/admin/api/" +
      ver +
      "/orders.json?" +
      new URLSearchParams({
        status: "any",
        created_at_min: startIso,
        created_at_max: endIso,
        fields: "total_price,line_items",
        limit: String(cfg.pageSize),
      }).toString();
    let revenue = 0;
    let orders = 0;
    let units = 0;
    let fetched = 0;
    let pricedOrders = 0;
    let lineItems = 0;
    let quantifiedItems = 0;
    let truncated = false;
    for (let guard = 0; url && guard < 500; guard++) {
      const { data, headers: rh } = await httpRequestJson<OrdersResponse>(url, { headers });
      const list = data.orders ?? [];
      for (const o of list) {
        const price = toNumber(o.total_price);
        if (Number.isFinite(price)) {
          revenue += price;
          pricedOrders += 1;
        }
        orders += 1;
        for (const li of o.line_items ?? []) {
          lineItems += 1;
          const q = toNumber(li.quantity);
          if (Number.isFinite(q)) {
            units += q;
            quantifiedItems += 1;
          }
        }
        fetched += 1;
      }
      if (list.length === 0) break;
      const next = nextLink(rh.get("link"));
      if (fetched >= cfg.maxRecords) {
        // The cap was reached while the cursor still points to a further page:
        // the revenue and unit sums cover only part of the window.
        if (next) truncated = true;
        break;
      }
      url = next;
    }
    // Completeness, not mere presence: average order value is honest only when
    // EVERY order in the window carried a finite total_price, and units sold are
    // honest only when EVERY line item carried a finite quantity. A partial sum
    // understates the figure, so the dependent signal is omitted rather than
    // fabricated. (Counts can never exceed their denominators, so equality is
    // completeness.) An empty window leaves both vacuously complete: a genuine
    // zero, not an unobserved one. A walk truncated at maxRecords has seen only
    // part of the window, so both are forced incomplete.
    const revenueComplete = !truncated && pricedOrders >= orders;
    const unitsComplete = !truncated && quantifiedItems >= lineItems;
    return { revenue, orders, units, revenueComplete, unitsComplete };
  }

  // Sum variant inventory: total variants, those out of stock, and units on hand.
  async function sumInventory() {
    let url =
      base +
      "/admin/api/" +
      ver +
      "/products.json?" +
      new URLSearchParams({ fields: "variants", limit: String(cfg.pageSize) }).toString();
    let totalVariants = 0;
    let observedVariants = 0;
    let outOfStock = 0;
    let onHand = 0;
    let fetched = 0;
    let truncated = false;
    for (let guard = 0; url && guard < 500; guard++) {
      const { data, headers: rh } = await httpRequestJson<ProductsResponse>(url, { headers });
      const products = data.products ?? [];
      for (const p of products) {
        for (const v of p.variants ?? []) {
          totalVariants += 1;
          fetched += 1;
          const q = toNumber(v.inventory_quantity);
          // A variant whose inventory_quantity is absent or non-finite is unknown,
          // not zero: it is excluded from both the on-hand total and the stockout
          // count rather than being fabricated as a zero (and thus out of stock).
          if (!Number.isFinite(q)) continue;
          observedVariants += 1;
          if (q <= 0) outOfStock += 1;
          else onHand += q;
        }
      }
      if (products.length === 0) break;
      const next = nextLink(rh.get("link"));
      if (fetched >= cfg.maxRecords) {
        // The cap was reached while more product pages remain: the catalogue walk
        // is partial, so the inventory-derived signals cannot be trusted.
        if (next) truncated = true;
        break;
      }
      url = next;
    }
    // observedVariants is the count of variants whose inventory we actually read.
    // When it is zero (a missing feed, or one that carried no finite quantity),
    // the inventory-derived signals are omitted rather than invented from an
    // assumed zero on hand. A truncated walk likewise yields an untrustworthy
    // catalogue, so it is reported for the caller to omit those signals.
    return { totalVariants, observedVariants, outOfStock, onHand, truncated };
  }

  const [current, prior, inventory] = await Promise.all([
    sumOrders(isoDateTime(w.start), isoDateTime(w.end)),
    sumOrders(isoDateTime(w.priorStart), isoDateTime(w.priorEnd)),
    sumInventory(),
  ]);

  // Average order value per window: formed only when every order in the window
  // carried a finite total_price. A window where any order is unpriced yields null
  // (an omitted AOV, hence an omitted trend), never an AOV computed from a partial
  // revenue sum. An empty window is vacuously complete and yields null anyway
  // (zero-denominator), not a fabricated figure.
  const aovCurrent = current.revenueComplete ? safeRatio(current.revenue, current.orders) : null;
  const aovPrior = prior.revenueComplete ? safeRatio(prior.revenue, prior.orders) : null;

  // Inventory: stockout is an honest ratio over the variants we actually observed.
  // Sell-through and turns combine sold units with on-hand stock, so they require
  // BOTH a complete sold-units count (every line item quantified) AND a complete
  // on-hand count (every variant observed); mixing a total with a partial would
  // distort them, so they are omitted rather than fabricated. A missing feed or a
  // missing field yields an omitted signal (a dash in the portal), never a figure
  // invented from an assumed zero on hand or zero sold.
  const onHandKnown = !inventory.truncated && inventory.observedVariants > 0;
  const onHandComplete =
    !inventory.truncated &&
    inventory.totalVariants > 0 &&
    inventory.observedVariants >= inventory.totalVariants;
  const unitsKnown = current.unitsComplete;
  const window = windowLabel(days);
  const drafts: SignalDraft[] = [
    {
      key: "sell_through_rate_pct",
      kind: "ratio",
      value:
        onHandComplete && unitsKnown
          ? safeRatio(current.units, current.units + inventory.onHand)
          : null,
      window,
    },
    {
      key: "inventory_turns",
      kind: "aggregate",
      value: onHandComplete && unitsKnown ? safeRatio(current.units, inventory.onHand) : null,
      unit: "turns",
      window,
    },
    { key: "aov_trend_delta", kind: "trend_delta", value: trendDelta(aovCurrent, aovPrior), window },
    {
      key: "stockout_ratio",
      kind: "ratio",
      value: onHandKnown ? safeRatio(inventory.outOfStock, inventory.observedVariants) : null,
    },
  ];

  ctx.log("shopify.extract.complete", {
    connector: KEY,
    signals: drafts.filter((d) => d.value !== null).length,
  });
  return buildSignalSet({ source: KEY, scope, ctx, drafts });
});
