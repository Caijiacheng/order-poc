import { describe, expect, it } from "vitest";

import {
  computeCartSummary,
  findBoxAdjustments,
  findPairSuggestions,
  findThresholdTopupCandidates,
} from "../../lib/domain/cart-rules";
import type {
  CartItem,
  DealerEntity,
  ProductEntity,
  RuleConfigEntity,
} from "../../lib/memory/types";

function buildDealer(overrides?: Partial<DealerEntity>): DealerEntity {
  return {
    customer_id: "dealer_test",
    customer_name: "测试经销商",
    city: "厦门",
    customer_type: "测试类型",
    channel_type: "测试渠道",
    store_count_hint: "1",
    last_order_days_ago: 5,
    order_frequency: "7天",
    price_sensitivity: "中",
    new_product_acceptance: "中",
    frequent_items: [],
    forbidden_items: [],
    preferred_categories: [],
    business_traits: [],
    status: "active",
    created_at: "2026-04-15T00:00:00.000Z",
    updated_at: "2026-04-15T00:00:00.000Z",
    ...overrides,
  };
}

function buildRules(overrides?: Partial<RuleConfigEntity>): RuleConfigEntity {
  return {
    replenishment_days_threshold: 5,
    cart_gap_trigger_amount: 30,
    threshold_amount: 1000,
    cart_target_amount: 1000,
    prefer_frequent_items: true,
    prefer_pair_items: true,
    box_adjust_if_close: true,
    box_adjust_distance_limit: 2,
    allow_new_product_recommendation: true,
    ...overrides,
  };
}

function buildProduct(overrides?: Partial<ProductEntity>): ProductEntity {
  return {
    sku_id: "sku_default",
    sku_name: "默认商品",
    brand: "厨邦",
    category: "生抽",
    spec: "500ml",
    price_per_case: 100,
    box_multiple: 6,
    tags: [],
    pair_items: [],
    is_weekly_focus: false,
    is_new_product: false,
    status: "active",
    display_order: 1,
    created_at: "2026-04-15T00:00:00.000Z",
    updated_at: "2026-04-15T00:00:00.000Z",
    ...overrides,
  };
}

describe("cart-rules deterministic semantics", () => {
  it("computes cart amount and threshold gap with case-based amounts", () => {
    const items: CartItem[] = [
      {
        sku_id: "sku_a",
        sku_name: "A",
        qty: 2,
        price_per_case: 100,
        box_multiple: 6,
        source: "manual",
        added_at: "2026-04-15T00:00:00.000Z",
        updated_at: "2026-04-15T00:00:00.000Z",
      },
      {
        sku_id: "sku_b",
        sku_name: "B",
        qty: 1,
        price_per_case: 250,
        box_multiple: 6,
        source: "manual",
        added_at: "2026-04-15T00:00:00.000Z",
        updated_at: "2026-04-15T00:00:00.000Z",
      },
    ];

    const summary = computeCartSummary(items, 1000);
    expect(summary.total_amount).toBe(450);
    expect(summary.item_count).toBe(3);
    expect(summary.sku_count).toBe(2);
    expect(summary.gap_to_threshold).toBe(550);
    expect(summary.threshold_reached).toBe(false);
  });

  it("selects top-up candidates deterministically and computes qty by gap/price", () => {
    const products: ProductEntity[] = [
      buildProduct({
        sku_id: "sku_high_price",
        sku_name: "高价常规品",
        price_per_case: 350,
      }),
      buildProduct({
        sku_id: "sku_frequent",
        sku_name: "常购品",
        price_per_case: 300,
      }),
      buildProduct({
        sku_id: "sku_new_disabled",
        sku_name: "新品",
        price_per_case: 700,
        is_new_product: true,
      }),
      buildProduct({
        sku_id: "sku_forbidden",
        sku_name: "禁推品",
        price_per_case: 500,
      }),
      buildProduct({
        sku_id: "sku_inactive",
        sku_name: "停用品",
        status: "inactive",
      }),
    ];
    const dealer = buildDealer({
      frequent_items: ["sku_frequent"],
      forbidden_items: ["sku_forbidden"],
    });
    const rules = buildRules({
      allow_new_product_recommendation: false,
      cart_gap_trigger_amount: 700,
    });

    const candidates = findThresholdTopupCandidates({
      products,
      dealer,
      rules,
      gapToThreshold: 620,
    });

    expect(candidates).toHaveLength(2);
    expect(candidates.map((item) => item.sku_id)).toEqual([
      "sku_high_price",
      "sku_frequent",
    ]);
    expect(candidates[0].suggested_qty).toBe(2);
    expect(candidates[1].suggested_qty).toBe(3);
    expect(candidates[0].reason).toContain("¥620");
  });

  it("does not propose threshold top-up when remaining gap exceeds trigger amount", () => {
    const candidates = findThresholdTopupCandidates({
      products: [buildProduct()],
      dealer: buildDealer(),
      rules: buildRules({ cart_gap_trigger_amount: 50 }),
      gapToThreshold: 120,
    });

    expect(candidates).toHaveLength(0);
  });

  it("only proposes box adjustments when close enough to box multiple", () => {
    const rules = buildRules({ box_adjust_if_close: true, box_adjust_distance_limit: 2 });
    const cartItems: CartItem[] = [
      {
        sku_id: "sku_a",
        sku_name: "A",
        qty: 5,
        price_per_case: 100,
        box_multiple: 6,
        source: "manual",
        added_at: "2026-04-15T00:00:00.000Z",
        updated_at: "2026-04-15T00:00:00.000Z",
      },
      {
        sku_id: "sku_b",
        sku_name: "B",
        qty: 10,
        price_per_case: 100,
        box_multiple: 12,
        source: "manual",
        added_at: "2026-04-15T00:00:00.000Z",
        updated_at: "2026-04-15T00:00:00.000Z",
      },
      {
        sku_id: "sku_c",
        sku_name: "C",
        qty: 13,
        price_per_case: 100,
        box_multiple: 12,
        source: "manual",
        added_at: "2026-04-15T00:00:00.000Z",
        updated_at: "2026-04-15T00:00:00.000Z",
      },
    ];

    const adjustments = findBoxAdjustments({ cartItems, rules });
    expect(adjustments).toEqual([
      {
        sku_id: "sku_a",
        from_qty: 5,
        to_qty: 6,
        reason: "距离整箱倍数仅差 1，建议补齐到 6。",
      },
      {
        sku_id: "sku_b",
        from_qty: 10,
        to_qty: 12,
        reason: "距离整箱倍数仅差 2，建议补齐到 12。",
      },
    ]);
  });

  it("deduplicates pair suggestions and filters forbidden/inactive items", () => {
    const products: ProductEntity[] = [
      buildProduct({
        sku_id: "sku_a",
        sku_name: "A",
        pair_items: ["sku_pair", "sku_forbidden"],
      }),
      buildProduct({
        sku_id: "sku_b",
        sku_name: "B",
        pair_items: ["sku_pair"],
      }),
      buildProduct({ sku_id: "sku_pair", sku_name: "搭配商品", status: "active" }),
      buildProduct({ sku_id: "sku_forbidden", sku_name: "禁推搭配", status: "active" }),
      buildProduct({ sku_id: "sku_inactive_pair", sku_name: "停用搭配", status: "inactive" }),
    ];
    const dealer = buildDealer({ forbidden_items: ["sku_forbidden"] });
    const cartItems: CartItem[] = [
      {
        sku_id: "sku_a",
        sku_name: "A",
        qty: 1,
        price_per_case: 100,
        box_multiple: 6,
        source: "manual",
        added_at: "2026-04-15T00:00:00.000Z",
        updated_at: "2026-04-15T00:00:00.000Z",
      },
      {
        sku_id: "sku_b",
        sku_name: "B",
        qty: 1,
        price_per_case: 100,
        box_multiple: 6,
        source: "manual",
        added_at: "2026-04-15T00:00:00.000Z",
        updated_at: "2026-04-15T00:00:00.000Z",
      },
    ];

    const suggestions = findPairSuggestions({
      cartItems,
      products,
      dealer,
      rules: buildRules(),
    });
    expect(suggestions).toEqual([
      {
        sku_id: "sku_pair",
        sku_name: "搭配商品",
        suggested_qty: 1,
        reason: "A 常与 搭配商品 搭配采购。",
      },
    ]);
  });

  it("can disable pair suggestions entirely from rules", () => {
    const suggestions = findPairSuggestions({
      cartItems: [
        {
          sku_id: "sku_a",
          sku_name: "A",
          qty: 1,
          price_per_case: 100,
          box_multiple: 6,
          source: "manual",
          added_at: "2026-04-15T00:00:00.000Z",
          updated_at: "2026-04-15T00:00:00.000Z",
        },
      ],
      products: [
        buildProduct({
          sku_id: "sku_a",
          sku_name: "A",
          pair_items: ["sku_pair"],
        }),
        buildProduct({
          sku_id: "sku_pair",
          sku_name: "搭配商品",
        }),
      ],
      dealer: buildDealer(),
      rules: buildRules({ prefer_pair_items: false }),
    });

    expect(suggestions).toEqual([]);
  });

  it("skips new pair items when new-product recommendation is disabled", () => {
    const suggestions = findPairSuggestions({
      cartItems: [
        {
          sku_id: "sku_a",
          sku_name: "A",
          qty: 1,
          price_per_case: 100,
          box_multiple: 6,
          source: "manual",
          added_at: "2026-04-15T00:00:00.000Z",
          updated_at: "2026-04-15T00:00:00.000Z",
        },
      ],
      products: [
        buildProduct({
          sku_id: "sku_a",
          sku_name: "A",
          pair_items: ["sku_pair_new"],
        }),
        buildProduct({
          sku_id: "sku_pair_new",
          sku_name: "新品搭配",
          is_new_product: true,
        }),
      ],
      dealer: buildDealer(),
      rules: buildRules({
        prefer_pair_items: true,
        allow_new_product_recommendation: false,
      }),
    });

    expect(suggestions).toEqual([]);
  });
});
